import {expect, test} from 'bun:test';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import packageReader from './package.ts';

type SceneryCase = Readonly<{
  name: string;
  files: Readonly<Record<string, string>>;
  compiled: boolean;
  airports: readonly string[];
  skipped: readonly string[];
}>;
const sceneryCases: readonly SceneryCase[] = [
  {
    airports: [],
    compiled: true,
    files: {'world.bgl': 'compiled'},
    name: 'compiled',
    skipped: [],
  },
  {
    airports: ['KAAA'],
    compiled: true,
    files: {'world.bgl': 'compiled'},
    name: 'vendor-airport-kaaa-fallback',
    skipped: [],
  },
  {
    airports: ['KBBB'],
    compiled: true,
    files: {
      'Sound.xml': '<Sound><broken',
      'airport.xml': '<FSData><Airport ident="KBBB"/></FSData>',
      'world.bgl': 'compiled',
    },
    name: 'xml',
    skipped: ['Sound.xml'],
  },
  {
    airports: ['KCCC'],
    compiled: true,
    files: {'AirportServices/KCCC/Services.spb': 'compiled', 'world.bgl': 'compiled'},
    name: 'services',
    skipped: [],
  },
  {
    airports: ['KDDD'],
    compiled: false,
    files: {'airport.xml': '<FSData><Airport ident="KDDD"/></FSData>'},
    name: 'metadata-only',
    skipped: [],
  },
];

async function writeSceneryPackage(root: string, input: SceneryCase): Promise<void> {
  await mkdir(root);
  await writeFile(
    path.join(root, 'manifest.json'),
    JSON.stringify({content_type: 'SCENERY'})
  );
  await writeFile(
    path.join(root, 'layout.json'),
    JSON.stringify({content: Object.keys(input.files).map(file => ({path: file}))})
  );
  for (const [file, contents] of Object.entries(input.files)) {
    await mkdir(path.dirname(path.join(root, file)), {recursive: true});
    await writeFile(path.join(root, file), contents);
  }
}

test.each([...sceneryCases])(
  'package facts keep discoveries independent of compiled coverage for $name',
  async (input: SceneryCase) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'flightsim-package-'));
    const root = path.join(directory, input.name);
    try {
      await writeSceneryPackage(root, input);
      const result = await packageReader.read(root);
      expect(result).toMatchObject({
        snapshot: {
          airports: input.airports.map(icaoCode => ({icaoCode})),
          hasCompiledScenery: input.compiled,
          skippedXmlFiles: input.skipped,
          warnings: [],
        },
        status: 'success',
      });
    } finally {
      await rm(directory, {force: true, recursive: true});
    }
  }
);

test('package root resolution failures retain local paths only in the CLI message', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flightsim-package-'));
  const sourcePath = path.join(root, 'alias');
  await symlink(path.join(root, 'private-target'), sourcePath);
  try {
    const result = await packageReader.read(sourcePath);
    expect(result).toMatchObject({
      diagnosticMessage: 'ENOENT',
      sourcePath,
      status: 'failure',
    });
    if (result.status === 'failure') {
      expect(result.message).toContain(sourcePath);
    }
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('a missing manifest rejects a direct package read with a safe repair instruction', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flightsim-package-'));
  await writeFile(path.join(root, 'layout.json'), JSON.stringify({content: []}));
  try {
    const result = await packageReader.read(root);
    expect(result).toMatchObject({
      diagnosticMessage:
        'Missing required metadata in manifest.json; package skipped. Restore the file or repair the package installation and run scan again.',
      status: 'failure',
    });
    if (result.status === 'failure') {
      expect(result.message).toBe(result.diagnosticMessage);
      expect(result.message).not.toContain(root);
    }
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});
