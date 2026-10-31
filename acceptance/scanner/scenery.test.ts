import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

const successExitCode = 0;
const failureExitCode = 1;
const singleNotice = 1;
const location = {elevationMeters: 35.5, latitude: -33.946111, longitude: 151.177222};

let fixture: Awaited<ReturnType<typeof createFixture>>;
const cliTimeout = 60_000;
const cfg = '[GENERAL]\nicao_model=Base\n[FLTSIM.0]\nui_variation=Factory\n';

beforeEach(async () => {
  fixture = await createFixture();
});
afterEach(async () => {
  await fixture.dispose();
});

async function seedCoveragePackages(): Promise<void> {
  await fixture.addon('compiled-only', {'world.bgl': 'compiled'}, 'SCENERY');
  await fixture.addon(
    'vendor-airport-kbbb-fallback',
    {'world.bgl': 'compiled'},
    'SCENERY'
  );
  await fixture.addon(
    'explicit',
    {
      'Sound.xml': '<Sound><broken',
      'airport.xml': '<FSData><Airport ident="KAAA"/></FSData>',
      'world.bgl': 'compiled',
    },
    'SCENERY'
  );
  await fixture.addon(
    'services',
    {
      'AirportServices/KCCC/Services.spb': 'compiled',
      'world.bgl': 'compiled',
    },
    'SCENERY'
  );
  await fixture.addon(
    'rejected',
    {
      'airport.xml': '<FSData><Airport',
      'world.bgl': 'compiled',
    },
    'SCENERY'
  );
}

function verifyCoverageOutput(result: Awaited<ReturnType<typeof fixture.run>>): void {
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stdout).toContain(
    'Scanned 4 packages, 0 aircraft, 3 airports, and 0 liveries. 1 packages failed. 0 warnings.'
  );
  expect(result.stdout.match(/Airport coverage may be incomplete/gu)).toHaveLength(
    singleNotice
  );
  expect(result.stdout).toContain(
    '4 packages with compiled scenery. BGL content is not decoded, even when XML, AirportServices, or package-name fallback discovers airports.'
  );
  expect(result.stdout).toContain('Skipped 1 unrelated XML files in imported packages.');
  expect(result.stderr).toContain('Skipped rejected:');
  expect(result.stderr).not.toContain('Warning for');
  expect(result.stderr).not.toContain('Sound.xml');
}

test(
  'compiled coverage is summarized independently of discoveries, XML skips, and rejected packages',
  async () => {
    await seedCoveragePackages();
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: successExitCode,
    });
    const result = await fixture.run('scan');
    verifyCoverageOutput(result);
    expect(fixture.query('SELECT icao_code FROM airports ORDER BY icao_code')).toEqual([
      {icao_code: 'KAAA'},
      {icao_code: 'KBBB'},
      {icao_code: 'KCCC'},
    ]);
  },
  cliTimeout
);

function enrichAirportLocation(): void {
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run('UPDATE airports SET elevation_meters = ?, latitude = ?, longitude = ?', [
    location.elevationMeters,
    location.latitude,
    location.longitude,
  ]);
}

test(
  'airport rescans update metadata while preserving identity and enriched locations',
  async () => {
    const root = await fixture.addon(
      'airport',
      {
        'airport.xml':
          '<FSData><Airport ident="KAAA" name="Original" iata="AAA"/></FSData>',
      },
      'SCENERY'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(
      JSON.parse('[{"elevation_meters":null,"latitude":null,"longitude":null}]')
    ).toEqual(
      fixture.query('SELECT elevation_meters, latitude, longitude FROM airports')
    );
    const identity = fixture.query('SELECT id, package_id, source_key FROM airports');
    enrichAirportLocation();
    await writeFile(
      path.join(root, 'airport.xml'),
      '<FSData><Airport ident="KAAA" name="Updated" iata="BBB"/></FSData>'
    );
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(fixture.query('SELECT id, package_id, source_key FROM airports')).toEqual(
      identity
    );
    expect(
      fixture.query(
        'SELECT name, icao_code, iata_code, elevation_meters, latitude, longitude FROM airports'
      )
    ).toEqual([
      {
        elevation_meters: 35.5,
        iata_code: 'BBB',
        icao_code: 'KAAA',
        latitude: -33.946111,
        longitude: 151.177222,
        name: 'Updated',
      },
    ]);
  },
  cliTimeout
);

test.each(['<Sound><broken'])(
  'unrelated malformed XML is summarized without rejecting aircraft or arbitrary airport XML for %s',
  async xml => {
    await fixture.addon(
      'aircraft',
      {
        'SimObjects/Airplanes/Base/aircraft.cfg': cfg,
      },
      'AIRCRAFT'
    );
    await fixture.addon(
      'scenery',
      {
        'SimObjects/Airplanes/Base/sound.xml': xml,
        'arbitrary/location.xml': '<FSData><Airport ident="KAAA"/></FSData>',
      },
      'SCENERY'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stdout).toContain(
      'Scanned 2 packages, 1 aircraft, 1 airports, and 1 liveries. 0 packages failed. 0 warnings.'
    );
    expect(result.stdout).toContain(
      'Skipped 1 unrelated XML files in imported packages.'
    );
    expect(result.stderr).toBe('');
    expect(fixture.query('SELECT icao_code FROM airports')).toEqual([
      {icao_code: 'KAAA'},
    ]);
    expect(
      fixture.query(
        'SELECT count(*) AS linked FROM liveries WHERE aircraft_id IS NOT NULL'
      )
    ).toEqual([{linked: 1}]);
  },
  cliTimeout
);

test.each([['malformed-airport', 'arbitrary.xml', '<FSData><Airport']])(
  'airport corruption and uncertain XML remain package failures for %s',
  async (name, filename, xml) => {
    await fixture.addon(
      name,
      {
        [filename]: xml,
      },
      'SCENERY'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toContain('Scanned 0 packages');
    expect(result.stdout).toContain('1 packages failed');
    expect(fixture.query('SELECT count(*) AS total FROM packages')).toEqual([{total: 0}]);
  },
  cliTimeout
);

test(
  'native parsing accepts UTF-16 airports and malformed UTF-16 remains strict',
  async () => {
    const root = await fixture.addon('utf16', {'arbitrary.xml': ''}, 'SCENERY');
    const filename = path.join(root, 'arbitrary.xml');
    await writeFile(
      filename,
      Buffer.from('\uFEFF<FSData><Airport ident="KAAA"/></FSData>', 'utf16le')
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(fixture.query('SELECT icao_code FROM airports')).toEqual([
      {icao_code: 'KAAA'},
    ]);
    await writeFile(filename, Buffer.from('\uFEFF<Sound><broken', 'utf16le'));
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toContain('Scanned 0 packages');
  },
  cliTimeout
);

test(
  'regular file symlinks are ignored during package discovery',
  async () => {
    await fixture.addon('valid', {'aircraft.cfg': cfg}, 'AIRCRAFT');
    const filename = path.join(fixture.community, 'readme.txt');
    await writeFile(filename, 'readme');
    await symlink(filename, path.join(fixture.community, 'readme-link'), 'file');
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stdout).toContain('Scanned 1 packages');
    expect(result.stdout).toContain('0 packages failed');
  },
  cliTimeout
);
