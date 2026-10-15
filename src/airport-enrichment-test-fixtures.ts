import {Database} from 'bun:sqlite';
import {spyOn} from 'bun:test';
import path from 'node:path';

import {drizzle} from 'drizzle-orm/bun-sqlite';
import {migrate} from 'drizzle-orm/bun-sqlite/migrator';
import {Effect} from 'effect';

import configuration from '#configuration';
import database from '#database';
import schema from '#database-schema';

type ProviderAirport = Readonly<{
  _id?: string;
  elevation?: Readonly<{
    referenceDatum?: typeof meanSeaLevelDatum;
    unit: typeof metersUnit;
    value: number;
  }>;
  geometry?: Readonly<{coordinates: readonly [number, number]; type: 'Point'}>;
  iataCode?: string;
  icaoCode?: string;
  name?: string;
}>;
type AirportPage = Readonly<{
  items: readonly ProviderAirport[];
  limit: number;
  nextPage?: number;
  page: number;
  totalCount: number;
  totalPages: number;
}>;
type SeedAirport = Omit<
  typeof schema.airports.$inferInsert,
  'id' | 'packageId' | 'sourceKey'
>;
const metersUnit = 0;
const meanSeaLevelDatum = 1;
const firstIndex = 0;
const key = 'test-openaip-secret';
const firstPage = 1;
const pageLimit = 100;

function page(
  items: readonly ProviderAirport[],
  overrides: Partial<Omit<AirportPage, 'items'>> = {}
): AirportPage {
  return {
    items,
    limit: pageLimit,
    page: firstPage,
    totalCount: items.length,
    totalPages: firstPage,
    ...overrides,
  };
}

type TestDatabase = ReturnType<typeof drizzle<typeof schema.relations>>;
type Fixture = Readonly<{
  db: TestDatabase;
  client: Database;
  configuration: ReturnType<typeof spyOn<typeof configuration, 'get'>>;
  seed: (rows: readonly SeedAirport[]) => void;
  rows: () => (typeof schema.airports.$inferSelect)[];
  dispose: () => void;
}>;
function seedAirports(
  db: Readonly<Pick<TestDatabase, 'insert'>>,
  packageId: number,
  rows: readonly SeedAirport[]
): void {
  for (const [index, row] of rows.entries()) {
    db.insert(schema.airports)
      .values({...row, packageId, sourceKey: `airport-${index}`})
      .run();
  }
}

function createFixture(): Fixture {
  const client = new Database(':memory:');
  const db = drizzle({client, relations: schema.relations});
  client.run('PRAGMA foreign_keys = ON');
  migrate(db, {migrationsFolder: path.resolve(import.meta.dir, '../drizzle')});
  const record = db
    .insert(schema.packages)
    .values({sourcePath: '/Community/airports'})
    .returning()
    .get();
  function use<Value>(
    query: Parameters<typeof database.use<Value>>[typeof firstIndex]
  ): ReturnType<typeof database.use<Value>> {
    return Effect.try({
      catch: cause =>
        new database.Error({cause, message: 'Test database operation failed'}),
      try: () => query(db),
    });
  }

  const databaseSpy = spyOn(database, 'use').mockImplementation(use);
  const configurationSpy = spyOn(configuration, 'get').mockReturnValue(
    Effect.succeedSome(key)
  );
  return {
    client,
    configuration: configurationSpy,
    db,
    dispose: () => {
      configurationSpy.mockRestore();
      databaseSpy.mockRestore();
      client.close();
    },
    rows: () => db.select().from(schema.airports).orderBy(schema.airports.id).all(),
    seed: rows => {
      seedAirports(db, record.id, rows);
    },
  };
}

const fixtures = {createFixture, key, page};
export default fixtures;
