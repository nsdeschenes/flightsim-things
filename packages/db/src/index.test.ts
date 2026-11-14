import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {sql} from 'drizzle-orm';
import {expect, test} from 'vitest';

import {openDatabase} from './index.js';

test('initializes SQLite idempotently and persists SQL across connections', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-db-'));
  const path = join(directory, 'test.sqlite');
  try {
    const first = await openDatabase(path);
    try {
      expect(
        await first.db.all(
          sql`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
        )
      ).toEqual([{name: 'addons'}, {name: 'simulator_settings'}]);
      await first.db.run(sql`CREATE TABLE probe (value TEXT NOT NULL)`);
      await first.db.run(sql`INSERT INTO probe VALUES ('persisted')`);
    } finally {
      first.close();
    }
    const second = await openDatabase(path);
    try {
      expect(await second.db.all(sql`SELECT value FROM probe`)).toEqual([
        {value: 'persisted'},
      ]);
    } finally {
      second.close();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
