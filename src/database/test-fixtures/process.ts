import assert from 'node:assert/strict';
import {cp, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('../../..', import.meta.url));
const databaseModule = fileURLToPath(new URL('../index.ts', import.meta.url));
const schemaModule = fileURLToPath(new URL('../schema.ts', import.meta.url));
const successExitCode = 0;

async function prepareProbe(
  homeDirectory: string
): Promise<Readonly<{entrypoint: string; executable: string; migrationsFolder: string}>> {
  const entrypoint = path.join(homeDirectory, 'probe.ts');
  const migrationsFolder = path.join(homeDirectory, 'drizzle');
  let filename = 'probe';
  if (process.platform === 'win32') {
    filename = 'probe.exe';
  }
  const executable = path.join(homeDirectory, filename);
  await cp(path.join(repository, 'drizzle'), migrationsFolder, {recursive: true});
  await writeFile(
    entrypoint,
    `
    import database from ${JSON.stringify(databaseModule)};
    import schema from ${JSON.stringify(schemaModule)};
    import {Effect} from ${JSON.stringify(await Bun.resolve('effect', repository))};
    await Effect.runPromise(database.use(db => db.insert(schema.packages).values({sourcePath: '/Community/bundled'}).onConflictDoNothing().run()));
    console.log(JSON.stringify(await Effect.runPromise(database.use(db => db.query.packages.findMany({
      columns: {sourcePath: true}, with: {aircraft: true, airports: true, liveries: true},
    }).sync()))));
  `
  );
  return {entrypoint, executable, migrationsFolder};
}

async function compileProbe(homeDirectory: string): Promise<string> {
  const {entrypoint, executable, migrationsFolder} = await prepareProbe(homeDirectory);
  const build = Bun.spawn(
    [
      process.execPath,
      'build',
      '--compile',
      entrypoint,
      '--asset',
      './drizzle',
      '--outfile',
      executable,
    ],
    {cwd: homeDirectory, stderr: 'pipe', stdout: 'ignore'}
  );
  const [exitCode, stderr] = await Promise.all([
    build.exited,
    new Response(build.stderr).text(),
  ]);
  assert.equal(exitCode, successExitCode, stderr);
  await rm(entrypoint);
  await rm(migrationsFolder, {recursive: true});
  return executable;
}

const lockProgram = `
  import {Database} from 'bun:sqlite';
  import path from 'node:path';
  const filename = path.join(process.env.HOME, '.flightsim-things/addons.sqlite.lock.sqlite');
  for (const fail of [false, true]) {
    const result = await Effect.runPromise(database.use(db => {
      const contender = new Database(filename);
      try {
        contender.run('BEGIN IMMEDIATE');
        console.log('unlocked during callback');
      } catch (error) {
        console.log(error.code);
      } finally {
        contender.close(true);
      }
      if (fail) {throw new Error('failed query');}
      return db.select().from(schema.packages).all().length;
    }).pipe(Effect.exit));
    console.log(result._tag);
    const contender = new Database(filename);
    contender.run('BEGIN IMMEDIATE');
    console.log('acquired after callback');
    contender.close(true);
  }
`;

async function run(
  homeDirectory: string,
  program: string,
  options: Readonly<{executable?: string; workingDirectory?: string}> = {}
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
  if (typeof options.executable === 'string') {
    command = [options.executable];
  }
  const child = Bun.spawn(command, {
    cwd: options.workingDirectory ?? repository,
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

const processFixture = {compileProbe, lockProgram, run};

export default processFixture;
