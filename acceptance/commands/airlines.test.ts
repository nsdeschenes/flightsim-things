import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

let fixture: Awaited<ReturnType<typeof createFixture>>;
const cliTimeout = 60_000;
const tableHeaderRows = 1;

beforeEach(async () => {
  fixture = await createFixture();
});

afterEach(async () => {
  await fixture.dispose();
});

async function listRows(...args: readonly string[]): Promise<string[][]> {
  const result = await fixture.run('airlines', 'list', ...args);
  expect(result).toMatchObject({exitCode: 0, stderr: ''});
  return result.stdout
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

test('list distinguishes an empty catalog from missing filter matches', async () => {
  expect(await fixture.run('airlines', 'list')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'No saved airlines found. Run scan to populate the list.\n',
  });
  for (const flag of ['--code', '--aircraft']) {
    expect(await fixture.run('airlines', 'list', flag, 'MISSING')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'No saved airlines match those filters.\n',
    });
  }
});

test(
  'list reads scanned airlines once despite multiple matching liveries',
  async () => {
    await fixture.addon(
      'aircraft',
      {
        'SimObjects/Airplanes/Base/aircraft.cfg':
          '[GENERAL]\nicao_type_designator=A320\n[FLTSIM.0]\nicao_airline=BAW\natc_airline=British Airways\n[FLTSIM.1]\nicao_airline=BAW\n',
      },
      'AIRCRAFT'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(await listRows()).toEqual([['1', 'BAW', '', 'British Airways']]);
    expect(await listRows('--aircraft', 'A320')).toEqual([
      ['1', 'BAW', '', 'British Airways'],
    ]);
  },
  cliTimeout
);

async function seedFilters(): Promise<void> {
  await fixture.run('airlines', 'list');
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run("INSERT INTO packages (id, source_path) VALUES (1, '/base'), (2, '/liveries')");
  db.run(`INSERT INTO aircraft (id, icao_type_designator, package_id, source_key) VALUES
    (1, 'a320', 1, 'base'), (2, 'A320X', 1, 'other'),
    (3, '%', 1, 'percent'), (4, '_', 1, 'underscore'),
    (5, 'B738', 1, 'boeing'), (6, 'a320', 2, 'base')`);
  db.run(`INSERT INTO airlines (id, icao_code, iata_code, name) VALUES
    (1, 'bAw', 'BA', 'British Airways'), (2, 'BAWX', NULL, NULL),
    (3, '%', NULL, NULL), (4, '_', NULL, NULL),
    (5, 'CAT', NULL, 'Catalog only'), (6, 'UNR', NULL, 'Unresolved'),
    (7, 'EJU', NULL, NULL), (8, 'JET', NULL, NULL)`);
  db.run(`INSERT INTO liveries
    (aircraft_id, airline_id, package_id, source_key, target_aircraft_key) VALUES
    (1, 1, 2, 'first', 'different'), (1, 1, 2, 'duplicate', 'different'),
    (6, 1, 1, 'second-aircraft', 'base'), (2, 2, 1, 'other', 'other'),
    (3, 3, 1, 'percent', 'percent'), (4, 4, 1, 'underscore', 'underscore'),
    (NULL, 6, 1, 'unresolved', 'base'), (1, 7, 1, 'easyjet', 'base'),
    (5, 8, 1, 'jet', 'boeing'), (1, NULL, 1, 'unknown-airline', 'base')`);
}

test(
  'ICAO filters are exact, normalized, intersected, and use resolved aircraft links',
  async () => {
    await seedFilters();
    const britishAirways = [['1', 'bAw', 'BA', 'British Airways']];
    expect(await listRows('--code', ' BaW ')).toEqual(britishAirways);
    expect(await listRows('--aircraft', ' A320 ')).toEqual([
      ['7', 'EJU', '', ''],
      ...britishAirways,
    ]);
    expect(await listRows('--code', ' baw ', '--aircraft', ' a320 ')).toEqual(
      britishAirways
    );
    expect(await listRows('--aircraft', 'A320X')).toEqual([['2', 'BAWX', '', '']]);
    for (const args of [
      ['--code', 'BA'],
      ['--code', 'British Airways'],
      ['--aircraft', 'A32'],
      ['--code', 'baw', '--aircraft', 'B738'],
      ['--code', 'UNR', '--aircraft', 'A320'],
      ['--code', 'CAT', '--aircraft', 'A320'],
    ]) {
      expect(await fixture.run('airlines', 'list', ...args)).toEqual({
        exitCode: 0,
        stderr: '',
        stdout: 'No saved airlines match those filters.\n',
      });
    }

    expect(await listRows('--code', 'CAT')).toEqual([['5', 'CAT', '', 'Catalog only']]);
    expect(await listRows()).toEqual([
      ['3', '%', '', ''],
      ['2', 'BAWX', '', ''],
      ['5', 'CAT', '', 'Catalog only'],
      ['7', 'EJU', '', ''],
      ['8', 'JET', '', ''],
      ['6', 'UNR', '', 'Unresolved'],
      ['4', '_', '', ''],
      ...britishAirways,
    ]);
  },
  cliTimeout
);

test('both filters treat percent and underscore as literal codes', async () => {
  await seedFilters();
  for (const flag of ['--code', '--aircraft']) {
    expect(await listRows(flag, '%')).toEqual([['3', '%', '', '']]);
    expect(await listRows(flag, '_')).toEqual([['4', '_', '', '']]);
  }
});

test('list shows every column, blanks nulls, and orders by code, name, and ID', async () => {
  await fixture.run('airlines', 'list');
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run(`INSERT INTO airlines (id, icao_code, iata_code, name) VALUES
    (9, 'BAW', 'BA', 'Zulu'), (8, 'AAL', NULL, 'Beta'),
    (5, NULL, NULL, 'Alpha'), (4, NULL, NULL, 'Alpha'), (2, NULL, 'ZZ', NULL)`);
  expect(await fixture.run('airlines', 'list')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `+----+-----------+-----------+-------+
| ID | ICAO code | IATA code | Name  |
+----+-----------+-----------+-------+
| 2  |           | ZZ        |       |
| 4  |           |           | Alpha |
| 5  |           |           | Alpha |
| 8  | AAL       |           | Beta  |
| 9  | BAW       | BA        | Zulu  |
+----+-----------+-----------+-------+
`,
  });
});

