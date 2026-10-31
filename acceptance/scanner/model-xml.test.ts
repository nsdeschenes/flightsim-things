import {afterEach, beforeEach, expect, test} from 'bun:test';
import {rm, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

const successExitCode = 0;
const failureExitCode = 1;
const cliTimeout = 60_000;
let fixture: Awaited<ReturnType<typeof createFixture>>;
const airportXml = '<FSData><Airport ident="KAAA" name="Test airport"/></FSData>';
const unknownRoot = Buffer.from('<!-- unfinished model').toString('hex');
const invalidUtf8 = 'fffe80';
const utf16Model = Buffer.from(
  '<?xml version="1.0" encoding="UTF-16"?><ModelInfo><broken',
  'utf16le'
).toString('hex');

beforeEach(async () => {
  fixture = await createFixture();
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: successExitCode,
  });
});
afterEach(async () => {
  await fixture.dispose();
});

test.each([
  ['SimObjects/Landmarks/Tower/model/Tower.XML', unknownRoot],
  ['SimObjects/Landmarks/Tower/model.night/Tower.xml', invalidUtf8],
  ['scenery/custom-library/Tower.xml', utf16Model],
  ['scenery/custom-library/Tower.xml', unknownRoot],
])(
  'scan imports airports despite unreadable model XML at %s',
  async (filename, bytes) => {
    const root = await fixture.addon(
      'model-and-airport',
      {
        'AirportServices/KBBB/Services.xml': '<Service.Packages/>',
        'scenery/airport.xml': airportXml,
        'scenery/custom-library/Tower_LOD00.GLTF': '{}',
        [filename]: '',
      },
      'SCENERY'
    );
    await writeFile(path.join(root, filename), Buffer.from(bytes, 'hex'));
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stdout).toContain(
      'Scanned 1 packages, 0 aircraft, 2 airports, and 0 liveries. 0 packages failed.'
    );
    expect(
      fixture.query(
        "SELECT icao_code, coalesce(name, '') AS name FROM airports ORDER BY icao_code"
      )
    ).toEqual([
      {icao_code: 'KAAA', name: 'Test airport'},
      {icao_code: 'KBBB', name: ''},
    ]);
  },
  cliTimeout
);

async function addInvalidInputs(): Promise<void> {
  const inputs: readonly (readonly [string, string])[] = [
    ['scenery/airport.xml', Buffer.from('<FSData><Airport').toString('hex')],
    ['scenery/airport.xml', invalidUtf8],
    ['scenery/model/airport.xml', unknownRoot],
    ['scenery/library/Tower.xml', invalidUtf8],
    ['scenery/library/Tower.xml', unknownRoot],
    ['SimObjects/Landmarks/Tower/modelish/Tower.xml', unknownRoot],
    [
      'AirportServices/KBBB/Services.xml',
      Buffer.from('<Service.Packages><broken').toString('hex'),
    ],
    ['AirportServices/KBBB/Services.xml', invalidUtf8],
  ];
  for (const [index, input] of inputs.entries()) {
    const [filename, bytes] = input;
    const root = await fixture.addon(
      `invalid-${index}`,
      {
        'AirportServices/KBBB/Services.gltf': '{}',
        'scenery/library/Tower-other.gltf': '{}',
        'valid.xml': airportXml,
        [filename]: '',
      },
      'SCENERY'
    );
    await writeFile(path.join(root, filename), Buffer.from(bytes, 'hex'));
  }
}

test(
  'scan keeps malformed airport inputs and uncertain paths strict',
  async () => {
    await addInvalidInputs();
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toContain('8 packages failed');
    expect(result.stderr).toContain('XML Parse error:');
    expect(fixture.query('SELECT count(*) AS total FROM airports')).toEqual([{total: 0}]);
  },
  cliTimeout
);

async function addEscapedModels(): Promise<void> {
  const outside = path.join(fixture.home, 'outside.xml');
  await writeFile(outside, unknownRoot);
  const linked = await fixture.addon(
    'linked-model',
    {
      'scenery/Tower.gltf': '{}',
      'scenery/Tower.xml': '',
      'valid.xml': airportXml,
    },
    'SCENERY'
  );
  await rm(path.join(linked, 'scenery/Tower.xml'));
  await symlink(outside, path.join(linked, 'scenery/Tower.xml'));
  const unsafe = await fixture.addon('unsafe-model', {}, 'SCENERY');
  await writeFile(
    path.join(unsafe, 'layout.json'),
    JSON.stringify({content: [{path: '../Tower.xml'}, {path: '../Tower.gltf'}]})
  );
}

test(
  'model exclusions preserve layout and realpath boundary failures',
  async () => {
    await addEscapedModels();
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toContain('2 packages failed');
    expect(result.stderr).toContain('Metadata file escapes its package');
    expect(result.stderr).toContain('Unsafe layout path');
    expect(fixture.query('SELECT count(*) AS total FROM airports')).toEqual([{total: 0}]);
  },
  cliTimeout
);
