import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import createFixture from '#acceptance-scanner';

let fixture: Awaited<ReturnType<typeof createFixture>>;
const cliTimeout = 60_000;
const successExitCode = 0;
const tableHeaderRows = 1;

beforeEach(async () => {
  fixture = await createFixture();
});

afterEach(async () => {
  await fixture.dispose();
});

async function scanAircraft(): Promise<string> {
  const directory = await fixture.addon('aircraft', {
    'SimObjects/Airplanes/Base/aircraft.cfg':
      '[GENERAL]\nicao_type_designator=A320\nicao_manufacturer=Airbus\nicao_model=A320-200\n[FLTSIM.0]\nui_type=Airbus A320\nicao_airline=BAW\natc_airline=British Airways\n[FLTSIM.1]\nicao_airline=BAW\n',
  });
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
  expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
  return directory;
}

async function listRows(...args: readonly string[]): Promise<string[][]> {
  const result = await fixture.run('aircraft', 'list', ...args);
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

test('list distinguishes an empty inventory from missing filters', async () => {
  expect(await fixture.run('aircraft', 'list')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'No installed aircraft found. Run scan to populate the list.\n',
  });
  for (const flag of ['--code', '--airline']) {
    expect(await fixture.run('aircraft', 'list', flag, 'MISSING')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'No installed aircraft match those filters.\n',
    });
  }
});

test(
  'list reads scanned aircraft and airline links without multiplying matching liveries',
  async () => {
    const directory = await scanAircraft();
    const expected = [
      [
        '1',
        'A320',
        'Airbus',
        'A320-200',
        'Airbus A320',
        '1',
        'simobjects/airplanes/base',
        directory,
      ],
    ];
    expect(await listRows()).toEqual(expected);
    expect(await listRows('--code', ' a320 ', '--airline', ' baw ')).toEqual(expected);
  },
  cliTimeout
);

test(
  'list shows every column, blanks nulls, and orders distinct aircraft by code, name, and ID',
  async () => {
    await scanAircraft();
    using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
    db.run('DELETE FROM liveries');
    db.run('DELETE FROM aircraft');
    db.run('UPDATE packages SET source_path = ?', ['/aircraft/first']);
    db.run('INSERT INTO packages (id, source_path) VALUES (2, ?)', ['/aircraft/second']);
    db.run(`INSERT INTO aircraft
    (id, icao_type_designator, manufacturer, model, name, package_id, source_key)
    VALUES
    (9, 'B738', 'Boeing', '737-800', 'Zulu', 1, 'zulu'),
    (8, 'A320', NULL, NULL, 'Beta', 1, 'beta'),
    (5, 'A320', 'Airbus', 'A320-200', 'Alpha', 2, 'shared'),
    (4, 'A320', NULL, NULL, 'Alpha', 1, 'shared'),
    (2, NULL, NULL, NULL, NULL, 1, 'unknown')`);
    expect(await fixture.run('aircraft', 'list')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `+----+----------------------+--------------+----------+-------+------------+------------+------------------+
| ID | ICAO type designator | Manufacturer | Model    | Name  | Package ID | Source key | Directory        |
+----+----------------------+--------------+----------+-------+------------+------------+------------------+
| 2  |                      |              |          |       | 1          | unknown    | /aircraft/first  |
| 4  | A320                 |              |          | Alpha | 1          | shared     | /aircraft/first  |
| 5  | A320                 | Airbus       | A320-200 | Alpha | 2          | shared     | /aircraft/second |
| 8  | A320                 |              |          | Beta  | 1          | beta       | /aircraft/first  |
| 9  | B738                 | Boeing       | 737-800  | Zulu  | 1          | zulu       | /aircraft/first  |
+----+----------------------+--------------+----------+-------+------------+------------+------------------+
`,
    });
  },
  cliTimeout
);

async function seedFilters(): Promise<void> {
  await scanAircraft();
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run('DELETE FROM liveries');
  db.run('DELETE FROM aircraft');
  db.run('DELETE FROM airlines');
  db.run("UPDATE packages SET source_path = '/aircraft/base'");
  db.run("INSERT INTO packages (id, source_path) VALUES (2, '/liveries/other')");
  db.run(`INSERT INTO aircraft (id, icao_type_designator, name, package_id, source_key) VALUES
    (1, 'a320', 'Both', 1, 'base'),
    (2, 'a320', 'Code only', 1, 'code'),
    (3, 'A320X', 'Airline only', 1, 'other'),
    (4, '%', 'Percent', 1, 'percent'),
    (5, '_', 'Underscore', 1, 'underscore'),
    (6, 'a320', 'Second record', 2, 'base')`);
  db.run(`INSERT INTO airlines (id, icao_code, iata_code) VALUES
    (1, 'bAw', 'BA'), (2, 'BAWX', NULL), (3, '%', NULL), (4, '_', NULL)`);
  db.run(`INSERT INTO liveries
    (id, aircraft_id, airline_id, package_id, source_key, target_aircraft_key) VALUES
    (1, 1, 1, 2, 'first', 'different'),
    (2, 1, 1, 2, 'duplicate', 'different'),
    (3, 3, 1, 1, 'other', 'other'),
    (4, NULL, 1, 1, 'unresolved', 'code'),
    (5, 2, NULL, 1, 'unknown-airline', 'code'),
    (6, 4, 3, 1, 'percent', 'percent'),
    (7, 5, 4, 1, 'underscore', 'underscore'),
    (8, 6, 1, 1, 'second-record', 'base')`);
}

