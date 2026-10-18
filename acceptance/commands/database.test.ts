import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

let fixture: Awaited<ReturnType<typeof createFixture>>;
const cliTimeout = 60_000;
const parseFailureExitCode = 252;
const failureExitCode = 1;
const tables = ['aircraft', 'airlines', 'airports', 'liveries', 'packages'] as const;
const clearCases = [
  {removed: ['aircraft'], target: 'aircraft'},
  {removed: ['airlines'], target: 'airlines'},
  {removed: ['airports'], target: 'airports'},
  {removed: ['liveries'], target: 'liveries'},
  {removed: ['aircraft', 'airports', 'liveries', 'packages'], target: 'packages'},
  {removed: [...tables], target: 'all'},
];
const aircraftConfig =
  '[GENERAL]\nicao_type_designator=A320\n[FLTSIM.0]\nicao_airline=BAW\natc_airline=British Airways\n';

beforeEach(async () => {
  fixture = await createFixture();
});

afterEach(async () => {
  await fixture.dispose();
});

function inventory(): Readonly<Record<string, readonly unknown[]>> {
  return {
    ...Object.fromEntries(
      tables.map(table => [table, fixture.query(`SELECT * FROM ${table} ORDER BY id`)])
    ),
    liveries: fixture.query(`SELECT id, name, package_id, registration, source_key,
      target_aircraft_key FROM liveries ORDER BY id`),
  };
}

function expectLiveryLinks(target: string): void {
  const links = fixture.query(`SELECT coalesce(aircraft_id, 0) AS aircraft_id,
    coalesce(airline_id, 0) AS airline_id FROM liveries ORDER BY id`);
  if (target === 'aircraft') {
    expect(links).toEqual([
      {aircraft_id: 0, airline_id: 1},
      {aircraft_id: 0, airline_id: 1},
    ]);
  } else if (target === 'airlines') {
    expect(links).toEqual([
      {aircraft_id: 1, airline_id: 0},
      {aircraft_id: 2, airline_id: 0},
    ]);
  } else if (target === 'airports') {
    expect(links).toEqual([
      {aircraft_id: 1, airline_id: 1},
      {aircraft_id: 2, airline_id: 1},
    ]);
  } else {
    expect(links).toEqual([]);
  }
}

function infrastructure(): Record<string, unknown[]> {
  return {
    migrations: fixture.query('SELECT * FROM __drizzle_migrations ORDER BY id'),
    schema: fixture.query('SELECT * FROM sqlite_master ORDER BY type, name'),
    sequences: fixture.query('SELECT * FROM sqlite_sequence ORDER BY name'),
  };
}

async function seed(): Promise<string> {
  const addon = await fixture.addon('base', {
    'SimObjects/Airplanes/Base/aircraft.cfg': aircraftConfig,
  });
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
  expect(await fixture.run('airlines', 'list')).toMatchObject({exitCode: 0});
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run('PRAGMA foreign_keys = ON');
  db.run('INSERT INTO packages (id, source_path) VALUES (1, ?), (2, ?)', [
    addon,
    path.join(fixture.community, 'liveries'),
  ]);
  db.run(`INSERT INTO aircraft (id, package_id, source_key, icao_type_designator) VALUES
    (1, 1, 'base', 'A320'), (2, 2, 'other', 'B738');
    INSERT INTO airlines (id, icao_code, name) VALUES
    (1, 'BAW', 'British Airways'), (2, 'CAT', 'Catalog only');
    INSERT INTO airports (id, package_id, source_key, icao_code) VALUES
    (1, 1, 'airport', 'KJFK');
    INSERT INTO liveries (id, package_id, source_key, aircraft_id, airline_id) VALUES
    (1, 2, 'cross-package', 1, 1), (2, 1, 'other', 2, 1)`);
  return path.join(addon, 'SimObjects/Airplanes/Base/aircraft.cfg');
}

function expectedInventory(
  clearCase: Readonly<{removed: readonly string[]; target: string}>
): Readonly<Record<string, readonly unknown[]>> {
  const expected = {...inventory()};
  for (const table of clearCase.removed) {
    expected[table] = [];
  }

  return expected;
}

