import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('index.ts', import.meta.url)),
  testDirectory = path.join(
    homedir(),
    '.cache/agent-work/flightsim-things/community-path/context'
  );
let homeDirectory: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'cli-test-'));
});

afterEach(async () => {
  await rm(homeDirectory, {force: true, recursive: true});
});

const run = (
  ...args: readonly string[]
): {exitCode: number; stdout: string; stderr: string} => {
  const result = Bun.spawnSync([process.execPath, cli, ...args], {
    cwd: homeDirectory,
    env: {...process.env, HOME: homeDirectory, USERPROFILE: homeDirectory},
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {
    exitCode: result.exitCode,
    stderr: new TextDecoder().decode(result.stderr),
    stdout: new TextDecoder().decode(result.stdout),
  };
};

test('set, get, and update persist between CLI processes', async () => {
  const firstDirectory = path.join(homeDirectory, 'MSFS 2024 Community'),
    nextDirectory = path.join(homeDirectory, 'New Community');
  await mkdir(firstDirectory);
  await mkdir(nextDirectory);

  expect(run('community-path', 'set', firstDirectory)).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${firstDirectory}\n`,
  });
  expect(run('community-path', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${firstDirectory}\n`,
  });
  expect(run('community-path', 'update', nextDirectory)).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${nextDirectory}\n`,
  });
  expect(run('community-path', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${nextDirectory}\n`,
  });
  expect(
    await readFile(path.join(homeDirectory, '.flightsim-things/config.json'), 'utf8')
  ).toBe(`${JSON.stringify({communityPath: nextDirectory})}\n`);
  expect(await readdir(path.join(homeDirectory, '.flightsim-things'))).toEqual([
    'config.json',
  ]);
});

test('update saves the first directory and resolves relative paths', async () => {
  const directory = path.join(homeDirectory, 'Community with spaces');
  await mkdir(directory);
  expect(run('community-path', 'update', './Community with spaces')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${directory}\n`,
  });
  expect(run('community-path', 'get').stdout).toBe(`${directory}\n`);
});

test('quoted home paths expand without shell expansion', async () => {
  const directory = path.join(homeDirectory, 'Community with spaces');
  await mkdir(directory);
  expect(run('community-path', 'set', '~').stdout).toBe(`${homeDirectory}\n`);
  expect(run('community-path', 'update', '~/Community with spaces')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${directory}\n`,
  });
  expect(run('community-path', 'get').stdout).toBe(`${directory}\n`);
});

test('get returns the saved path after the target is removed', async () => {
  const directory = path.join(homeDirectory, 'Community');
  await mkdir(directory);
  expect(run('community-path', 'set', directory).exitCode).toBe(0);
  await rm(directory, {recursive: true});
  expect(run('community-path', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${directory}\n`,
  });
});

test('unset get fails with instructions to save a directory', () => {
  const result = run('community-path', 'get');
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('No Community directory is saved.');
  expect(result.stderr).toContain('community-path set <path>');
});

test('set repairs malformed JSON', async () => {
  const configurationDirectory = path.join(homeDirectory, '.flightsim-things'),
    directory = path.join(homeDirectory, 'Community');
  await mkdir(configurationDirectory);
  await mkdir(directory);
  await writeFile(path.join(configurationDirectory, 'config.json'), '{broken');
  const result = run('community-path', 'get');
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Invalid JSON');
  expect(result.stderr).toContain('community-path set <path>');
  expect(run('community-path', 'set', directory).exitCode).toBe(0);
  expect(run('community-path', 'get').stdout).toBe(`${directory}\n`);
});

test.each([
  'null',
  '[]',
  '{}',
  '{"communityPath":0}',
  '{"communityPath":""}',
  '{"communityPath":"relative"}',
  String.raw`{"communityPath":"/invalid\u0000path"}`,
])('get rejects an invalid configuration record %s', async contents => {
  const configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  await mkdir(configurationDirectory);
  await writeFile(path.join(configurationDirectory, 'config.json'), contents);
  const result = run('community-path', 'get');
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Invalid Community directory');
  expect(result.stderr).toContain('community-path set <path>');
});

test.each(['missing', 'file', ''])(
  'invalid input %s preserves the saved path',
  async input => {
    const directory = path.join(homeDirectory, 'Community');
    await mkdir(directory);
    await writeFile(path.join(homeDirectory, 'file'), 'not a directory');
    expect(run('community-path', 'set', directory).exitCode).toBe(0);
    const result = run('community-path', 'update', input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Community');
    expect(run('community-path', 'get')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `${directory}\n`,
    });
  }
);

test('a failed replacement reports the filesystem error and removes its temporary file', async () => {
  const configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  await mkdir(path.join(configurationDirectory, 'config.json'), {recursive: true});
  const result = run('community-path', 'set', homeDirectory);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('rename');
  expect(await readdir(configurationDirectory)).toEqual(['config.json']);
});

test('help lists the directory commands and their path argument', () => {
  const rootHelp = run('--help'),
    routeHelp = run('community-path', '--help'),
    setHelp = run('community-path', 'set', '--help');
  expect(rootHelp.exitCode).toBe(0);
  expect(rootHelp.stdout).toContain('community-path');
  expect(rootHelp.stdout).toContain('hello');
  expect(routeHelp.exitCode).toBe(0);
  expect(routeHelp.stdout).toContain('get');
  expect(routeHelp.stdout).toContain('set');
  expect(routeHelp.stdout).toContain('update');
  expect(setHelp.exitCode).toBe(0);
  expect(setHelp.stdout).toContain('<path>');
});

test.each(['set', 'update'])('%s requires a path argument', command => {
  const result = run('community-path', command);
  expect(result.exitCode).toBe(252);
  expect(result.stderr).toContain('path');
});

test('hello still prints the greeting', () => {
  expect(run('hello')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'Hello via Bun!\n',
  });
});
