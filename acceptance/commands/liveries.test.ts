import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, setDefaultTimeout, test} from 'bun:test';
import path from 'node:path';

import createCliFixture from '#acceptance-cli';

let fixture: Awaited<ReturnType<typeof createCliFixture>>;
const tableHeaderRows = 1;
const idColumn = 0;
const cliTimeout = 60_000;
setDefaultTimeout(cliTimeout);

beforeEach(async () => {
  fixture = await createCliFixture();
});

afterEach(async () => {
  await fixture.dispose();
});

async function seedLiveries(): Promise<void> {
  expect(await fixture.run('liveries', 'list')).toMatchObject({exitCode: 0});
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run(`INSERT INTO packages (id, source_path) VALUES (1, '/base'), (2, '/liveries')`);
  db.run(`INSERT INTO aircraft (id, icao_type_designator, name, package_id, source_key) VALUES
    (1, 'a320', 'Airbus', 1, 'base'), (2, 'A320X', 'Other', 1, 'other'),
    (3, '%', 'Percent', 1, 'percent'), (4, '_', 'Underscore', 1, 'underscore')`);
  db.run(`INSERT INTO airlines (id, icao_code, iata_code, name) VALUES
    (1, 'bAw', 'BA', 'British Airways'), (2, 'BAWX', NULL, 'Other'),
    (3, '%', NULL, NULL), (4, '_', NULL, NULL)`);
  db.run(`INSERT INTO liveries
    (id, name, registration, aircraft_id, airline_id, package_id, source_key, target_aircraft_key) VALUES
    (1, 'Heritage', 'G-AAA', 1, 1, 2, 'first.cfg', 'different'),
    (2, 'Heritage', 'G-AAA', 1, 1, 1, 'second.cfg', 'base'),
    (3, 'Other', NULL, 2, 2, 2, 'other.cfg', 'other'),
    (4, NULL, NULL, NULL, NULL, 2, 'unknown.cfg', 'base'),
    (5, 'Unresolved', NULL, NULL, 1, 2, 'unresolved.cfg', 'base'),
    (6, 'No airline', NULL, 1, NULL, 2, 'no-airline.cfg', 'base'),
    (7, 'Percent', NULL, 3, 3, 2, 'percent.cfg', 'percent'),
    (8, 'Underscore', NULL, 4, 4, 2, 'underscore.cfg', 'underscore')`);
}

async function listRows(...args: readonly string[]): Promise<string[][]> {
  const result = await fixture.run('liveries', 'list', ...args);
  expect(result).toMatchObject({exitCode: 0, stderr: ''});
  return Bun.stripANSI(result.stdout)
    .split('\n')
    .filter(line => line.startsWith('|'))
    .slice(tableHeaderRows)
    .map(line =>
      line
        .split('|')
        .slice(tableHeaderRows, -tableHeaderRows)
        .map(cell => cell.trim())
    );
}

const heritageRows = [
  [
    '1',
    'Heritage',
    'G-AAA',
    '1',
    'a320',
    'Airbus',
    '1',
    'bAw',
    'BA',
    'British Airways',
    'different',
    '2',
    'first.cfg',
    '/liveries',
  ],
  [
    '2',
    'Heritage',
    'G-AAA',
    '1',
    'a320',
    'Airbus',
    '1',
    'bAw',
    'BA',
    'British Airways',
    'base',
    '1',
    'second.cfg',
    '/base',
  ],
];

const allRows = [
  ['4', '', '', '', '', '', '', '', '', '', 'base', '2', 'unknown.cfg', '/liveries'],
  ...heritageRows,
  [
    '6',
    'No airline',
    '',
    '1',
    'a320',
    'Airbus',
    '',
    '',
    '',
    '',
    'base',
    '2',
    'no-airline.cfg',
    '/liveries',
  ],
  [
    '3',
    'Other',
    '',
    '2',
    'A320X',
    'Other',
    '2',
    'BAWX',
    '',
    'Other',
    'other',
    '2',
    'other.cfg',
    '/liveries',
  ],
  [
    '7',
    'Percent',
    '',
    '3',
    '%',
    'Percent',
    '3',
    '%',
    '',
    '',
    'percent',
    '2',
    'percent.cfg',
    '/liveries',
  ],
  [
    '8',
    'Underscore',
    '',
    '4',
    '_',
    'Underscore',
    '4',
    '_',
    '',
    '',
    'underscore',
    '2',
    'underscore.cfg',
    '/liveries',
  ],
  [
    '5',
    'Unresolved',
    '',
    '',
    '',
    '',
    '1',
    'bAw',
    'BA',
    'British Airways',
    'base',
    '2',
    'unresolved.cfg',
    '/liveries',
  ],
];

async function listIds(...args: readonly string[]): Promise<(string | undefined)[]> {
  const rows = await listRows(...args);
  return rows.map((row: readonly string[]) => row.at(idColumn));
}

test('list distinguishes an empty inventory from missing filter matches', async () => {
  expect(await fixture.run('liveries', 'list')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'No installed liveries found. Run scan to populate the list.\n',
  });
  for (const flag of ['--aircraft', '--airline']) {
    expect(await fixture.run('liveries', 'list', flag, 'MISSING')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'No installed liveries match those filters.\n',
    });
  }
});

test('list preserves duplicate and unresolved liveries with linked metadata and directory links', async () => {
  await seedLiveries();
  expect(await listRows()).toEqual(allRows);
  const result = await fixture.run('liveries', 'list');
  expect(result.stdout).toContain(
    '\u001B]8;;file:///liveries/\u001B\\/liveries\u001B]8;;\u001B\\'
  );
});

test(
  'filters normalize exact ICAO codes, intersect, and use resolved links',
  async () => {
    await seedLiveries();
    expect(await listRows('--aircraft', ' a320 ', '--airline', ' BaW ')).toEqual(
      heritageRows
    );
    expect(await listIds('--aircraft', 'A320')).toEqual(['1', '2', '6']);
    expect(await listIds('--airline', 'baw')).toEqual(['1', '2', '5']);
    expect(await listIds('--aircraft', 'A320X', '--airline', 'BAWX')).toEqual(['3']);
    for (const args of [
      ['--aircraft', 'A32'],
      ['--airline', 'BA'],
      ['--airline', 'British Airways'],
      ['--aircraft', 'A320', '--airline', 'BAWX'],
    ]) {
      expect(await fixture.run('liveries', 'list', ...args)).toEqual({
        exitCode: 0,
        stderr: '',
        stdout: 'No installed liveries match those filters.\n',
      });
    }
  },
  cliTimeout
);

test('both filters treat percent and underscore as literal codes', async () => {
  await seedLiveries();
  for (const flag of ['--aircraft', '--airline']) {
    expect(await listIds(flag, '%')).toEqual(['7']);
    expect(await listIds(flag, '_')).toEqual(['8']);
  }
});

test('help registers liveries list and both exact filters', async () => {
  const root = await fixture.run('--help');
  expect(root).toMatchObject({exitCode: 0, stderr: ''});
  expect(root.stdout).toContain('liveries');
  const help = await fixture.run('liveries', '--help');
  expect(help).toMatchObject({exitCode: 0, stderr: ''});
  expect(help.stdout).toContain('list');
  const listHelp = await fixture.run('liveries', 'list', '--help');
  expect(listHelp).toMatchObject({exitCode: 0, stderr: ''});
  expect(listHelp.stdout).toContain('--aircraft');
  expect(listHelp.stdout).toContain('--airline');
});
