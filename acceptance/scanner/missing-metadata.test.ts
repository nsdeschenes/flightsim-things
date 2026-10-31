import {afterEach, beforeEach, expect, test} from 'bun:test';
import {unlink} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

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
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'Scanned 2 packages, 1 aircraft, 1 airports, and 1 liveries. 0 packages failed. 1 warnings.'
    );
    expect(result.stderr).toContain(`Missing optional discovery metadata in ${filename}`);
    expect(result.stderr).toContain('coverage may be incomplete');
    expect(result.stderr).toContain(
      'Restore the file or correct layout.json and run scan again'
    );
    expect(result.stderr).not.toContain(fixture.home);
    expect(fixture.query('SELECT icao_code, name FROM airports')).toEqual([
      {icao_code: 'KAAA', name: 'Retained'},
    ]);
    expect(fixture.query('SELECT model FROM aircraft')).toEqual([{model: 'Base'}]);
  },
  cliTimeout
);

test.each(['manifest.json', 'layout.json', 'aircraft.cfg', 'livery.cfg'])(
  'missing required input %s rejects the affected package and imports unaffected packages',
  async filename => {
    const root = await fixture.addon(
      'required',
      {'aircraft.cfg': cfg, 'livery.cfg': '[LIVERY]\nbase_container=Base\n'},
      'AIRCRAFT'
    );
    await unlink(path.join(root, filename));
    const result = await fixture.run('scan');
    if (filename === 'manifest.json') {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('0 packages failed');
    } else {
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('1 packages failed');
      expect(result.stderr).toContain(`Missing required metadata in ${filename}`);
      expect(result.stderr).toContain(
        'Restore the file or correct layout.json and run scan again'
      );
    }
    expect(result.stdout).toContain('Scanned 1 packages, 1 aircraft');
    expect(result.stderr).not.toContain(fixture.home);
    expect(fixture.query('SELECT title FROM packages')).toEqual([{title: 'unaffected'}]);
    expect(fixture.query('SELECT model FROM aircraft')).toEqual([{model: 'Base'}]);
  },
  cliTimeout
);