async function expectRepeatedClear(
  target: string,
  expected: Readonly<Record<string, readonly unknown[]>>
): Promise<void> {
  const metadata = infrastructure();
  let description = target;
  if (target === 'all') {
    description = 'all records';
  }

  for (const attempt of ['initial', 'repeated']) {
    expect({attempt, ...(await fixture.run('database', 'clear', target))}).toEqual({
      attempt,
      exitCode: 0,
      stderr: '',
      stdout: `Cleared ${description} from the saved addon database.\n`,
    });
    expect(inventory()).toEqual(expected);
    expectLiveryLinks(target);
    expect(infrastructure()).toEqual(metadata);
    expect(fixture.query('PRAGMA foreign_key_check')).toEqual([]);
  }
}

test.each(clearCases)(
  'clear $target preserves unrelated records, settings, files, and database infrastructure',
  async (clearCase: Readonly<{removed: readonly string[]; target: string}>) => {
    const addonFile = await seed();
    const configurationFile = path.join(fixture.home, '.flightsim-things/config.json');
    const settings = await readFile(configurationFile, 'utf8');
    await expectRepeatedClear(clearCase.target, expectedInventory(clearCase));
    expect(await readFile(configurationFile, 'utf8')).toBe(settings);
    expect(await readFile(addonFile, 'utf8')).toBe(aircraftConfig);
  },
  cliTimeout
);

test(
  'missing, invalid, and extra arguments cannot clear records',
  async () => {
    await seed();
    const before = inventory();
    for (const args of [
      ['clear'],
      ['clear', 'unknown'],
      ['clear', 'aircraft', 'all'],
      ['clear', 'all', '--unknown'],
    ]) {
      const result = await fixture.run('database', ...args);
      expect(result.exitCode).toBe(parseFailureExitCode);
      expect(inventory()).toEqual(before);
    }
  },
  cliTimeout
);

async function expectClearHelp(): Promise<void> {
  const help = await fixture.run('database', 'clear', '--help');
  for (const target of [...tables, 'all']) {
    expect(help.stdout).toContain(target);
  }

  expect(help.stdout).toContain('Clearing packages also removes aircraft, airports, and');
  expect(help.stdout).toContain('liveries');
  expect(help.stdout).toContain('removes their links');
}

test(
  'help lists targets and deletion consequences without clearing records',
  async () => {
    await seed();
    const before = inventory();
    for (const args of [
      ['--help'],
      ['database', '--help'],
      ['database', 'clear', '--help'],
      ['database', 'clear', 'all', '--help'],
    ]) {
      const result = await fixture.run(...args);
      expect(result).toMatchObject({exitCode: 0, stderr: ''});
      expect(inventory()).toEqual(before);
    }

    await expectClearHelp();
  },
  cliTimeout
);

function rejectPackageClear(): void {
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run(`CREATE TRIGGER reject_package_clear BEFORE DELETE ON packages
      BEGIN SELECT RAISE(ABORT, 'forced clear failure'); END`);
}

test(
  'a failed later delete rolls back every table and livery link',
  async () => {
    await seed();
    rejectPackageClear();
    const before = inventory();
    const metadata = infrastructure();
    const result = await fixture.run('database', 'clear', 'all');
    expect([result.exitCode, result.stdout]).toEqual([failureExitCode, '']);
    expect(result.stderr).toContain('Failed query: delete from "packages"');
    expect(inventory()).toEqual(before);
    expect(infrastructure()).toEqual(metadata);
    expectLiveryLinks('airports');
  },
  cliTimeout
);

test(
  'a later scan restores aircraft even when their package remains saved',
  async () => {
    await fixture.addon(
      'base',
      {
        'SimObjects/Airplanes/Base/aircraft.cfg': aircraftConfig,
      },
      'AIRCRAFT'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(await fixture.run('database', 'clear', 'aircraft')).toMatchObject({
      exitCode: 0,
    });
    expect(fixture.query('SELECT id FROM aircraft')).toEqual([]);
    expect(fixture.query('SELECT id FROM packages')).toEqual([{id: 1}]);
    expect(fixture.query('SELECT aircraft_id IS NULL AS unlinked FROM liveries')).toEqual(
      [{unlinked: 1}]
    );
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(fixture.query('SELECT icao_type_designator FROM aircraft')).toEqual([
      {icao_type_designator: 'A320'},
    ]);
    expect(
      fixture.query(`SELECT aircraft.icao_type_designator, airlines.icao_code
    FROM liveries JOIN aircraft ON aircraft.id = liveries.aircraft_id
    JOIN airlines ON airlines.id = liveries.airline_id`)
    ).toEqual([{icao_code: 'BAW', icao_type_designator: 'A320'}]);
  },
  cliTimeout
);
