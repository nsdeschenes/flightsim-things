import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

const successExitCode = 0;
const failureExitCode = 1;
const cliTimeout = 60_000;
const aircraftPath = 'SimObjects/Airplanes/Base/aircraft.cfg';
const aircraftCfg = '[GENERAL]\nicao_model=Base\n[FLTSIM.0]\nui_variation=Factory\n';
const mixedFiles = {
  [aircraftPath]: aircraftCfg,
  'SimObjects/Airplanes/Native/livery.cfg': '[GENERAL]\nname=Native\n',
  'scenery/airport.xml': '<FSData><Airport ident="KAAA"/></FSData>',
  'scenery/world.bgl': 'compiled scenery',
};
let fixture: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  fixture = await createFixture();
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
});
afterEach(async () => {
  await fixture.dispose();
});

async function manifest(root: string, contentType: unknown): Promise<void> {
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({content_type: contentType, title: path.basename(root)})
  );
}

test(
  'CLI admits only manifest categories and retains metadata for unsupported types',
  async () => {
    for (const contentType of ['AIRCRAFT', 'LIVERY', 'SCENERY', 'MISC']) {
      await fixture.addon(contentType, mixedFiles, contentType);
    }

    for (const [name, fields] of [
      ['missing', {}],
      ['invalid', {content_type: {type: 'AIRCRAFT'}}],
      ['empty', {content_type: ''}],
    ] as const) {
      const root = await fixture.addon(name, mixedFiles);
      await writeFile(
        path.join(root, 'manifest.json'),
        JSON.stringify({title: name, ...fields})
      );
    }

    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stdout).toContain(
      'Scanned 7 packages, 1 aircraft, 1 airports, and 4 liveries. 0 packages failed. 0 warnings.'
    );
    expect(
      fixture.query(
        `SELECT p.title, (SELECT count(*) FROM aircraft WHERE package_id = p.id) AS aircraft,
         (SELECT count(*) FROM airports WHERE package_id = p.id) AS airports,
         (SELECT count(*) FROM liveries WHERE package_id = p.id) AS liveries
         FROM packages p ORDER BY p.title`
      )
    ).toEqual([
      {aircraft: 1, airports: 0, liveries: 2, title: 'AIRCRAFT'},
      {aircraft: 0, airports: 0, liveries: 2, title: 'LIVERY'},
      {aircraft: 0, airports: 0, liveries: 0, title: 'MISC'},
      {aircraft: 0, airports: 1, liveries: 0, title: 'SCENERY'},
      {aircraft: 0, airports: 0, liveries: 0, title: 'empty'},
      {aircraft: 0, airports: 0, liveries: 0, title: 'invalid'},
      {aircraft: 0, airports: 0, liveries: 0, title: 'missing'},
    ]);
  },
  cliTimeout
);

async function corruptPackages(): Promise<void> {
  await fixture.addon(
    'aircraft',
    {
      [aircraftPath]: aircraftCfg,
      'scenery/broken.xml': '<FSData><Airport',
      'scenery/world.bgl': 'compiled scenery',
    },
    'AIRCRAFT'
  );
  await fixture.addon(
    'livery',
    {
      'SimObjects/Airplanes/Native/livery.cfg': '[GENERAL]\nname=Native\n',
      'scenery/broken.xml': '<FSData><Airport',
    },
    'LIVERY'
  );
  await fixture.addon(
    'scenery',
    {
      [aircraftPath]: 'broken configuration',
      'scenery/airport.xml': '<FSData><Airport ident="KAAA"/></FSData>',
    },
    'SCENERY'
  );
  await fixture.addon(
    'misc',
    {
      [aircraftPath]: 'broken configuration',
      'scenery/broken.xml': '<FSData><Airport',
    },
    'MISC'
  );
}

