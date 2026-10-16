import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import path from 'node:path';

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

test('list on a fresh database explains how to populate it', async () => {
  expect(await fixture.run('airports', 'list')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'No installed airports found. Run scan to populate the list.\n',
  });
});

test(
  'list shows every stored column, preserves duplicate airports, and sorts by code, name, and ID',
  async () => {
    await scanAirport();
    using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
    db.run('DELETE FROM airports');
    db.run('INSERT INTO packages (id, source_path) VALUES (2, ?)', [
      path.join(fixture.community, 'second-airport'),
    ]);
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
      stdout: `+----+-----------+-----------+-------+------------+-------------+------------------+------------+-------------+
| ID | ICAO code | IATA code | Name  | Latitude   | Longitude   | Elevation meters | Package ID | Source key  |
+----+-----------+-----------+-------+------------+-------------+------------------+------------+-------------+
| 2  |           |           |       |            |             |                  | 1          | unknown.xml |
| 4  | KAAA      | AAA       | Alpha |            |             |                  | 1          | shared.xml  |
| 5  | KAAA      | AAA       | Alpha | 12.3456789 | -123.456789 | 1234.5678        | 2          | shared.xml  |
| 8  | KAAA      |           | Beta  | 0          | 0           | 0                | 1          | beta.xml    |
| 9  | KZZZ      | ZZZ       | Zulu  | -33.946111 | 151.177222  | 35.5             | 1          | zulu.xml    |
+----+-----------+-----------+-------+------------+-------------+------------------+------------+-------------+
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
    db.run('UPDATE airports SET icao_code = ?, iata_code = ?, name = ?, source_key = ?', [
      'K\tAA',
      'A\u0085A',
      '\u001B[31m東京国際空港e\u0301\u001B[0m\tNorth\nGate\r\u0000\u0085',
      '\u001B]8;;https://example.invalid\u0007airport.xml\u001B]8;;\u0007',
    ]);
    expect(await fixture.run('airports', 'list')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `+----+-----------+-----------+-----------------------------+----------+-----------+------------------+------------+-------------+
| ID | ICAO code | IATA code | Name                        | Latitude | Longitude | Elevation meters | Package ID | Source key  |
+----+-----------+-----------+-----------------------------+----------+-----------+------------------+------------+-------------+
| 1  | K AA      | A A       | 東京国際空港é North Gate    |          |           |                  | 1          | airport.xml |
+----+-----------+-----------+-----------------------------+----------+-----------+------------------+------------+-------------+
`,
    });
  },
  cliTimeout
);

test('airport help registers list and retains enrich', async () => {
  const help = await fixture.run('airports', '--help');
  expect(help.exitCode).toBe(successExitCode);
  expect(help.stderr).toBe('');
  expect(help.stdout).toContain('list');
  expect(help.stdout).toContain('enrich');
  expect(await fixture.run('airports', 'list', '--help')).toMatchObject({
    exitCode: 0,
    stderr: '',
  });
  expect(await fixture.run('airports', 'enrich', '--help')).toMatchObject({
    exitCode: 0,
    stderr: '',
  });
});