test(
  'code filters are exact, trimmed, case-insensitive, and treat wildcards literally',
  async () => {
    await seedFilters();
    expect(await listRows('--code', ' A320 ')).toEqual([
      ['1', 'a320', '', '', 'Both', '1', 'base', '/aircraft/base'],
      ['2', 'a320', '', '', 'Code only', '1', 'code', '/aircraft/base'],
      ['6', 'a320', '', '', 'Second record', '2', 'base', '/liveries/other'],
    ]);
    expect(await listRows('--code', '%')).toEqual([
      ['4', '%', '', '', 'Percent', '1', 'percent', '/aircraft/base'],
    ]);
    expect(await listRows('--code', '_')).toEqual([
      ['5', '_', '', '', 'Underscore', '1', 'underscore', '/aircraft/base'],
    ]);
    expect(await fixture.run('aircraft', 'list', '--code', 'A32')).toMatchObject({
      exitCode: 0,
      stdout: 'No installed aircraft match those filters.\n',
    });
  },
  cliTimeout
);

test(
  'airline filters use resolved ICAO links and intersect aircraft filters',
  async () => {
    await seedFilters();
    expect(await listRows('--airline', ' BaW ')).toEqual([
      ['3', 'A320X', '', '', 'Airline only', '1', 'other', '/aircraft/base'],
      ['1', 'a320', '', '', 'Both', '1', 'base', '/aircraft/base'],
      ['6', 'a320', '', '', 'Second record', '2', 'base', '/liveries/other'],
    ]);
    expect(await listRows('--airline', 'baw', '--code', 'A320')).toEqual([
      ['1', 'a320', '', '', 'Both', '1', 'base', '/aircraft/base'],
      ['6', 'a320', '', '', 'Second record', '2', 'base', '/liveries/other'],
    ]);
    for (const code of ['BA', 'BAWXX', 'BAWX']) {
      expect(await fixture.run('aircraft', 'list', '--airline', code)).toMatchObject({
        exitCode: 0,
        stdout: 'No installed aircraft match those filters.\n',
      });
    }

    expect(await listRows('--airline', '%')).toEqual([
      ['4', '%', '', '', 'Percent', '1', 'percent', '/aircraft/base'],
    ]);
    expect(await listRows('--airline', '_')).toEqual([
      ['5', '_', '', '', 'Underscore', '1', 'underscore', '/aircraft/base'],
    ]);
  },
  cliTimeout
);

test(
  'list sanitizes Unicode and control characters and links aircraft directories only when forced',
  async () => {
    await scanAircraft();
    using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
    const directory = '/aircraft/東京 #\tNorth\n';
    db.run('UPDATE packages SET source_path = ?', [directory]);
    db.run('UPDATE aircraft SET manufacturer = ?, model = ?, name = ?, source_key = ?', [
      'Air\tbus',
      'A\u0085320',
      '\u001B[31m東京e\u0301\u001B[0m\tNorth\nGate\r\u0000',
      '\u001B]8;;https://example.invalid\u0007base\u001B]8;;\u0007',
    ]);
    const [plain, disabled, linked] = await Promise.all([
      fixture.run('aircraft', 'list'),
      fixture.run('aircraft', 'list', '--hyperlink', 'never'),
      fixture.run('aircraft', 'list', '--hyperlink', 'always'),
    ]);
    expect(plain).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `+----+----------------------+--------------+-------+--------------------+------------+------------+-------------------------+
| ID | ICAO type designator | Manufacturer | Model | Name               | Package ID | Source key | Directory               |
+----+----------------------+--------------+-------+--------------------+------------+------------+-------------------------+
| 1  | A320                 | Air bus      | A 320 | 東京é North Gate   | 1          | base       | /aircraft/東京 # North  |
+----+----------------------+--------------+-------+--------------------+------------+------------+-------------------------+
`,
    });
    expect(disabled).toEqual(plain);
    expect({...linked, stdout: Bun.stripANSI(linked.stdout)}).toEqual(plain);
    expect(linked.stdout).toContain(
      `\u001B]8;;${pathToFileURL(path.join(directory, path.sep)).href}\u001B\\/aircraft/東京 # North \u001B]8;;\u001B\\`
    );
  },
  cliTimeout
);

test('aircraft help registers list and its options and rejects an invalid hyperlink mode', async () => {
  const [rootHelp, help, listHelp] = await Promise.all([
    fixture.run('--help'),
    fixture.run('aircraft', '--help'),
    fixture.run('aircraft', 'list', '--help'),
  ]);
  expect([rootHelp, help, listHelp]).toMatchObject([
    {exitCode: 0, stderr: ''},
    {exitCode: 0, stderr: ''},
    {exitCode: 0, stderr: ''},
  ]);
  expect(rootHelp.stdout).toContain('aircraft');
  expect(help.stdout).toContain('list');
  for (const flag of ['--code', '--airline', '--hyperlink']) {
    expect(listHelp.stdout).toContain(flag);
  }

  const invalid = await fixture.run('aircraft', 'list', '--hyperlink', 'sometimes');
  expect(invalid.exitCode).not.toBe(successExitCode);
  expect(invalid.stderr).toContain('sometimes');
});
