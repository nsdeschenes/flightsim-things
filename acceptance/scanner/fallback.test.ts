import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {symlink} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

const cliTimeout = 60_000;
const successExitCode = 0;
const failureExitCode = 1;
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

async function invalidNames(): Promise<void> {
  for (const name of [
    'vendor-airport-abc-short',
    'vendor-airport-abcde-long',
    '-airport-kaaa-name',
    'vendor-airport-kaaa-',
    'vendor-kaaa-name',
  ]) {
    await fixture.addon(name, {'scenery/world.bgl': 'compiled'});
  }

  await fixture.addon('vendor-airport-kbbb-no-bgl', {});
}

async function candidatePackages(): Promise<void> {
  await fixture.addon('amsim-airport-lpma-madeira', {'scenery/world.bgl': 'compiled'});
  await fixture.addon('asianairports-airport-rkss-gimpo', {
    'scenery/world.bgl': 'compiled',
  });
  const linked = await fixture.addon('unmatched-target', {
    'scenery/world.bgl': 'compiled',
  });
  await symlink(linked, path.join(fixture.community, 'vendor-name-airport-lfmn-nice'));
  await invalidNames();
  await fixture.addon('vendor-airport-kccc-explicit', {
    'arbitrary/metadata.xml': '<FSData><Airport ident="KDDD" name="Explicit"/></FSData>',
    'scenery/world.bgl': 'compiled',
  });
  await fixture.addon('vendor-airport-keee-services', {
    'AirportServices/KFFF/Services.spb': 'compiled services',
    'scenery/world.bgl': 'compiled',
  });
  await fixture.addon('vendor-airport-kggg-broken', {
    'airport.xml': '<FSData><Airport',
    'scenery/world.bgl': 'compiled',
  });
}

test(
  'compiled packages infer only narrow directory codes while explicit airports and failures win',
  async () => {
    await candidatePackages();
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toContain('5 airports');
    expect(result.stdout).toContain('1 packages failed');
    const expected: unknown = JSON.parse(`[
      {"iata_code":null,"icao_code":"KDDD","latitude":null,"name":"Explicit"},
      {"iata_code":null,"icao_code":"KFFF","latitude":null,"name":null},
      {"iata_code":null,"icao_code":"LFMN","latitude":null,"name":null},
      {"iata_code":null,"icao_code":"LPMA","latitude":null,"name":null},
      {"iata_code":null,"icao_code":"RKSS","latitude":null,"name":null}
    ]`);
    expect(expected).toEqual(
      fixture.query(
        'SELECT icao_code, name, iata_code, latitude FROM airports ORDER BY icao_code'
      )
    );
    expect(result.stderr).toContain('vendor-airport-kggg-broken');
  },
  cliTimeout
);

async function initialFallbacks(): Promise<void> {
  await fixture.addon('amsim-airport-lpma-madeira', {'scenery/world.bgl': 'compiled'});
  await fixture.addon('vendor-airport-kbbb-changed', {'scenery/world.bgl': 'compiled'});
  await fixture.addon('vendor-airport-kccc-removed', {'scenery/world.bgl': 'compiled'});
  await fixture.addon('ordinary', {
    'airport.xml': '<FSData><Airport ident="KDDD"/></FSData>',
  });
  expect(await fixture.run('scan')).toMatchObject({exitCode: successExitCode});
}

async function enrichedFallbackRescan(identity: readonly unknown[]): Promise<void> {
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run(
    "UPDATE airports SET name = 'Enriched', iata_code = 'FNC', elevation_meters = 59, latitude = 32.7, longitude = -16.8 WHERE icao_code = 'LPMA'"
  );
  expect(await fixture.run('scan')).toMatchObject({exitCode: successExitCode});
  expect(identity).toEqual(
    fixture.query("SELECT id, package_id FROM airports WHERE icao_code = 'LPMA'")
  );
  expect(
    fixture.query("SELECT name, iata_code FROM airports WHERE icao_code = 'LPMA'")
  ).toEqual([{iata_code: 'FNC', name: 'Enriched'}]);
}

