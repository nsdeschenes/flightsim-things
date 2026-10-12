import {afterEach, beforeEach, expect, expectTypeOf, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Effect, Schema} from 'effect';

import database from './index.ts';
import schema from './schema.ts';
import relationsFixture from './test-fixtures/relations.ts';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const databaseModule = fileURLToPath(new URL('index.ts', import.meta.url));
const schemaModule = fileURLToPath(new URL('schema.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/addon-database/context'
);
let homeDirectory: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'database-test-'));
});

afterEach(async () => {
  await rm(homeDirectory, {force: true, recursive: true});
});

async function run(
  program: string,
  executable?: string,
  workingDirectory = repository
): Promise<
  Readonly<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }>
> {
  let command = [
    process.execPath,
    '-e',
    `
    import database from ${JSON.stringify(databaseModule)};
    import schema from ${JSON.stringify(schemaModule)};
    import {Effect, Schema} from 'effect';
    import {eq, sql} from 'drizzle-orm';
    ${program}
  `,
  ];
  if (typeof executable === 'string') {
    command = [executable];
  }
  const child = Bun.spawn(command, {
    cwd: workingDirectory,
    env: {...process.env, HOME: homeDirectory, USERPROFILE: homeDirectory},
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {exitCode, stderr, stdout};
}

test('generated Effect schemas retain optional/null fields and reject invalid types', () => {
  const decode = Schema.decodeUnknownSync(schema.insert.packages);
  expect(decode({sourcePath: path.resolve('example'), version: '1.2.3'})).toMatchObject({
    version: '1.2.3',
  });
  expect(() => decode({sourcePath: 'relative'})).toThrow();
  expect(() => decode({sourcePath: path.resolve('example'), version: 1})).toThrow();
  expect(
    Schema.decodeSync(schema.insert.liveries)({packageId: 1, sourceKey: 'blue'})
  ).toMatchObject({packageId: 1, sourceKey: 'blue'});
  const update: unknown = JSON.parse('{"title":null}');
  expect(Schema.decodeUnknownSync(schema.update.packages)(update).title).toBeNull();
  expect(() =>
    Schema.decodeUnknownSync(schema.insert.aircraft)({packageId: '1'})
  ).toThrow();
  expect(
    Effect.isEffect(database.use(db => db.select().from(schema.packages).all()))
  ).toBe(true);
});

test('relational query types retain required owners and nullable targets', () => {
  const relational = database.use(db =>
    db.query.liveries
      .findMany({
        columns: {sourceKey: true},
        with: {
          aircraft: {
            columns: {sourceKey: true},
            with: {package: {columns: {sourcePath: true}}},
          },
          airline: {columns: {icaoCode: true}},
          package: {columns: {sourcePath: true}},
        },
      })
      .sync()
  );
  expectTypeOf<Effect.Success<typeof relational>>().toEqualTypeOf<
    {
      aircraft: {package: {sourcePath: string}; sourceKey: string} | null;
      airline: {icaoCode: string | null} | null;
      package: {sourcePath: string};
      sourceKey: string;
    }[]
  >();
  const first = database.use(db =>
    db.query.packages
      .findFirst({
        columns: {sourcePath: true},
        with: {aircraft: {columns: {sourceKey: true}}},
      })
      .sync()
  );
  expectTypeOf<Effect.Success<typeof first>>().toEqualTypeOf<
    {aircraft: {sourceKey: string}[]; sourcePath: string} | undefined
  >();
  type QueryClient = Parameters<Parameters<typeof database.use>[0]>[0];
  type RelationalBuilder = ReturnType<QueryClient['query']['packages']['findMany']>;
  expectTypeOf<
    Parameters<typeof database.use<RelationalBuilder | Promise<number>>>[0]
  >().returns.toEqualTypeOf<never>();
  expect(Effect.isEffect(relational)).toBe(true);
});

test('real file persists general metadata, supports multiplicities, and clears removed targets', async () => {
  const configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  await mkdir(configurationDirectory);
  await writeFile(
    path.join(configurationDirectory, 'config.json'),
    '{"communityPath":"keep"}\n'
  );
  expect(
    await run(`
    await Effect.runPromise(database.use(db => db.transaction(tx => {
      const first = tx.insert(schema.packages).values({sourcePath: '/Community/first', title: 'First', version: '1'}).returning().get();
      const second = tx.insert(schema.packages).values({sourcePath: '/Community/second', title: 'Second'}).returning().get();
      const plane = tx.insert(schema.aircraft).values({packageId: first.id, sourceKey: 'plane-a', icaoTypeDesignator: 'A320'}).returning().get();
      tx.insert(schema.aircraft).values({packageId: first.id, sourceKey: 'plane-b', icaoTypeDesignator: 'A320'}).run();
      tx.insert(schema.airports).values([{packageId: first.id, sourceKey: 'airport-a', icaoCode: 'EGLL'}, {packageId: first.id, sourceKey: 'airport-b'}, {packageId: second.id, sourceKey: 'airport-a', icaoCode: 'EGLL'}]).run();
      const airline = tx.insert(schema.airlines).values({icaoCode: 'EXA'}).returning().get();
      tx.insert(schema.airlines).values({icaoCode: 'NONE'}).run();
      tx.insert(schema.liveries).values([{packageId: second.id, sourceKey: 'external', aircraftId: plane.id, airlineId: airline.id, targetAircraftKey: 'plane-a'}, {packageId: first.id, sourceKey: 'owned'}, {packageId: second.id, sourceKey: 'unresolved', targetAircraftKey: 'missing-aircraft'}]).run();
    }, {behavior: 'immediate'})));
  `)
  ).toMatchObject({exitCode: 0, stderr: ''});
  expect(
    await run(`
    ${relationsFixture.read}
    await Effect.runPromise(database.use(db => db.transaction(tx => {
      tx.delete(schema.packages).where(eq(schema.packages.sourcePath, '/Community/first')).run();
      tx.delete(schema.airlines).run();
    })));
    ${relationsFixture.removed}
  `)
  ).toMatchObject({
    exitCode: 0,
    stdout: relationsFixture.expected,
  });
  expect(await readFile(path.join(configurationDirectory, 'config.json'), 'utf8')).toBe(
    '{"communityPath":"keep"}\n'
  );
  const file = await stat(path.join(configurationDirectory, 'addons.sqlite'));
  expect(file.size).toBeGreaterThan(0);
}, 15_000);

test('foreign keys, source uniqueness, and failed transactions protect existing rows', async () => {
  expect(
    await run(`
    for (const key of ['first', 'second']) {
      const outcome = await Effect.runPromise(database.use(db => db.transaction(tx => {
        const record = tx.insert(schema.packages).values({sourcePath: '/Community/' + key}).returning().get();
        tx.insert(schema.liveries).values({packageId: record.id, sourceKey: 'bad', aircraftId: 999}).run();
      }, {behavior: 'immediate'})).pipe(Effect.flip));
      console.log(outcome._tag);
    }
    await Effect.runPromise(database.use(db => {
      const record = db.insert(schema.packages).values({sourcePath: '/Community/kept'}).returning().get();
      db.insert(schema.airports).values({packageId: record.id, sourceKey: 'same'}).run();
    }));
    const conflict = await Effect.runPromise(database.use(db => db.insert(schema.airports).values({packageId: 1, sourceKey: 'same'}).run()).pipe(Effect.flip));
    const airline = await Effect.runPromise(database.use(db => db.insert(schema.airlines).values({}).run()).pipe(Effect.flip));
    console.log(conflict._tag, airline._tag);
    console.log(JSON.stringify(await Effect.runPromise(database.use(db => db.select().from(schema.packages).all().map(row => row.sourcePath)))));
  `)
  ).toMatchObject({
    exitCode: 0,
    stdout:
      'DatabaseError\nDatabaseError\nDatabaseError DatabaseError\n["/Community/kept"]\n',
  });
  const files = await readdir(path.join(homeDirectory, '.flightsim-things'));
  expect(files.some(name => name.endsWith('.lock'))).toBe(false);
});

test('concurrent first opens migrate once and package upserts preserve identity', async () => {
  const writers = ['same', 'same', 'other', 'third'].map(async key => {
    const result = await run(`
    await Effect.runPromise(database.use(db => db.insert(schema.packages)
      .values({sourcePath: '/Community/${key}', version: '2'})
      .onConflictDoUpdate({target: schema.packages.sourcePath, set: {version: '2'}}).run()));
  `);
    return result;
  });
  for (const result of await Promise.all(writers)) {
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
  }
  expect(
    await run(`
    console.log(JSON.stringify(await Effect.runPromise(database.use(db => ({
      migrations: db.all(sql.raw('SELECT name FROM __drizzle_migrations')).length,
      packages: db.select().from(schema.packages).all().length,
    })))));
  `)
  ).toMatchObject({exitCode: 0, stdout: '{"migrations":1,"packages":3}\n'});
}, 15_000);

test('newer migration history fails before queries and releases its lock', async () => {
  expect(
    await run(`
    await Effect.runPromise(database.use(db => db.run(sql.raw("INSERT INTO __drizzle_migrations (hash, name) VALUES ('', 'future')"))));
    for (let attempt = 0; attempt < 2; attempt++) {
      const failure = await Effect.runPromise(database.use(() => {throw new Error('query should not run');}).pipe(Effect.flip));
      console.log(failure._tag, failure.message);
    }
  `)
  ).toMatchObject({
    exitCode: 0,
    stdout:
      'DatabaseError This addon database requires a newer application version.\nDatabaseError This addon database requires a newer application version.\n',
  });
  const files = await readdir(path.join(homeDirectory, '.flightsim-things'));
  expect(files.some(name => name.endsWith('.lock'))).toBe(false);
});

test('callbacks reject asynchronous and unexecuted queries and preserve usable storage', async () => {
  expect(
    await run(`
      for (const callback of [() => Effect.succeed(1), () => Promise.resolve(1), db => db.select().from(schema.packages), db => db.query.packages.findMany(), db => db.query.packages.findMany().execute().catch(() => undefined)]) {
        const failure = await Effect.runPromise(database.use(callback).pipe(Effect.flip));
        console.log(failure._tag, failure.message);
      }
      console.log(await Effect.runPromise(database.use(db => db.select().from(schema.packages).all().length)));
    `)
  ).toMatchObject({
    exitCode: 0,
    stdout: `${'DatabaseError Database callbacks must return synchronous, materialized data.\n'.repeat(5)}0\n`,
  });
});

async function compileProbe(): Promise<string> {
  const entrypoint = path.join(homeDirectory, 'probe.ts');
  let filename = 'probe';
  if (process.platform === 'win32') {
    filename = 'probe.exe';
  }
  const executable = path.join(homeDirectory, filename);
  await writeFile(
    entrypoint,
    `
    import database from ${JSON.stringify(databaseModule)};
    import schema from ${JSON.stringify(schemaModule)};
    import {Effect} from ${JSON.stringify(Bun.resolveSync('effect', repository))};
    await Effect.runPromise(database.use(db => db.insert(schema.packages).values({sourcePath: '/Community/bundled'}).onConflictDoNothing().run()));
    console.log(JSON.stringify(await Effect.runPromise(database.use(db => db.query.packages.findMany({
      columns: {sourcePath: true}, with: {aircraft: true, airports: true, liveries: true},
    }).sync()))));
  `
  );
  const build = await Bun.build({
    compile: {outfile: executable},
    entrypoints: [entrypoint],
    target: 'bun',
  });
  expect(build.success).toBe(true);
  await rm(entrypoint);
  return executable;
}

test('compiled database probe includes migrations and persists from an empty cwd', async () => {
  const executable = await compileProbe();
  const emptyDirectory = path.join(homeDirectory, 'empty');
  await mkdir(emptyDirectory);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    expect(await run('', executable, emptyDirectory)).toMatchObject({
      exitCode: 0,
      stderr: '',
      stdout:
        '[{"sourcePath":"/Community/bundled","aircraft":[],"airports":[],"liveries":[]}]\n',
    });
  }
}, 15_000);
