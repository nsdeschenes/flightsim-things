import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createCliFixture from '#acceptance-cli';

const successExitCode = 0;

let fixture: Awaited<ReturnType<typeof createCliFixture>>;

const dsn = 'https://publickey@localhost/123';
const sentry = {dsn, sampleRates: {errors: 0, logs: 0, metrics: 0, traces: 0}};
let homeDirectory: string;
let configurationDirectory: string;
let configurationFile: string;

beforeEach(async () => {
  fixture = await createCliFixture();
  homeDirectory = fixture.home;
  configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  configurationFile = path.join(configurationDirectory, 'config.json');
  await mkdir(configurationDirectory);
});

afterEach(async () => {
  await fixture.dispose();
});

async function set(): Promise<
  Readonly<{exitCode: number; stdout: string; stderr: string}>
> {
  const result = await fixture.run(
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
  expect(await fixture.run('sentry', 'get')).toMatchObject({exitCode: 1});
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
    fixture.run('community-path', 'set', homeDirectory),
    fixture.run('sentry', 'update', '--logs', '0.2'),
    fixture.run('sentry', 'update', '--traces', '0.4'),
  ]);
  expect(results.map(result => result.exitCode)).toEqual([
    successExitCode,
    successExitCode,
    successExitCode,
  ]);
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
