import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {sql} from 'drizzle-orm';
import {expect, test} from 'vitest';

import {openDatabase} from './index.js';

test('migrates a fresh database once and preserves inventory across connections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-db-'));
  const path = join(directory, 'test.sqlite');
  const addon = {
    simulator: 'msfs2020' as const,
    folderName: 'sample-aircraft',
    folderPath: '/Community/sample-aircraft',
    name: 'Sample Aircraft',
    version: '1.0.0',
    creator: 'Test Creator',
    contentType: 'AIRCRAFT',
    manifestJson: '{"title":"Sample Aircraft"}',
  };
  try {
    const first = await openDatabase(path);
    let migrations;
    try {
      expect(
        await first.db.all(
          sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
        )
      ).toEqual([
        {name: '__drizzle_migrations'},
        {name: 'addons'},
        {name: 'simulator_settings'},
      ]);
      migrations = await first.db.all(sql`SELECT * FROM __drizzle_migrations`);
      expect(migrations).toEqual([
        expect.objectContaining({
          name: expect.stringMatching(/^\d{14}_addon-library$/),
          hash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]);
      await first.saveCommunityPath('msfs2020', '/Community');
      await first.replaceInventory('msfs2020', '/Community', [addon]);
    } finally {
      first.close();
    }
    const second = await openDatabase(path);
    try {
      expect(await second.getInventory('msfs2020')).toEqual({
        simulator: 'msfs2020',
        communityPath: '/Community',
        scannedPath: '/Community',
        scannedAt: expect.any(String),
        addons: [addon],
      });
      expect(await second.db.all(sql`SELECT * FROM __drizzle_migrations`)).toEqual(
        migrations
      );
    } finally {
      second.close();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
