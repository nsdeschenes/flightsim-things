import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

import createFixture from '#acceptance-scanner';

let fixture: Awaited<ReturnType<typeof createFixture>>;
const cliTimeout = 60_000;
const successExitCode = 0;

beforeEach(async () => {
  fixture = await createFixture();
});

afterEach(async () => {
  await fixture.dispose();
});

async function scanAirport(): Promise<void> {
  await fixture.addon('airport', {
    'airport.xml': '<FSData><Airport ident="KZZZ" name="Zulu" iata="ZZZ"/></FSData>',
  });
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
  expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
}

test('list distinguishes an empty inventory from a missing code', async () => {
  expect(await fixture.run('airports', 'list')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'No installed airports found. Run scan to populate the list.\n',
  });
  expect(await fixture.run('airports', 'list', '--code', 'KAAA')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'No installed airports match that code.\n',
  });
});

test(
  'list shows every stored column, preserves duplicate airports, and sorts by code, name, and ID',
  async () => {
    await scanAirport();
    using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
    db.run('DELETE FROM airports');
    db.run('UPDATE packages SET source_path = ?', ['/airports/first']);
    db.run('INSERT INTO packages (id, source_path) VALUES (2, ?)', ['/airports/second']);
    db.run(`INSERT INTO airports
      (id, icao_code, iata_code, name, latitude, longitude, elevation_meters, package_id, source_key)
      VALUES
      (9, 'KZZZ', 'ZZZ', 'Zulu', -33.946111, 151.177222, 35.5, 1, 'zulu.xml'),
      (8, 'KAAA', NULL, 'Beta', 0, 0, 0, 1, 'beta.xml'),
      (5, 'KAAA', 'AAA', 'Alpha', 12.3456789, -123.456789, 1234.5678, 2, 'shared.xml'),
      (4, 'KAAA', 'AAA', 'Alpha', NULL, NULL, NULL, 1, 'shared.xml'),
      (2, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'unknown.xml')`);
    expect(await fixture.run('airports', 'list')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `+----+-----------+-----------+-------+------------+-------------+------------------+------------+-------------+------------------+
| ID | ICAO code | IATA code | Name  | Latitude   | Longitude   | Elevation meters | Package ID | Source key  | Directory        |
+----+-----------+-----------+-------+------------+-------------+------------------+------------+-------------+------------------+
| 2  |           |           |       |            |             |                  | 1          | unknown.xml | /airports/first  |
| 4  | KAAA      | AAA       | Alpha |            |             |                  | 1          | shared.xml  | /airports/first  |
| 5  | KAAA      | AAA       | Alpha | 12.3456789 | -123.456789 | 1234.5678        | 2          | shared.xml  | /airports/second |
| 8  | KAAA      |           | Beta  | 0          | 0           | 0                | 1          | beta.xml    | /airports/first  |
| 9  | KZZZ      | ZZZ       | Zulu  | -33.946111 | 151.177222  | 35.5             | 1          | zulu.xml    | /airports/first  |
+----+-----------+-----------+-------+------------+-------------+------------------+------------+-------------+------------------+
`,
    });
  },
  cliTimeout
);

test(
  'list keeps Unicode names aligned and removes terminal escapes and control characters',
  async () => {
    await scanAirport();
    using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
    db.run('UPDATE packages SET source_path = ?', ['/airports/東京']);
    db.run('UPDATE airports SET icao_code = ?, iata_code = ?, name = ?, source_key = ?', [
      'K\tAA',
      'A\u0085A',
      '\u001B[31m東京国際空港e\u0301\u001B[0m\tNorth\nGate\r\u0000\u0085',
      '\u001B]8;;https://example.invalid\u0007airport.xml\u001B]8;;\u0007',
    ]);
    expect(await fixture.run('airports', 'list')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `+----+-----------+-----------+-----------------------------+----------+-----------+------------------+------------+-------------+----------------+
| ID | ICAO code | IATA code | Name                        | Latitude | Longitude | Elevation meters | Package ID | Source key  | Directory      |
+----+-----------+-----------+-----------------------------+----------+-----------+------------------+------------+-------------+----------------+
| 1  | K AA      | A A       | 東京国際空港é North Gate    |          |           |                  | 1          | airport.xml | /airports/東京 |
+----+-----------+-----------+-----------------------------+----------+-----------+------------------+------------+-------------+----------------+
`,
    });
  },
  cliTimeout
);