test(
  'CLI ignores corrupt metadata outside the manifest category and limits BGL fallback to scenery',
  async () => {
    await corruptPackages();
    await fixture.addon(
      'vendor-airport-ksea-seattle',
      {'scenery/world.bgl': 'binary'},
      'SCENERY'
    );
    await fixture.addon(
      'vendor-airport-klax-losangeles',
      {'scenery/world.bgl': 'binary'},
      'AIRCRAFT'
    );
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stdout).toContain(
      'Scanned 6 packages, 1 aircraft, 2 airports, and 2 liveries. 0 packages failed. 0 warnings.'
    );
    expect(fixture.query('SELECT icao_code FROM airports ORDER BY icao_code')).toEqual([
      {icao_code: 'KAAA'},
      {icao_code: 'KSEA'},
    ]);
  },
  cliTimeout
);

function enrichAirport(): void {
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run("UPDATE airports SET latitude = 42 WHERE icao_code = 'KBBB'");
}

async function seedRescan(): Promise<
  Readonly<{
    airportIds: readonly unknown[];
    base: string;
    liveryIds: readonly unknown[];
    retained: string;
    scenery: string;
  }>
> {
  const base = await fixture.addon('base', {[aircraftPath]: aircraftCfg}, 'AIRCRAFT');
  const scenery = await fixture.addon(
    'scenery',
    {
      'scenery/airport.xml': '<FSData><Airport ident="KAAA"/></FSData>',
    },
    'SCENERY'
  );
  const retained = await fixture.addon(
    'retained',
    {
      'scenery/airport.xml': '<FSData><Airport ident="KBBB"/></FSData>',
    },
    'SCENERY'
  );
  await fixture.addon(
    'variant',
    {
      'SimObjects/Airplanes/Variant/aircraft.cfg':
        '[LIVERY]\nbase_container=..\\Base\n[FLTSIM.0]\nui_variation=Variant\n',
    },
    'LIVERY'
  );
  expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
  expect(
    fixture.query('SELECT count(*) AS total FROM liveries WHERE aircraft_id IS NOT NULL')
  ).toEqual([{total: 2}]);
  const liveryIds = fixture.query('SELECT id, source_key FROM liveries ORDER BY id');
  const airportIds = fixture.query("SELECT id FROM airports WHERE icao_code = 'KBBB'");
  enrichAirport();

  return {airportIds, base, liveryIds, retained, scenery};
}

function expectRetainedRows(prior: Awaited<ReturnType<typeof seedRescan>>): void {
  expect(fixture.query('SELECT count(*) AS total FROM aircraft')).toEqual([{total: 0}]);
  expect(fixture.query('SELECT id, source_key FROM liveries ORDER BY id')).toEqual([
    ...prior.liveryIds,
  ]);
  expect(
    fixture.query('SELECT count(*) AS total FROM liveries WHERE aircraft_id IS NOT NULL')
  ).toEqual([{total: 0}]);
  expect(fixture.query("SELECT id FROM airports WHERE icao_code = 'KBBB'")).toEqual([
    ...prior.airportIds,
  ]);
  expect(fixture.query('SELECT icao_code, latitude FROM airports')).toEqual([
    {icao_code: 'KBBB', latitude: 42},
  ]);
}

async function expectFailedPackagePreserved(
  base: string,
  retained: string
): Promise<void> {
  await manifest(base, 'MISC');
  await writeFile(path.join(retained, 'manifest.json'), '{invalid');
  const result = await fixture.run('scan');
  expect(result.exitCode).toBe(failureExitCode);
  expect(fixture.query('SELECT name FROM liveries')).toEqual([{name: 'Variant'}]);
  expect(fixture.query('SELECT icao_code, latitude FROM airports')).toEqual([
    {icao_code: 'KBBB', latitude: 42},
  ]);
}

test(
  'rescans remove disallowed rows and linked aircraft while preserving allowed IDs and enrichment',
  async () => {
    const prior = await seedRescan();
    await manifest(prior.base, 'LIVERY');
    await manifest(prior.scenery, 'MISC');
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expectRetainedRows(prior);
    await expectFailedPackagePreserved(prior.base, prior.retained);
  },
  cliTimeout
);
