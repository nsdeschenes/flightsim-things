import {afterEach, beforeEach, expect, test} from 'bun:test';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const moduleFile = fileURLToPath(new URL('configuration.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/shared-config/context'
);
const concurrencyTestTimeoutMilliseconds = 15_000;
let homeDirectory: string;
let configurationFile: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'configuration-test-'));
  configurationFile = path.join(homeDirectory, '.flightsim-things/config.json');
});

afterEach(async () => {
  await chmod(path.dirname(configurationFile), 0o700).catch(() => false);
  await rm(homeDirectory, {force: true, recursive: true});
});

async function seed(contents: string): Promise<void> {
  await mkdir(path.dirname(configurationFile), {recursive: true});
  await writeFile(configurationFile, contents);
}

async function run(
  program: string
): Promise<Readonly<{exitCode: number; stdout: string; stderr: string}>> {
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `import configuration from ${JSON.stringify(moduleFile)}; import {Effect, Option} from 'effect'; ${program}`,
    ],
    {
      cwd: repository,
      env: {...process.env, HOME: homeDirectory, USERPROFILE: homeDirectory},
      stderr: 'pipe',
      stdout: 'pipe',
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {exitCode, stderr, stdout};
}

test('missing values, inherited keys, and own special keys use document semantics', async () => {
  expect(
    await run(
      `for (const key of ['missing', '__proto__', 'constructor', 'toString']) console.log(Option.isNone(await Effect.runPromise(configuration.get(key))));`
    )
  ).toMatchObject({exitCode: 0, stdout: 'true\ntrue\ntrue\ntrue\n'});
  expect(
    await run(
      `await Effect.runPromise(configuration.set('__proto__', {safe: true})); await Effect.runPromise(configuration.set('toString', 'saved')); console.log(JSON.stringify(Option.getOrThrow(await Effect.runPromise(configuration.get('__proto__')))));`
    )
  ).toMatchObject({exitCode: 0, stdout: '{"safe":true}\n'});
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual(
    JSON.parse('{"__proto__":{"safe":true},"toString":"saved"}')
  );
  const stats = await stat(configurationFile);
  expect(stats.mode % 0o1000).toBe(0o600);
});

test(
  'concurrent processes serialize first creation and read-modify-write without losing keys',
  async () => {
    const creationPrograms = Array.from(
      {length: 6},
      (unused, index) =>
        `await Effect.runPromise(configuration.set('key${index}', ${index}));`
    );
    const creations = await Promise.all(
      creationPrograms.map(async program => {
        const result = await run(program);
        return result;
      })
    );
    expect(creations.map(result => result.exitCode)).toEqual([0, 0, 0, 0, 0, 0]);
    const incrementProgram = `await Effect.runPromise(configuration.update('counter', current => Effect.succeed(Option.getOrElse(current, () => 0) + 1).pipe(Effect.delay('20 millis'))));`;
    const increments = await Promise.all(
      Array.from<string>({length: 6})
        .fill(incrementProgram)
        .map(async program => {
          const result = await run(program);
          return result;
        })
    );
    expect(increments.map(result => result.exitCode)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
      counter: 6,
      key0: 0,
      key1: 1,
      key2: 2,
      key3: 3,
      key4: 4,
      key5: 5,
    });
    const files = await readdir(path.dirname(configurationFile));
    expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
  },
  concurrencyTestTimeoutMilliseconds
);

test.each(['{broken', 'null', '[]', '42', '"text"'])(
  'malformed document %s preserves bytes for get, set, and update',
  async contents => {
    await seed(contents);
    for (const operation of [
      `configuration.get('setting')`,
      `configuration.set('setting', 1)`,
      `configuration.update('setting', () => 1)`,
    ]) {
      const result = await run(`await Effect.runPromise(${operation});`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Repair the file');
    }

    expect(await readFile(configurationFile, 'utf8')).toBe(contents);
    const files = await readdir(path.dirname(configurationFile));
    expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
  }
);

test.each([
  'NaN',
  'Infinity',
  'undefined',
  '{nested: NaN}',
  '(() => {const value = {}; value.self = value; return value;})()',
  '(() => {const value = [1]; value.toJSON = () => undefined; return value;})()',
])('unsafe value %s cannot erase a saved setting', async value => {
  await seed('{"setting":"saved","future":{"enabled":true}}\n');
  expect(
    await run(`await Effect.runPromise(configuration.set('setting', ${value}));`)
  ).toMatchObject({exitCode: 1});
  expect(await readFile(configurationFile, 'utf8')).toBe(
    '{"setting":"saved","future":{"enabled":true}}\n'
  );
  const files = await readdir(path.dirname(configurationFile));
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('updates preserve unknown keys, support pure callbacks, and release locks after validation failure', async () => {
  await seed('{"setting":1,"future":{"enabled":true}}\n');
  expect(
    await run(
      `await Effect.runPromise(configuration.update('setting', () => Effect.fail(new Error('rejected'))));`
    )
  ).toMatchObject({exitCode: 1});
  expect(await readFile(configurationFile, 'utf8')).toBe(
    '{"setting":1,"future":{"enabled":true}}\n'
  );
  expect(
    await run(
      `await Effect.runPromise(configuration.update('setting', current => Option.getOrThrow(current) + 1));`
    )
  ).toMatchObject({exitCode: 0});
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    future: {enabled: true},
    setting: 2,
  });
  const files = await readdir(path.dirname(configurationFile));
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('nonenumerable serialization hooks cannot remove configuration values', async () => {
  expect(
    await run(
      `const value = Object.defineProperty({hello: 1}, 'toJSON', {value: () => undefined}); await Effect.runPromise(configuration.set('setting', value));`
    )
  ).toMatchObject({exitCode: 0});
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    setting: {hello: 1},
  });
});

test('a process exiting during an update releases the lock and preserves saved settings', async () => {
  await seed('{"setting":"saved"}\n');
  expect(
    await run(
      `await Effect.runPromise(configuration.update('setting', () => process.exit(0)));`
    )
  ).toMatchObject({exitCode: 0});
  expect(
    await run(`await Effect.runPromise(configuration.set('next', 'reopened'));`)
  ).toMatchObject({exitCode: 0});
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    next: 'reopened',
    setting: 'saved',
  });
});

test('filesystem save failure preserves existing bytes and leaves no lock or temporary file', async () => {
  await seed('{"setting":"saved"}\n');
  await chmod(path.dirname(configurationFile), 0o500);
  expect(
    await run(`await Effect.runPromise(configuration.set('setting', 'replacement'));`)
  ).toMatchObject({exitCode: 1});
  expect(await readFile(configurationFile, 'utf8')).toBe('{"setting":"saved"}\n');
  expect(await readdir(path.dirname(configurationFile))).toEqual(['config.json']);
});
