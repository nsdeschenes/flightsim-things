import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {sql} from 'drizzle-orm';
import {Effect} from 'effect';
import {expect, test} from 'vitest';

import {DatabaseError, openDatabase} from './index.js';

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

test('lazily migrates once, closes its scope, and preserves inventory across connections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-db-'));
  const path = join(directory, 'test.sqlite');
  try {
    const acquisition = openDatabase(path);
    await expect(stat(path)).rejects.toMatchObject({code: 'ENOENT'});
    const first = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* acquisition;
          expect(
            yield* Effect.promise(() =>
              database.db.all(
                sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
              )
            )
          ).toEqual([
            {name: '__drizzle_migrations'},
            {name: 'addons'},
            {name: 'airports'},
            {name: 'simulator_settings'},
          ]);
          const migrations = yield* Effect.promise(() =>
            database.db.all(sql`SELECT * FROM __drizzle_migrations`)
          );
          expect(migrations).toEqual([
            expect.objectContaining({
              name: expect.stringMatching(/^\d{14}_addon-library$/),
              hash: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
            expect.objectContaining({
              name: expect.stringMatching(/^\d{14}_airport-metadata$/),
              hash: expect.stringMatching(/^[a-f0-9]{64}$/),
            }),
          ]);
          yield* database.saveCommunityPath('msfs2020', '/Community');
          yield* database.replaceInventory('msfs2020', '/Community', [addon]);
          return {database, migrations};
        })
      )
    );
    await expect(
      first.database.db.all(sql`SELECT * FROM __drizzle_migrations`)
    ).rejects.toThrow();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const second = yield* openDatabase(path);
          expect(yield* second.getInventory('msfs2020')).toEqual({
            simulator: 'msfs2020',
            communityPath: '/Community',
            scannedPath: '/Community',
            scannedAt: expect.any(String),
            addons: [addon],
            airports: [],
          });
          expect(
            yield* Effect.promise(() =>
              second.db.all(sql`SELECT * FROM __drizzle_migrations`)
            )
          ).toEqual(first.migrations);
        })
      )
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('returns typed connection failures', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-db-'));
  try {
    const error = await Effect.runPromise(
      Effect.scoped(openDatabase(join(directory, 'missing', 'test.sqlite'))).pipe(
        Effect.flip
      )
    );
    expect(error).toBeInstanceOf(DatabaseError);
    expect(error).toMatchObject({_tag: 'DatabaseError', operation: 'connect'});
    expect(error.cause).toBeDefined();
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('rolls back a failed inventory replacement and keeps the connection usable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-db-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, 'test.sqlite'));
          const previous = yield* database.replaceInventory('msfs2020', '/Community', [
            addon,
          ]);
          const failure = yield* database
            .replaceInventory('msfs2020', '/Broken', [addon, addon])
            .pipe(Effect.flip);
          expect(failure).toBeInstanceOf(DatabaseError);
          expect(failure.operation).toBe('insert addon');
          expect(yield* database.getInventory('msfs2020')).toEqual(previous);
          yield* database.saveCommunityPath('msfs2020', '/Updated');
          expect((yield* database.getInventory('msfs2020')).communityPath).toBe(
            '/Updated'
          );
        })
      )
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('serializes concurrent inventory transactions on the shared connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-db-'));
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const database = yield* openDatabase(join(directory, 'test.sqlite'));
          const nextAddon = {...addon, simulator: 'msfs2024' as const};
          const inventories = yield* Effect.all(
            [
              database.replaceInventory('msfs2020', '/Community/2020', [addon]),
              database.replaceInventory('msfs2024', '/Community/2024', [nextAddon]),
            ],
            {concurrency: 'unbounded'}
          );
          expect(inventories.map(inventory => inventory.addons)).toEqual([
            [addon],
            [nextAddon],
          ]);
          expect(yield* database.getLibrary()).toEqual(inventories);
        })
      )
    );
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
