import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import path from 'node:path';

import {Option} from 'effect';

import createFixture from '#acceptance-scanner';

const cliTimeout = 60_000;
const invalidArgumentsExitCode = 252;
const noValue = Option.getOrNull(Option.none<string>());
const discoveryFlags: readonly string[] = ['--aircraft', 'A320', '--airline', 'BAW'];
let fixture: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  fixture = await createFixture();
});

afterEach(async () => {
  await fixture.dispose();
});

async function seedInventory(): Promise<void> {
  await fixture.addon(
    'aircraft',
    {
      'SimObjects/Airplanes/A320/aircraft.cfg':
        '[GENERAL]\nicao_type_designator=A320\nicao_model=A320\n[FLTSIM.0]\ntitle=Installed Airbus A320\nui_variation=BA livery\nicao_airline=BAW\nairline=British Airways\n',
    },
    'AIRCRAFT'
  );
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
  expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run(
    "INSERT INTO airports (package_id, source_key, icao_code, iata_code, name) VALUES (1, 'paris', 'LFPG', 'CDG', 'Paris'), (1, 'duplicate', 'LFPG', 'CDG', 'Duplicate Paris'), (1, 'departure', 'EGLL', 'LHR', 'London'), (1, 'unknown', NULL, NULL, 'Unknown')"
  );
  db.run(
    "INSERT INTO aircraft (package_id, source_key, name, icao_type_designator) VALUES (1, 'unrelated', 'Unrelated Boeing', 'B738')"
  );
  db.run("INSERT INTO airlines (icao_code, name) VALUES ('AFR', 'Unrelated airline')");
  db.run(
    "INSERT INTO liveries (package_id, source_key, name, aircraft_id, airline_id) VALUES (1, 'unresolved', 'Unresolved', NULL, 2), (1, 'duplicate', 'Duplicate BA', 1, 1)"
  );
  db.run(
    "INSERT INTO liveries (package_id, source_key, name, aircraft_id, airline_id) VALUES (1, 'excluded', 'Excluded Boeing AFR', 2, 2)"
  );
}

test(
  'CLI help documents both endpoint flags and excludes the retired command',
  async () => {
    const help = await fixture.run('find-flight', '--help');
    expect(help).toMatchObject({exitCode: 0, stderr: ''});
    for (const text of [
      '--dep',
      'Departure ICAO or IATA code',
      '--arr',
      'Destination ICAO or IATA code',
      'Specify --dep, --arr, or both.',
      '--aircraft',
      'Aircraft ICAO type designator',
      '--airline',
      'Airline ICAO code',
    ]) {
      expect(help.stdout).toContain(text);
    }

    const rootHelp = await fixture.run('--help');
    expect(rootHelp).toMatchObject({exitCode: 0, stderr: ''});
    expect(rootHelp.stdout).not.toContain('find-flight-to');
  },
  cliTimeout
);

test(
  'CLI requires endpoint or discovery selectors before database access or configuration',
  async () => {
    expect(await fixture.run('find-flight')).toEqual({
      exitCode: 1,
      stderr:
        'Command failed, Specify --dep, --arr, or both, or supply both --aircraft and --airline.\n',
      stdout: '',
    });
    expect(
      await Bun.file(path.join(fixture.home, '.flightsim-things/addons.sqlite')).exists()
    ).toBe(false);
    expect(
      await Bun.file(path.join(fixture.home, '.flightsim-things/config.json')).exists()
    ).toBe(false);
  },
  cliTimeout
);

test.each(['--dep', '--arr'])(
  'CLI rejects %s without an airport value',
  async flag => {
    const result = await fixture.run('find-flight', flag);
    expect(result.exitCode).toBe(invalidArgumentsExitCode);
    expect(result.stderr).toContain(flag);
  },
  cliTimeout
);

test(
  'CLI rejects the retired positional airport form',
  async () => {
    const result = await fixture.run('find-flight', 'EGLL');
    expect(result.exitCode).toBe(invalidArgumentsExitCode);
    expect(result.stderr).toContain('EGLL');
  },
  cliTimeout
);

