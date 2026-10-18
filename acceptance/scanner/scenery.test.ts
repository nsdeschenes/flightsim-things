import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

const successExitCode = 0;
const failureExitCode = 1;
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
  'unrelated malformed XML warns without rejecting aircraft or arbitrary airport XML for %s',
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
      'Scanned 2 packages, 1 aircraft, 1 airports, and 1 liveries. 0 packages failed. 1 warnings.'
    );
    expect(result.stderr).toContain('simobjects/airplanes/base/sound.xml');
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