test('list sanitizes control characters and ANSI links in metadata', async () => {
  await fixture.run('airlines', 'list');
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run('INSERT INTO airlines (icao_code, iata_code, name) VALUES (?, ?, ?)', [
    'B\tAW',
    'B\u0085A',
    '\u001B[31m東京e\u0301\u001B[0m\tNorth\nGate\r\u0000\u001B]8;;https://example.invalid\u0007Link\u001B]8;;\u0007',
  ]);
  expect(await fixture.run('airlines', 'list')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `+----+-----------+-----------+------------------------+
| ID | ICAO code | IATA code | Name                   |
+----+-----------+-----------+------------------------+
| 1  | B AW      | B A       | 東京é North Gate  Link |
+----+-----------+-----------+------------------------+
`,
  });
});

test('airlines help registers list and its ICAO filters', async () => {
  const [rootHelp, help, listHelp] = await Promise.all([
    fixture.run('--help'),
    fixture.run('airlines', '--help'),
    fixture.run('airlines', 'list', '--help'),
  ]);
  expect([rootHelp, help, listHelp]).toMatchObject([
    {exitCode: 0, stderr: ''},
    {exitCode: 0, stderr: ''},
    {exitCode: 0, stderr: ''},
  ]);
  expect(rootHelp.stdout).toContain('airlines');
  expect(help.stdout).toContain('list');
  for (const flag of ['--code', '--aircraft']) {
    expect(listHelp.stdout).toContain(flag);
  }

  expect(listHelp.stdout).toContain('airline ICAO code');
  expect(listHelp.stdout).toContain('aircraft ICAO type designator');
  expect(listHelp.stdout).not.toContain('--hyperlink');
});