test.each([
  {args: ['--aircraft', 'A320'], label: 'airline'},
  {args: ['--airline', 'BAW'], label: 'aircraft'},
])(
  'discovery requires its missing $label filter before database access',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    expect(await fixture.run('find-flight', ...args)).toEqual({
      exitCode: 1,
      stderr:
        'Command failed, Specify --dep, --arr, or both, or supply both --aircraft and --airline.\n',
      stdout: '',
    });
    expect(
      await Bun.file(path.join(fixture.home, '.flightsim-things/addons.sqlite')).exists()
    ).toBe(false);
    expect(
      await Bun.file(path.join(fixture.home, '.flightsim-things/config.json')).exists()
    ).toBe(false);
  },
  cliTimeout
);

test.each([
  {args: ['--aircraft', ' ', '--airline', 'BAW'], flag: 'aircraft'},
  {args: ['--aircraft', 'A320', '--airline', ' '], flag: 'airline'},
  {args: ['--dep', 'EGLL', '--aircraft', ' '], flag: 'aircraft'},
  {args: ['--arr', 'LFPG', '--airline', ' '], flag: 'airline'},
])(
  'an explicitly blank $flag filter fails before database access',
  async ({args, flag}: Readonly<{args: readonly string[]; flag: string}>) => {
    expect(await fixture.run('find-flight', ...args)).toEqual({
      exitCode: 1,
      stderr: `Command failed, Enter a non-empty ${flag} ICAO code for --${flag}.\n`,
      stdout: '',
    });
    expect(
      await Bun.file(path.join(fixture.home, '.flightsim-things/addons.sqlite')).exists()
    ).toBe(false);
    expect(
      await Bun.file(path.join(fixture.home, '.flightsim-things/config.json')).exists()
    ).toBe(false);
  },
  cliTimeout
);

test.each([
  {args: ['--aircraft', 'A320', '--airline', 'AFR']},
  {args: ['--aircraft', 'B738', '--airline', 'BAW']},
  {args: ['--aircraft', 'Airbus A320', '--airline', 'BAW']},
  {args: ['--aircraft', 'A320', '--airline', 'BA']},
  {args: ['--dep', 'EGLL', '--aircraft', 'B739']},
  {args: ['--arr', 'LFPG', '--airline', 'ZZZ']},
])(
  'unmatched ICAO filters fail before AI configuration $args',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    await seedInventory();
    const result = await fixture.run('find-flight', ...args);
    expect(result).toEqual({
      exitCode: 1,
      stderr:
        'Command failed, No saved liveries match the requested aircraft and airline ICAO filters. Install matching aircraft and airline liveries, then run scan.\n',
      stdout: '',
    });
  },
  cliTimeout
);

test.each(['empty', 'unidentified', 'aliases'])(
  'discovery requires two distinct identified airports with %s inventory',
  async scenario => {
    await seedInventory();
    using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
    if (scenario === 'empty') {
      db.run('DELETE FROM airports');
    } else if (scenario === 'unidentified') {
      db.run('UPDATE airports SET icao_code = NULL, iata_code = NULL');
    } else {
      db.run('DELETE FROM airports WHERE id = 3');
    }

    expect(await fixture.run('find-flight', ...discoveryFlags)).toEqual({
      exitCode: 1,
      stderr:
        'Command failed, At least two distinct identified airports must be saved. Run scan and airports enrich to populate airport codes.\n',
      stdout: '',
    });
  },
  cliTimeout
);

test.each([
  {
    order: 'middle',
    rows: [
      {iata: 'CDG', icao: noValue},
      {iata: 'CDG', icao: 'LFPG'},
      {iata: noValue, icao: 'LFPG'},
    ],
  },
  {
    order: 'last',
    rows: [
      {iata: 'CDG', icao: noValue},
      {iata: noValue, icao: 'LFPG'},
      {iata: 'CDG', icao: 'LFPG'},
    ],
  },
])(
  'discovery merges airport identities when the alias bridge is $order',
  async ({
    rows,
  }: Readonly<{
    rows: readonly Readonly<{iata: string | null; icao: string | null}>[];
  }>) => {
    await seedInventory();
    using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
    db.run('DELETE FROM airports');
    for (const [index, row] of rows.entries()) {
      db.run(
        'INSERT INTO airports (package_id, source_key, icao_code, iata_code, name) VALUES (1, ?, ?, ?, ?)',
        [`alias-${index}`, row.icao, row.iata, 'Paris']
      );
    }

    expect(await fixture.run('find-flight', ...discoveryFlags)).toEqual({
      exitCode: 1,
      stderr:
        'Command failed, At least two distinct identified airports must be saved. Run scan and airports enrich to populate airport codes.\n',
      stdout: '',
    });
  },
  cliTimeout
);
