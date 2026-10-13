import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../..', import.meta.url));
const databaseModule = fileURLToPath(new URL('index.ts', import.meta.url));
const schemaModule = fileURLToPath(new URL('schema.ts', import.meta.url));
const testDirectory = path.join(tmpdir(), 'flightsim-things-addon-database');
let homeDirectory: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'durable-lock-test-'));
});

afterEach(async () => {
  await rm(homeDirectory, {force: true, recursive: true});
});

function start(program: string): Bun.Subprocess<'ignore', 'pipe', 'pipe'> {
  return Bun.spawn(
    [
      process.execPath,
      '-e',
      `
      import database from ${JSON.stringify(databaseModule)};
      import schema from ${JSON.stringify(schemaModule)};
      import {Effect} from 'effect';
      ${program}
    `,
    ],
    {
      cwd: repository,
      env: {...process.env, HOME: homeDirectory, USERPROFILE: homeDirectory},
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
    }
  );
}

async function run(
  program: string
): Promise<Readonly<{exitCode: number; stderr: string; stdout: string}>> {
  const child = start(program);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {exitCode, stderr, stdout};
}

test('a synchronously blocked callback excludes another process beyond ten seconds', async () => {
  const contenderProgram = `
    import database from ${JSON.stringify(databaseModule)};
    import {Effect} from 'effect';
    await Bun.sleep(10_600);
    console.log(await Effect.runPromise(database.use(() => 'entered').pipe(
      Effect.catch(error => Effect.succeed(error.cause?.code ?? error.message))
    )));
  `;
  expect(
    await run(`
      console.log(JSON.stringify(await Effect.runPromise(database.use(db => {
        const contender = Bun.spawnSync([process.execPath, '-e', ${JSON.stringify(contenderProgram)}], {
          cwd: ${JSON.stringify(repository)}, env: process.env,
          stderr: 'pipe', stdout: 'pipe',
        });
        if (contender.exitCode !== 0) {
          throw new Error(new TextDecoder().decode(contender.stderr));
        }
        return {
          contender: new TextDecoder().decode(contender.stdout).trim(),
          packages: db.select().from(schema.packages).all().length,
        };
      }))));
    `)
  ).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: '{"contender":"SQLITE_BUSY","packages":0}\n',
  });
}, 35_000);

test('killing a process inside its callback permits an immediate database reopen', async () => {
  const holder = start(`
    import {writeSync} from 'node:fs';
    await Effect.runPromise(database.use(() => {
      writeSync(1, 'holding\\n');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      return 'released';
    }));
  `);
  try {
    const ready = await holder.stdout.getReader().read();
    expect(new TextDecoder().decode(ready.value)).toBe('holding\n');
  } finally {
    holder.kill('SIGKILL');
    await holder.exited;
  }
  expect(
    await run(`
      console.log(await Effect.runPromise(database.use(db => {
        db.insert(schema.packages).values({sourcePath: '/Community/reopened'}).run();
        return db.select().from(schema.packages).get().sourcePath;
      })));
    `)
  ).toEqual({exitCode: 0, stderr: '', stdout: '/Community/reopened\n'});
}, 15_000);

test('concurrent Effects yield during contention and preserve every write in one process', async () => {
  expect(
    await run(`
      import {Database} from 'bun:sqlite';
      import path from 'node:path';
      await Effect.runPromise(database.use(() => 'initialized'));
      const holder = new Database(path.join(process.env.HOME, '.flightsim-things/addons.sqlite.lock.sqlite'));
      holder.run('BEGIN IMMEDIATE');
      const started = performance.now();
      const release = setTimeout(() => {
        console.log(performance.now() - started < 1000 ? 'timer responsive' : 'timer blocked');
        holder.close(true);
      }, 200);
      try {
        const writers = Array.from({length: 8}, (_, index) => database.use(db => {
          db.insert(schema.packages).values({sourcePath: '/Community/' + index}).run();
          return db.select().from(schema.packages).all().length;
        }));
        const counts = await Effect.runPromise(Effect.all(writers, {concurrency: 'unbounded'}));
        console.log(JSON.stringify(counts.toSorted((first, second) => first - second)));
        console.log(await Effect.runPromise(database.use(db => db.select().from(schema.packages).all().length)));
      } finally {
        clearTimeout(release);
        holder.close(true);
      }
    `)
  ).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'timer responsive\n[1,2,3,4,5,6,7,8]\n8\n',
  });
}, 15_000);
