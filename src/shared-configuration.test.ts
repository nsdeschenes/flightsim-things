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
const sentry = {dsn, sampleRates: {errors: 0, logs: 0, metrics: 0, traces: 0}};
let homeDirectory: string;
let configurationDirectory: string;
let configurationFile: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'shared-cli-test-'));
  configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  configurationFile = path.join(configurationDirectory, 'config.json');
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

test('Sentry set repairs an invalid section and preserves unrelated settings', async () => {
  await writeFile(
    configurationFile,
    JSON.stringify({communityPath: homeDirectory, future: true, sentry: 'invalid'})
  );
  expect(await run('sentry', 'get')).toMatchObject({exitCode: 1});
  expect(await set()).toMatchObject({exitCode: 0});
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    communityPath: homeDirectory,
    future: true,
    sentry,
  });
});

test('concurrent Community and partial Sentry saves retain all values', async () => {
  await writeFile(
    configurationFile,
    JSON.stringify({
      future: {enabled: true},
      sentry: {
        ...sentry,
        metadata: 'retained',
        sampleRates: {...sentry.sampleRates, futureRate: 0.5},
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
  const files = await readdir(configurationDirectory);
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});
