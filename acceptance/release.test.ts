import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const failureExitCode = 1;

const releaseScript = fileURLToPath(new URL('../scripts/release.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/release-flow/context'
);
const names = [
  'flightsim-things-1.2.3-linux-arm64',
  'flightsim-things-1.2.3-linux-arm64-desktop.tar.gz',
  'flightsim-things-1.2.3-linux-x64',
  'flightsim-things-1.2.3-linux-x64-desktop.tar.gz',
  'flightsim-things-1.2.3-macos-arm64',
  'flightsim-things-1.2.3-macos-arm64-desktop.tar.gz',
  'flightsim-things-1.2.3-windows-x64-desktop.tar.gz',
  'flightsim-things-1.2.3-windows-x64.exe',
];
const helloChecksum = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
let directory: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  directory = await mkdtemp(path.join(testDirectory, 'release-test-'));
});

afterEach(async () => {
  await rm(directory, {force: true, recursive: true});
});

async function run(
  ...args: readonly string[]
): Promise<{exitCode: number; stderr: string}> {
  const child = Bun.spawn([process.execPath, releaseScript, ...args], {
    stderr: 'pipe',
    stdout: 'ignore',
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return {exitCode, stderr};
}

test.each(['v1.2.3', '01.2.3', '1.2', '1.2.3-beta', '1.2.3\n', '1.2.3;echo bad'])(
  'rejects invalid stable version %s before file operations',
  async input => {
    const result = await run('validate-version', input);
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stderr).toContain('Expected a stable version');
  }
);

test('stages and verifies exact binary and desktop bundle filenames and literal checksums', async () => {
  await Promise.all(
    names.map(async name => {
      await writeFile(path.join(directory, name), 'hello');
    })
  );
  expect(await run('stage', directory, '1.2.3')).toMatchObject({exitCode: 0});
  expect(await readFile(path.join(directory, 'SHA256SUMS'), 'utf8')).toBe(
    names.map(name => `${helloChecksum}  ${name}\n`).join('')
  );
  expect(await run('verify-assets', directory, '1.2.3')).toMatchObject({exitCode: 0});
  await writeFile(path.join(directory, 'flightsim-things-1.2.3-linux-x64'), 'corrupted');
  const corrupted = await run('verify-assets', directory, '1.2.3');
  expect(corrupted.exitCode).toBe(failureExitCode);
  expect(corrupted.stderr).toContain('Release checksums do not match');
  expect(await run('stage', directory, '1.2.3')).toMatchObject({exitCode: 0});
  expect(await run('verify-assets', directory, '1.2.3')).toMatchObject({exitCode: 0});
});

test('rejects missing and unexpected release assets', async () => {
  const missing = await run('stage', directory, '1.2.3');
  expect(missing.exitCode).toBe(failureExitCode);
  expect(missing.stderr).toContain('Release asset set');
  await Promise.all(
    names.map(async name => {
      await writeFile(path.join(directory, name), 'hello');
    })
  );
  await writeFile(path.join(directory, 'flightsim-things-9.9.9-linux-x64'), 'hello');
  expect(await run('stage', directory, '1.2.3')).toMatchObject({exitCode: 1});
});
