import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const releaseScript = fileURLToPath(new URL('../scripts/release.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/release-flow/context'
);
const names = [
  'flightsim-things-1.2.3-linux-arm64',
  'flightsim-things-1.2.3-linux-x64',
  'flightsim-things-1.2.3-macos-arm64',
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

function run(...args: readonly string[]): {exitCode: number; stderr: string} {
  const result = Bun.spawnSync([process.execPath, releaseScript, ...args], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  return {exitCode: result.exitCode, stderr: new TextDecoder().decode(result.stderr)};
}

test.each(['v1.2.3', '01.2.3', '1.2', '1.2.3-beta', '1.2.3\n', '1.2.3;echo bad'])(
  'rejects invalid stable version %s before file operations',
  input => {
    const result = run('validate-version', input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Expected a stable version');
  }
);

test('stages and verifies exact binary filenames and literal checksums', async () => {
  await Promise.all(
    names.map(async name => {
      await writeFile(path.join(directory, name), 'hello');
    })
  );
  expect(run('stage', directory, '1.2.3').exitCode).toBe(0);
  expect(await readFile(path.join(directory, 'SHA256SUMS'), 'utf8')).toBe(
    names.map(name => `${helloChecksum}  ${name}\n`).join('')
  );
  expect(run('verify-assets', directory, '1.2.3').exitCode).toBe(0);
  await writeFile(path.join(directory, 'flightsim-things-1.2.3-linux-x64'), 'corrupted');
  const corrupted = run('verify-assets', directory, '1.2.3');
  expect(corrupted.exitCode).toBe(1);
  expect(corrupted.stderr).toContain('Release checksums do not match');
  expect(run('stage', directory, '1.2.3').exitCode).toBe(0);
  expect(run('verify-assets', directory, '1.2.3').exitCode).toBe(0);
});

test('rejects missing and unexpected binaries', async () => {
  const missing = run('stage', directory, '1.2.3');
  expect(missing.exitCode).toBe(1);
  expect(missing.stderr).toContain('Release asset set');
  await Promise.all(
    names.map(async name => {
      await writeFile(path.join(directory, name), 'hello');
    })
  );
  await writeFile(path.join(directory, 'flightsim-things-9.9.9-linux-x64'), 'hello');
  expect(run('stage', directory, '1.2.3').exitCode).toBe(1);
});
