import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createCliFixture from '#acceptance-cli';

const successExitCode = 0;
const failureExitCode = 1;
const unknownCommandExitCode = 251;
const invalidArgumentsExitCode = 252;
const permissionBits = 0o1000;
const privateFileMode = 0o600;

let fixture: Awaited<ReturnType<typeof createCliFixture>>;

let homeDirectory: string;

beforeEach(async () => {
  fixture = await createCliFixture();
  homeDirectory = fixture.home;
});

afterEach(async () => {
  await fixture.dispose();
});

test('set, get, and update persist between CLI processes', async () => {
  const firstDirectory = path.join(homeDirectory, 'MSFS 2024 Community');
  const nextDirectory = path.join(homeDirectory, 'New Community');
  await Promise.all([mkdir(firstDirectory), mkdir(nextDirectory)]);

  expect(await fixture.run('community-path', 'set', firstDirectory)).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${firstDirectory}\n`,
  });
  expect(await fixture.run('community-path', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${firstDirectory}\n`,
  });
  expect(await fixture.run('community-path', 'update', nextDirectory)).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${nextDirectory}\n`,
  });
  expect(await fixture.run('community-path', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${nextDirectory}\n`,
  });
  expect(
    await readFile(path.join(homeDirectory, '.flightsim-things/config.json'), 'utf8')
  ).toBe(`${JSON.stringify({communityPath: nextDirectory})}\n`);
  const files = await readdir(path.join(homeDirectory, '.flightsim-things'));
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('saved configurations remain private after replacement', async () => {
  expect(await fixture.run('community-path', 'set', homeDirectory)).toMatchObject({
    exitCode: 0,
  });
  expect(await fixture.run('community-path', 'update', homeDirectory)).toMatchObject({
    exitCode: 0,
  });
  const configurationStats = await stat(
    path.join(homeDirectory, '.flightsim-things/config.json')
  );
  expect(configurationStats.mode % permissionBits).toBe(privateFileMode);
});

test('update saves the first directory and resolves relative paths', async () => {
  const directory = path.join(homeDirectory, 'Community with spaces');
  await mkdir(directory);
  expect(
    await fixture.run('community-path', 'update', './Community with spaces')
  ).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${directory}\n`,
  });
  expect(await fixture.run('community-path', 'get')).toMatchObject({
    stdout: `${directory}\n`,
  });
});

test('quoted home paths expand without shell expansion', async () => {
  const directory = path.join(homeDirectory, 'Community with spaces');
  await mkdir(directory);
  expect(await fixture.run('community-path', 'set', '~')).toMatchObject({
    stdout: `${homeDirectory}\n`,
  });
  expect(
    await fixture.run('community-path', 'update', '~/Community with spaces')
  ).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${directory}\n`,
  });
  expect(await fixture.run('community-path', 'get')).toMatchObject({
    stdout: `${directory}\n`,
  });
});

test('get returns the saved path after the target is removed', async () => {
  const directory = path.join(homeDirectory, 'Community');
  await mkdir(directory);
  expect(await fixture.run('community-path', 'set', directory)).toMatchObject({
    exitCode: 0,
  });
  await rm(directory, {recursive: true});
  expect(await fixture.run('community-path', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${directory}\n`,
  });
});

test('unset get fails with instructions to save a directory', async () => {
  const result = await fixture.run('community-path', 'get');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stderr).toContain('No Community directory is saved.');
  expect(result.stderr).toContain('community-path set <path>');
});

test('get rejects malformed JSON with instructions to repair the file', async () => {
  const configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  await mkdir(configurationDirectory);
  await writeFile(path.join(configurationDirectory, 'config.json'), '{broken');
  const result = await fixture.run('community-path', 'get');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stderr).toContain('Invalid JSON');
  expect(result.stderr).toContain('Repair the file');
});

test('set preserves malformed JSON', async () => {
  const configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  const directory = path.join(homeDirectory, 'Community');
  await mkdir(configurationDirectory);
  await mkdir(directory);
  await writeFile(path.join(configurationDirectory, 'config.json'), '{broken');
  expect(await fixture.run('community-path', 'set', directory)).toMatchObject({
    exitCode: 1,
  });
  expect(await readFile(path.join(configurationDirectory, 'config.json'), 'utf8')).toBe(
    '{broken'
  );
});

test.each([
  '{"communityPath":0}',
  '{"communityPath":""}',
  '{"communityPath":"relative"}',
  String.raw`{"communityPath":"/invalid\u0000path"}`,
])('get rejects an invalid configuration record %s', async contents => {
  const configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  await mkdir(configurationDirectory);
  await writeFile(path.join(configurationDirectory, 'config.json'), contents);
  const result = await fixture.run('community-path', 'get');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stderr).toContain('Invalid Community directory');
  expect(result.stderr).toContain('community-path set <path>');
});

test.each(['missing', 'file', ''])(
  'invalid input %s preserves the saved path',
  async input => {
    const directory = path.join(homeDirectory, 'Community');
    await mkdir(directory);
    await writeFile(path.join(homeDirectory, 'file'), 'not a directory');
    expect(await fixture.run('community-path', 'set', directory)).toMatchObject({
      exitCode: 0,
    });
    const result = await fixture.run('community-path', 'update', input);
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stderr).toContain('Community');
    expect(await fixture.run('community-path', 'get')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `${directory}\n`,
    });
  }
);

test('a failed replacement reports the filesystem error and removes its temporary file', async () => {
  const configurationDirectory = path.join(homeDirectory, '.flightsim-things');
  await mkdir(path.join(configurationDirectory, 'config.json'), {recursive: true});
  const result = await fixture.run('community-path', 'set', homeDirectory);
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stderr).toContain('read');
  const files = await readdir(configurationDirectory);
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('community-path help lists the directory commands', async () => {
  const routeHelp = await fixture.run('community-path', '--help');
  expect(routeHelp.exitCode).toBe(successExitCode);
  expect(routeHelp.stdout).toContain('get');
  expect(routeHelp.stdout).toContain('set');
  expect(routeHelp.stdout).toContain('update');
});

test('set help lists its path argument', async () => {
  const setHelp = await fixture.run('community-path', 'set', '--help');
  expect(setHelp.exitCode).toBe(successExitCode);
  expect(setHelp.stdout).toContain('<path>');
});

test.each(['set', 'update'])('%s requires a path argument', async command => {
  const result = await fixture.run('community-path', command);
  expect(result.exitCode).toBe(invalidArgumentsExitCode);
  expect(result.stderr).toContain('path');
});

test('unknown community-path commands show Effect help and preserve the exit code', async () => {
  const result = await fixture.run('community-path', 'unknown');
  expect(result.exitCode).toBe(unknownCommandExitCode);
  expect(result.stderr).toContain('Unknown subcommand "unknown"');
  expect(result.stdout).toContain('USAGE');
});

test('no community-path command prints its help', async () => {
  expect(await fixture.run('community-path')).toEqual(
    await fixture.run('community-path', '--help')
  );
});