test(
  'list matches exact ICAO and IATA codes without dropping duplicates or treating percent as a wildcard',
  async () => {
    await scanAirport();
    using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
    db.run('UPDATE packages SET source_path = ?', ['/airports/test']);
    db.run('DELETE FROM airports');
    db.run(`INSERT INTO airports (id, icao_code, iata_code, name, package_id, source_key)
      VALUES
      (1, 'kAaA', 'aAa', 'Alpha', 1, 'first.xml'),
      (2, 'kAaA', 'aAa', 'Beta', 1, 'second.xml'),
      (3, 'KAAAX', 'BBB', 'Other', 1, 'other.xml'),
      (4, '%', NULL, 'Literal', 1, 'percent.xml')`);
    const expected = {
      exitCode: 0,
      stderr: '',
      stdout: `+----+-----------+-----------+-------+----------+-----------+------------------+------------+------------+----------------+
| ID | ICAO code | IATA code | Name  | Latitude | Longitude | Elevation meters | Package ID | Source key | Directory      |
+----+-----------+-----------+-------+----------+-----------+------------------+------------+------------+----------------+
| 1  | kAaA      | aAa       | Alpha |          |           |                  | 1          | first.xml  | /airports/test |
| 2  | kAaA      | aAa       | Beta  |          |           |                  | 1          | second.xml | /airports/test |
+----+-----------+-----------+-------+----------+-----------+------------------+------------+------------+----------------+
`,
    };
    expect(await fixture.run('airports', 'list', '--code', '  KaAa  ')).toEqual(expected);
    expect(await fixture.run('airports', 'list', '--code', 'AaA')).toEqual(expected);
    expect(await fixture.run('airports', 'list', '--code', 'KAA')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'No installed airports match that code.\n',
    });
    expect(await fixture.run('airports', 'list', '--code', '%')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `+----+-----------+-----------+---------+----------+-----------+------------------+------------+-------------+----------------+
| ID | ICAO code | IATA code | Name    | Latitude | Longitude | Elevation meters | Package ID | Source key  | Directory      |
+----+-----------+-----------+---------+----------+-----------+------------------+------------+-------------+----------------+
| 4  | %         |           | Literal |          |           |                  | 1          | percent.xml | /airports/test |
+----+-----------+-----------+---------+----------+-----------+------------------+------------+-------------+----------------+
`,
    });
  },
  cliTimeout
);

test(
  'list keeps piped output plain and safely links directory labels only when forced',
  async () => {
    await scanAirport();
    using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
    db.run('UPDATE packages SET source_path = ?', [
      '/airports/Space #東京\u001B[31m\tNorth\n/end\u0007',
    ]);
    db.run("INSERT INTO packages (id, source_path) VALUES (2, '/short')");
    db.run(`INSERT INTO airports (id, icao_code, name, package_id, source_key)
      VALUES (2, 'KYYY', 'Short', 2, 'short.xml')`);
    const expected = {
      exitCode: 0,
      stderr: '',
      stdout: `+----+-----------+-----------+-------+----------+-----------+------------------+------------+--------------------------+-----------------------------------+
| ID | ICAO code | IATA code | Name  | Latitude | Longitude | Elevation meters | Package ID | Source key               | Directory                         |
+----+-----------+-----------+-------+----------+-----------+------------------+------------+--------------------------+-----------------------------------+
| 2  | KYYY      |           | Short |          |           |                  | 2          | short.xml                | /short                            |
| 1  | KZZZ      | ZZZ       | Zulu  |          |           |                  | 1          | airport.xml#airport:KZZZ | /airports/Space #東京 North /end  |
+----+-----------+-----------+-------+----------+-----------+------------------+------------+--------------------------+-----------------------------------+
`,
    };
    const [plain, disabled, linked] = await Promise.all([
      fixture.run('airports', 'list'),
      fixture.run('airports', 'list', '--hyperlink', 'never'),
      fixture.run('airports', 'list', '--hyperlink', 'always'),
    ]);
    expect({
      disabled,
      linked: {...linked, stdout: Bun.stripANSI(linked.stdout)},
      plain,
    }).toEqual({
      disabled: expected,
      linked: expected,
      plain: expected,
    });
    expect(linked.stdout).toContain(
      `\u001B]8;;${pathToFileURL('/').href}airports/Space%20%23%E6%9D%B1%E4%BA%AC%1B%5B31m%09North%0A/end%07/\u001B\\/airports/Space #東京 North /end \u001B]8;;\u001B\\`
    );
    expect(linked.stdout).toContain(
      `\u001B]8;;${pathToFileURL('/').href}short/\u001B\\/short\u001B]8;;\u001B\\                            |`
    );
  },
  cliTimeout
);

test('airport help registers list and retains enrich', async () => {
  const help = await fixture.run('airports', '--help');
  expect(help.exitCode).toBe(successExitCode);
  expect(help.stderr).toBe('');
  expect(help.stdout).toContain('list');
  expect(help.stdout).toContain('enrich');
  const listHelp = await fixture.run('airports', 'list', '--help');
  expect(listHelp).toMatchObject({exitCode: 0, stderr: ''});
  expect(listHelp.stdout).toContain('--code');
  expect(listHelp.stdout).toContain('--hyperlink');
  expect(await fixture.run('airports', 'enrich', '--help')).toMatchObject({
    exitCode: 0,
    stderr: '',
  });
});
