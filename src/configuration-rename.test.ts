import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const moduleFile = fileURLToPath(new URL('configuration.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/no-legacy-config/context'
);
const original = '{"setting":"saved","future":{"enabled":true}}\n';
let homeDirectory: string;
let configurationFile: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'rename-test-'));
  configurationFile = path.join(homeDirectory, '.flightsim-things/config.json');
  await mkdir(path.dirname(configurationFile));
  await writeFile(configurationFile, original);
});

afterEach(async () => {
  await rm(homeDirectory, {force: true, recursive: true});
});

function renameProgram(
  platform: string,
  failures: readonly string[],
  repeatFailure = false
): string {
  let failureCode = 'failures[attempts - 1]';
  if (repeatFailure) {
    failureCode = 'failures[0]';
  }

  return `
    import configuration from ${JSON.stringify(moduleFile)};
    import fs from 'node:fs/promises';
    import {Database} from 'bun:sqlite';
    import {Effect} from 'effect';
    Object.defineProperty(process, 'platform', {value: ${JSON.stringify(platform)}});
    const failures = ${JSON.stringify(failures)};
    const rename = fs.rename;
    let attempts = 0;
    fs.rename = async (source, destination) => {
      attempts += 1;
      const contender = new Database(destination + '.lock.sqlite');
      try {
        contender.run('BEGIN IMMEDIATE');
        throw new Error('Lock was released before rename');
      } catch (error) {
        if (error.code !== 'SQLITE_BUSY') throw error;
      } finally {
        contender.close(true);
      }
      const code = ${failureCode};
      if (code) throw Object.assign(new Error('Injected rename failure'), {code});
      return rename(source, destination);
    };
    try {
      await Effect.runPromise(configuration.set('setting', 'replacement'));
      console.log('saved');
    } catch (error) {
      console.log(error.cause.code);
    }
    console.log(attempts);
  `;
}

async function run(
  platform: string,
  failures: readonly string[],
  repeatFailure = false
): Promise<Readonly<{exitCode: number; stdout: string; stderr: string}>> {
  const program = renameProgram(platform, failures, repeatFailure);
  const child = Bun.spawn([process.execPath, '-e', program], {
    cwd: repository,
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

test('Windows replacement retries transient sharing errors while holding the lock', async () => {
  expect(await run('win32', ['EPERM', 'EACCES', 'EBUSY'])).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'saved\n4\n',
  });
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    future: {enabled: true},
    setting: 'replacement',
  });
  const files = await readdir(path.dirname(configurationFile));
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('Windows retry exhaustion preserves bytes and releases the lock and removes the temporary file', async () => {
  expect(await run('win32', ['EPERM'], true)).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'EPERM\n5\n',
  });
  expect(await readFile(configurationFile, 'utf8')).toBe(original);
  const files = await readdir(path.dirname(configurationFile));
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test.each([
  {code: 'EPERM', platform: 'linux'},
  {code: 'EACCES', platform: 'darwin'},
  {code: 'ENOSPC', platform: 'win32'},
])(
  'replacement failure %s does not retry and preserves bytes',
  async ({code, platform}) => {
    expect(await run(platform, [code])).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `${code}\n1\n`,
    });
    expect(await readFile(configurationFile, 'utf8')).toBe(original);
    const files = await readdir(path.dirname(configurationFile));
    expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
  }
);
