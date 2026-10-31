import {afterEach, beforeEach, expect, test} from 'bun:test';
import {unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

const successExitCode = 0;
const failureExitCode = 1;
const cliTimeout = 60_000;
const cfg = '[GENERAL]\nicao_model=Base\n[FLTSIM.0]\nui_variation=Factory\n';
let fixture: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  fixture = await createFixture();
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
  await fixture.addon('unaffected', {'aircraft.cfg': cfg}, 'AIRCRAFT');
});
afterEach(async () => {
  await fixture.dispose();
});

function verifyMissingDiagnostic(
  stderr: string,
  kind: 'required' | 'optional discovery',
  filename: string
): void {
  expect(stderr).toContain(`Missing ${kind} metadata in ${filename}`);
  expect(stderr).toContain('run scan again');
  expect(stderr).not.toContain(fixture.home);
}

test.each([
  'AirportServices/KBBB/Services.xml',
  'AirportServices/KBBB/Services.spb',
  'discovery.xml',
  'SimObjects/Airplanes/Base/model/model.xml',
])(
  'missing optional discovery input %s retains usable metadata without inventing airports',
  async filename => {
    const root = await fixture.addon(
      'partial',
      {
        [filename]: '<Services/>',
        'airport.xml': '<FSData><Airport ident="KAAA" name="Retained"/></FSData>',
      },
      'SCENERY'
    );
    await unlink(path.join(root, filename));
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stdout).toContain(
      'Scanned 2 packages, 1 aircraft, 1 airports, and 1 liveries. 0 packages failed. 1 warnings.'
    );
    verifyMissingDiagnostic(result.stderr, 'optional discovery', filename);
    expect(result.stderr).toContain('Restore the file or correct layout.json');
    expect(result.stderr).toContain('coverage may be incomplete');
    expect(fixture.query('SELECT icao_code, name FROM airports')).toEqual([
      {icao_code: 'KAAA', name: 'Retained'},
    ]);
    expect(fixture.query('SELECT model FROM aircraft')).toEqual([{model: 'Base'}]);
  },
  cliTimeout
);

const servicesFilename = 'AirportServices/KBBB/Services.xml';
const airportIdentityQuery =
  "SELECT id, package_id, source_key, icao_code FROM airports WHERE icao_code = 'KBBB'";

async function importedAirportSources(): Promise<string> {
  const root = await fixture.addon(
    'partial',
    {
      [servicesFilename]: '<Services/>',
      'airport.xml': '<FSData><Airport ident="KAAA" name="Original"/></FSData>',
    },
    'SCENERY'
  );
  expect(await fixture.run('scan')).toMatchObject({exitCode: successExitCode});
  expect(fixture.query('SELECT icao_code FROM airports ORDER BY icao_code')).toEqual([
    {icao_code: 'KAAA'},
    {icao_code: 'KBBB'},
  ]);
  return root;
}

test(
  'an incomplete rescan retains prior explicit airports and updates readable sources',
  async () => {
    const root = await importedAirportSources();
    const prior = fixture.query(airportIdentityQuery);
    await unlink(path.join(root, servicesFilename));
    await writeFile(
      path.join(root, 'airport.xml'),
      '<FSData><Airport ident="KAAA" name="Updated"/></FSData>'
    );
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    verifyMissingDiagnostic(result.stderr, 'optional discovery', servicesFilename);
    expect(result.stderr).toContain('coverage may be incomplete');
    expect(fixture.query(airportIdentityQuery)).toEqual(prior);
    expect(fixture.query("SELECT name FROM airports WHERE icao_code = 'KAAA'")).toEqual([
      {name: 'Updated'},
    ]);
  },
  cliTimeout
);

test.each(['layout.json', 'aircraft.cfg', 'livery.cfg'])(
  'missing required input %s rejects the affected package and imports unaffected packages',
  async filename => {
    const root = await fixture.addon(
      'required',
      {'aircraft.cfg': cfg, 'livery.cfg': '[LIVERY]\nbase_container=Base\n'},
      'AIRCRAFT'
    );
    await unlink(path.join(root, filename));
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toContain('1 packages failed');
    verifyMissingDiagnostic(result.stderr, 'required', filename);
    expect(result.stderr).toContain(
      'Restore the file or repair the package installation'
    );
    expect(result.stdout).toContain('Scanned 1 packages, 1 aircraft');
    expect(fixture.query('SELECT title FROM packages')).toEqual([{title: 'unaffected'}]);
    expect(fixture.query('SELECT model FROM aircraft')).toEqual([{model: 'Base'}]);
  },
  cliTimeout
);

test(
  'directories without a manifest remain outside package discovery',
  async () => {
    const root = await fixture.addon('unidentified', {}, 'SCENERY');
    await unlink(path.join(root, 'manifest.json'));
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stdout).toContain(
      'Scanned 1 packages, 1 aircraft, 0 airports, and 1 liveries. 0 packages failed. 0 warnings.'
    );
    expect(fixture.query('SELECT title FROM packages')).toEqual([{title: 'unaffected'}]);
  },
  cliTimeout
);
