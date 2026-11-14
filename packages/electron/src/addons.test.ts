import {mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {expect, test} from 'vitest';

import {openDatabase} from '@flightsim-things/db';

import {createAddonLibrary, parseCommunityPath, parseSimulator} from './addons.js';

async function writePackage(root: string, folder: string, title: string) {
  const directory = join(root, folder);
  await mkdir(directory, {recursive: true});
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({
      title,
      creator: 'Test Creator',
      package_version: '1.2.3',
      content_type: 'AIRCRAFT',
      dependencies: [{name: 'base-package', package_version: '1.0.0'}],
    })
  );
  return directory;
}

test('scans real packages and links, persists metadata and reconciles each simulator independently', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-addons-'));
  const community = join(directory, 'Community');
  const communityLink = join(directory, 'Community-linked');
  const databasePath = join(directory, 'inventory.sqlite');
  let database;
  try {
    await mkdir(community);
    await symlink(
      community,
      communityLink,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await writePackage(community, 'aircraft', 'Sample Aircraft');
    const linked = await writePackage(directory, 'linked-airport', 'Linked Airport');
    await symlink(
      linked,
      join(community, 'airport-link'),
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    await mkdir(join(community, 'broken'));
    await writeFile(join(community, 'broken', 'manifest.json'), '{');
    await mkdir(join(community, 'missing-manifest'));
    await mkdir(join(community, 'invalid-manifest'));
    await writeFile(join(community, 'invalid-manifest', 'manifest.json'), '[]');
    await mkdir(join(community, 'missing-title'));
    await writeFile(join(community, 'missing-title', 'manifest.json'), '{}');
    await writeFile(join(community, 'readme.txt'), 'Not a package');
    database = await openDatabase(databasePath);
    const library = createAddonLibrary(database);
    await library.saveCommunityPath('msfs2020', community);
    await library.saveCommunityPath('msfs2024', communityLink);
    const first = await library.scan('msfs2020');
    expect(first.inventory.addons).toEqual([
      {
        simulator: 'msfs2020',
        folderName: 'airport-link',
        folderPath: join(community, 'airport-link'),
        name: 'Linked Airport',
        version: '1.2.3',
        creator: 'Test Creator',
        contentType: 'AIRCRAFT',
        manifestJson: await readFile(join(linked, 'manifest.json'), 'utf8'),
      },
      {
        simulator: 'msfs2020',
        folderName: 'aircraft',
        folderPath: join(community, 'aircraft'),
        name: 'Sample Aircraft',
        version: '1.2.3',
        creator: 'Test Creator',
        contentType: 'AIRCRAFT',
        manifestJson: await readFile(
          join(community, 'aircraft', 'manifest.json'),
          'utf8'
        ),
      },
    ]);
    expect(first.warnings.map(warning => warning.folderName)).toEqual([
      'broken',
      'invalid-manifest',
      'missing-manifest',
      'missing-title',
    ]);
    expect(first.inventory.scannedPath).toBe(community);
    expect(first.inventory.scannedAt).toEqual(expect.any(String));
    expect((await library.scan('msfs2020')).inventory.addons).toEqual(
      first.inventory.addons
    );
    await library.scan('msfs2024');
    await rm(join(community, 'airport-link'));
    await writePackage(community, 'aircraft', 'Updated Aircraft');
    await library.scan('msfs2020');
    database.close();
    database = await openDatabase(databasePath);
    const [msfs2020, msfs2024] = await database.getLibrary();
    expect(msfs2020.communityPath).toBe(community);
    expect(msfs2024.communityPath).toBe(communityLink);
    expect(msfs2020.addons.map(addon => addon.name)).toEqual(['Updated Aircraft']);
    expect(msfs2024.addons.map(addon => addon.name)).toEqual([
      'Linked Airport',
      'Sample Aircraft',
    ]);
    expect(JSON.parse(msfs2020.addons[0].manifestJson).dependencies).toEqual([
      {name: 'base-package', package_version: '1.0.0'},
    ]);
    await rm(join(community, 'aircraft'), {recursive: true});
    const empty = await createAddonLibrary(database).scan('msfs2020');
    expect(empty.inventory.addons).toEqual([]);
    expect(
      (await database.getInventory('msfs2024')).addons.map(addon => addon.name)
    ).toEqual(['Linked Airport', 'Sample Aircraft']);
  } finally {
    database?.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('failed scans and database writes preserve the previous inventory, and queued operations recover', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-scan-failure-'));
  const community = join(directory, 'Community');
  const database = await openDatabase(join(directory, 'inventory.sqlite'));
  try {
    await writePackage(community, 'aircraft', 'Saved Aircraft');
    const library = createAddonLibrary(database);
    await expect(library.scan('msfs2020')).rejects.toThrow(
      'Save a Community folder path'
    );
    await library.saveCommunityPath('msfs2020', community);
    const {inventory: previous} = await library.scan('msfs2020');
    await expect(
      database.replaceInventory('msfs2020', community, [
        previous.addons[0],
        previous.addons[0],
      ])
    ).rejects.toThrow();
    expect(await database.getInventory('msfs2020')).toEqual(previous);
    const missing = join(directory, 'missing');
    await library.saveCommunityPath('msfs2020', missing);
    await expect(library.scan('msfs2020')).rejects.toThrow(
      'Could not read Community folder'
    );
    expect(await database.getInventory('msfs2020')).toEqual({
      ...previous,
      communityPath: missing,
    });
    await writeFile(join(directory, 'not-a-directory'), 'file');
    await library.saveCommunityPath('msfs2020', join(directory, 'not-a-directory'));
    await expect(library.scan('msfs2020')).rejects.toThrow(
      'Could not read Community folder'
    );
    const save = library.saveCommunityPath('msfs2020', community);
    const scan = library.scan('msfs2020');
    await save;
    expect((await scan).inventory.addons.map(addon => addon.name)).toEqual([
      'Saved Aircraft',
    ]);
  } finally {
    database.close();
    await rm(directory, {recursive: true, force: true});
  }
});

test('validates simulator and absolute paths at the IPC boundary', () => {
  expect(parseSimulator('msfs2024')).toBe('msfs2024');
  expect(parseCommunityPath(join(tmpdir(), 'Community folder'))).toBe(
    join(tmpdir(), 'Community folder')
  );
  for (const value of [null, {}, '2020', 'msfs2025']) {
    expect(() => parseSimulator(value)).toThrow('Choose a supported simulator');
  }
  for (const value of [null, {}, '', '  ', 'relative/path', '/path\0hidden']) {
    expect(() => parseCommunityPath(value)).toThrow(
      'Enter an absolute Community folder path'
    );
  }
});
