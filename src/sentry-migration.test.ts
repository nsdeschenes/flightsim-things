import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('index.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/shared-config/context'
);
const dsn = 'https://publickey@localhost/123';
const legacy = {dsn, sampleRates: {errors: 0, logs: 0, metrics: 0, traces: 0}};
let homeDirectory: string;
let configurationDirectory: string;
let configurationFile: string;
let legacyFile: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'migration-test-'));
  configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  configurationFile = path.join(configurationDirectory, 'config.json');
  legacyFile = path.join(configurationDirectory, 'sentry.json');
  await mkdir(configurationDirectory);
});

afterEach(async () => {
  await rm(homeDirectory, {force: true, recursive: true});
});

async function run(
  ...args: readonly string[]
): Promise<Readonly<{exitCode: number; stdout: string; stderr: string}>> {
  let executable = [process.execPath, cli];
  const binary = process.env.FLIGHTSIM_TEST_BINARY;
  if (typeof binary === 'string' && binary !== '') {
    executable = [binary];
  }
  const child = Bun.spawn([...executable, ...args], {
    cwd: homeDirectory,
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

async function set(): Promise<
  Readonly<{exitCode: number; stdout: string; stderr: string}>
> {
  const result = await run(
    'sentry',
    'set',
    '--dsn',
    dsn,
    '--errors',
    '0',
    '--logs',
    '0',
    '--metrics',
    '0',
    '--traces',
    '0'
  );
  return result;
}

test('legacy-only settings remain readable without creating the shared document', async () => {
  await writeFile(legacyFile, JSON.stringify(legacy));
  expect(await run('sentry', 'get')).toMatchObject({
    exitCode: 0,
    stdout: `${JSON.stringify(legacy)}\n`,
  });
  expect(await readdir(configurationDirectory)).toEqual(['sentry.json']);
  expect(await run('sentry', 'update', '--logs', '0.25')).toMatchObject({exitCode: 0});
  expect(await readdir(configurationDirectory)).toEqual(['config.json', 'sentry.json']);
});

test('legacy Sentry reads are read-only and its first update merges into the shared document', async () => {
  const original = JSON.stringify({communityPath: homeDirectory, future: ['saved']});
  await writeFile(configurationFile, original);
  await writeFile(legacyFile, JSON.stringify(legacy));
  expect(await run('sentry', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${JSON.stringify(legacy)}\n`,
  });
  expect(await readFile(configurationFile, 'utf8')).toBe(original);
  expect(await run('sentry', 'update', '--logs', '0.25')).toMatchObject({exitCode: 0});
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    communityPath: homeDirectory,
    future: ['saved'],
    sentry: {...legacy, sampleRates: {...legacy.sampleRates, logs: 0.25}},
  });
  expect(await readFile(legacyFile, 'utf8')).toBe(JSON.stringify(legacy));
  expect(await readdir(configurationDirectory)).toEqual(['config.json', 'sentry.json']);
});

test('a shared Sentry section takes precedence over malformed legacy settings', async () => {
  await writeFile(configurationFile, JSON.stringify({sentry: legacy}));
  await writeFile(legacyFile, '{obsolete');
  expect(await run('sentry', 'get')).toMatchObject({
    exitCode: 0,
    stdout: `${JSON.stringify(legacy)}\n`,
  });
  expect(await run('sentry', 'update', '--traces', '0.25')).toMatchObject({exitCode: 0});
  expect(await readFile(legacyFile, 'utf8')).toBe('{obsolete');
});

test('an invalid shared Sentry section overrides valid legacy settings and set repairs only that section', async () => {
  await writeFile(
    configurationFile,
    JSON.stringify({communityPath: homeDirectory, future: true, sentry: 'invalid'})
  );
  await writeFile(legacyFile, JSON.stringify(legacy));
  expect(await run('sentry', 'get')).toMatchObject({exitCode: 1});
  expect(await set()).toMatchObject({exitCode: 0});
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    communityPath: homeDirectory,
    future: true,
    sentry: legacy,
  });
  expect(await readFile(legacyFile, 'utf8')).toBe(JSON.stringify(legacy));
});

test('malformed legacy settings leave shared bytes intact while Community saves and explicit Sentry set remain usable', async () => {
  await writeFile(configurationFile, '{"future":true}\n');
  await writeFile(legacyFile, '{broken');
  expect(await run('sentry', 'update', '--logs', '1')).toMatchObject({exitCode: 1});
  expect(await readFile(configurationFile, 'utf8')).toBe('{"future":true}\n');
  expect(await run('community-path', 'set', homeDirectory)).toMatchObject({exitCode: 0});
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    communityPath: homeDirectory,
    future: true,
  });
  expect(await set()).toMatchObject({exitCode: 0});
  expect(await readFile(legacyFile, 'utf8')).toBe('{broken');
  expect(await run('sentry', 'get')).toMatchObject({exitCode: 0, stderr: ''});
});

test('concurrent Community and partial Sentry saves retain all values', async () => {
  await writeFile(
    configurationFile,
    JSON.stringify({
      future: {enabled: true},
      sentry: {
        ...legacy,
        metadata: 'retained',
        sampleRates: {...legacy.sampleRates, futureRate: 0.5},
      },
    })
  );
  const results = await Promise.all([
    run('community-path', 'set', homeDirectory),
    run('sentry', 'update', '--logs', '0.2'),
    run('sentry', 'update', '--traces', '0.4'),
  ]);
  expect(results.map(result => result.exitCode)).toEqual([0, 0, 0]);
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    communityPath: homeDirectory,
    future: {enabled: true},
    sentry: {
      dsn,
      metadata: 'retained',
      sampleRates: {errors: 0, futureRate: 0.5, logs: 0.2, metrics: 0, traces: 0.4},
    },
  });
  expect(await readdir(configurationDirectory)).toEqual(['config.json']);
});