async function replaceFallbacks(): Promise<void> {
  await fixture.addon('amsim-airport-lpma-madeira', {
    'airport.xml': '<FSData><Airport ident="LPMA"/></FSData>',
  });
  await fixture.addon('vendor-airport-kbbb-changed', {
    'airport.xml': '<FSData><Airport ident="KEEE" name="Changed"/></FSData>',
  });
  await fixture.addon('vendor-airport-kccc-removed', {});
  await fixture.addon('ordinary', {});
}

function verifyPromotedAirports(identity: readonly unknown[]): void {
  expect(identity).toEqual(
    fixture.query("SELECT id, package_id FROM airports WHERE icao_code = 'LPMA'")
  );
  const expected: unknown = JSON.parse(`[
    {"elevation_meters":null,"iata_code":null,"icao_code":"KDDD","latitude":null,"longitude":null,"name":null},
    {"elevation_meters":null,"iata_code":null,"icao_code":"KEEE","latitude":null,"longitude":null,"name":"Changed"},
    {"elevation_meters":59,"iata_code":null,"icao_code":"LPMA","latitude":32.7,"longitude":-16.8,"name":null}
  ]`);
  expect(expected).toEqual(
    fixture.query(
      'SELECT icao_code, name, iata_code, elevation_meters, latitude, longitude FROM airports ORDER BY icao_code'
    )
  );
  expect(
    fixture.query("SELECT source_key FROM airports WHERE icao_code = 'LPMA'")
  ).toEqual([{source_key: 'airport.xml#airport:LPMA'}]);
}

test(
  'rescans promote same-code fallback with enrichment and retire only stale inferred airports',
  async () => {
    await initialFallbacks();
    const identity = fixture.query(
      "SELECT id, package_id FROM airports WHERE icao_code = 'LPMA'"
    );
    await enrichedFallbackRescan(identity);
    await replaceFallbacks();
    expect(await fixture.run('scan')).toMatchObject({exitCode: successExitCode});
    verifyPromotedAirports(identity);
    expect(await fixture.run('scan')).toMatchObject({exitCode: successExitCode});
    verifyPromotedAirports(identity);
    expect(fixture.query('SELECT count(*) AS total FROM airports')).toEqual([{total: 3}]);
  },
  cliTimeout
);

async function retainedExplicitPackages(): Promise<void> {
  await fixture.addon('vendor-airport-kaaa-retained', {
    'airport.xml': '<FSData><Airport ident="KBBB"/></FSData>',
    'world.bgl': 'compiled',
  });
  await fixture.addon('vendor-airport-kaaa-independent', {'world.bgl': 'compiled'});
  expect(await fixture.run('scan')).toMatchObject({exitCode: successExitCode});
  await fixture.addon('vendor-airport-kaaa-retained', {'world.bgl': 'compiled'});
}

function addPollutedFallback(): void {
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run(`INSERT INTO airports (package_id, source_key, icao_code)
    SELECT id, '#package-name-airport', 'KAAA' FROM packages
    WHERE title = 'vendor-airport-kaaa-retained'`);
}

function verifyRetainedExplicit(): void {
  expect(
    fixture.query(`SELECT source_key, icao_code FROM airports
    JOIN packages ON packages.id = airports.package_id
    WHERE title = 'vendor-airport-kaaa-retained'`)
  ).toEqual([{icao_code: 'KBBB', source_key: 'airport.xml#airport:KBBB'}]);
  expect(
    fixture.query(`SELECT source_key, icao_code FROM airports
    JOIN packages ON packages.id = airports.package_id
    WHERE title = 'vendor-airport-kaaa-independent'`)
  ).toEqual([{icao_code: 'KAAA', source_key: '#package-name-airport'}]);
}

test(
  'stored explicit airports suppress later fallback and repair coexistence within their package',
  async () => {
    await retainedExplicitPackages();
    expect(await fixture.run('scan')).toMatchObject({exitCode: successExitCode});
    verifyRetainedExplicit();
    addPollutedFallback();
    expect(await fixture.run('scan')).toMatchObject({exitCode: successExitCode});
    verifyRetainedExplicit();
  },
  cliTimeout
);
