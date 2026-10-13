import {afterEach, beforeEach, expect, test} from 'bun:test';
import {cp, mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Schema} from 'effect';

import schema from './schema.ts';
import processFixture from './test-fixtures/process.ts';

const repository = fileURLToPath(new URL('../..', import.meta.url));
let homeDirectory: string;

beforeEach(async () => {
  homeDirectory = await mkdtemp(path.join(tmpdir(), 'flightsim-airport-test-'));
});

afterEach(async () => {
  await rm(homeDirectory, {force: true, recursive: true});
});

test.each([
  '{"packageId":1,"sourceKey":"airport"}',
  '{"packageId":1,"sourceKey":"airport","elevationMeters":null,"latitude":null,"longitude":null}',
  '{"packageId":1,"sourceKey":"airport","elevationMeters":35.5,"latitude":-33.946111,"longitude":151.177222}',
])(
  'airport insert and update schemas accept optional and nullable numbers in %s',
  json => {
    const input: unknown = JSON.parse(json);
    expect(input).toEqual(Schema.decodeUnknownSync(schema.insert.airports)(input));
    expect(input).toEqual(Schema.decodeUnknownSync(schema.update.airports)(input));
    expect(Schema.decodeSync(schema.update.airports)({})).toEqual({});
  }
);

test.each([
  '{"id":1,"packageId":1,"sourceKey":"airport","name":null,"icaoCode":null,"iataCode":null,"elevationMeters":null,"latitude":null,"longitude":null}',
  '{"id":1,"packageId":1,"sourceKey":"airport","name":null,"icaoCode":null,"iataCode":null,"elevationMeters":35.5,"latitude":-33.946111,"longitude":151.177222}',
])('airport select schema accepts nullable numbers in %s', json => {
  const input: unknown = JSON.parse(json);
  expect(input).toEqual(Schema.decodeUnknownSync(schema.select.airports)(input));
});

test.each(['elevationMeters', 'latitude', 'longitude'])(
  'airport schemas reject strings and require selected %s',
  field => {
    const row = Schema.decodeUnknownSync(schema.select.airports)(
      JSON.parse(
        '{"id":1,"packageId":1,"sourceKey":"airport","name":null,"icaoCode":null,"iataCode":null,"elevationMeters":35.5,"latitude":-33.946111,"longitude":151.177222}'
      )
    );
    const invalidRow: unknown = {...row, [field]: '35.5'};
    const invalidUpdate: unknown = {[field]: '35.5'};
    const missingField: unknown = Object.fromEntries(
      Object.entries(row).filter(([key]: readonly [string, unknown]) => key !== field)
    );
    expect(() => Schema.decodeUnknownSync(schema.insert.airports)(invalidRow)).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(schema.update.airports)(invalidUpdate)
    ).toThrow();
    expect(() => Schema.decodeUnknownSync(schema.select.airports)(invalidRow)).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(schema.select.airports)(missingField)
    ).toThrow();
  }
);

test('airport locations persist fractional coordinates, zero, negative, and unknown elevations', async () => {
  expect(
    await processFixture.run(
      homeDirectory,
      `
    await Effect.runPromise(database.use(db => {
      const record = db.insert(schema.packages).values({sourcePath: '/Community/airports'}).returning().get();
      db.insert(schema.airports).values([
        {packageId: record.id, sourceKey: 'fractional', elevationMeters: 35.5, latitude: -33.946111, longitude: 151.177222},
        {packageId: record.id, sourceKey: 'negative', elevationMeters: -378.5, latitude: 31.328611, longitude: 35.388611},
        {packageId: record.id, sourceKey: 'unknown'},
        {packageId: record.id, sourceKey: 'zero', elevationMeters: 0, latitude: 0, longitude: 0},
      ]).run();
    }));
  `
    )
  ).toMatchObject({exitCode: 0, stderr: ''});
  const result = await processFixture.run(
    homeDirectory,
    `
    const rows = await Effect.runPromise(database.use(db => db.select({
      sourceKey: schema.airports.sourceKey,
      elevationMeters: schema.airports.elevationMeters,
      latitude: schema.airports.latitude,
      longitude: schema.airports.longitude,
    }).from(schema.airports).orderBy(schema.airports.sourceKey).all()));
    console.log(JSON.stringify(rows));
  `
  );
  expect(result).toMatchObject({exitCode: 0, stderr: ''});
  expect(JSON.parse(result.stdout)).toEqual(
    JSON.parse(`[
    {"sourceKey":"fractional","elevationMeters":35.5,"latitude":-33.946111,"longitude":151.177222},
    {"sourceKey":"negative","elevationMeters":-378.5,"latitude":31.328611,"longitude":35.388611},
    {"sourceKey":"unknown","elevationMeters":null,"latitude":null,"longitude":null},
    {"sourceKey":"zero","elevationMeters":0,"latitude":0,"longitude":0}
  ]`)
  );
});

test('airport location migration preserves existing airport rows with unknown locations', async () => {
  const configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  const legacyMigrations = path.join(homeDirectory, 'legacy-migrations');
  await mkdir(configurationDirectory);
  await cp(
    path.join(repository, 'drizzle/20261012231451_addon_metadata'),
    path.join(legacyMigrations, '20261012231451_addon_metadata'),
    {recursive: true}
  );
  const result = await processFixture.run(
    homeDirectory,
    `
    import {Database} from 'bun:sqlite';
    import {drizzle} from 'drizzle-orm/bun-sqlite';
    import {migrate} from 'drizzle-orm/bun-sqlite/migrator';
    const client = new Database(${JSON.stringify(path.join(configurationDirectory, 'addons.sqlite'))}, {create: true});
    migrate(drizzle({client}), {migrationsFolder: ${JSON.stringify(legacyMigrations)}});
    client.exec("INSERT INTO packages (id, source_path, title) VALUES (7, '/Community/legacy', 'Legacy'); INSERT INTO airports (id, package_id, source_key, name, icao_code, iata_code) VALUES (11, 7, 'legacy-airport', 'Legacy airport', 'KAAA', 'AAA');");
    client.close();
    const row = await Effect.runPromise(database.use(db => db.select().from(schema.airports).get()));
    console.log(JSON.stringify(row));
  `
  );
  expect(result).toMatchObject({exitCode: 0, stderr: ''});
  expect(JSON.parse(result.stdout)).toEqual(
    JSON.parse(`{
    "id":11,"packageId":7,"sourceKey":"legacy-airport","name":"Legacy airport",
    "icaoCode":"KAAA","iataCode":"AAA","elevationMeters":null,"latitude":null,"longitude":null
  }`)
  );
});
