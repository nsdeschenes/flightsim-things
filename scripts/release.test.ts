import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const successExitCode = 0;
const failureExitCode = 1;
const releaseScript = fileURLToPath(new URL('release.ts', import.meta.url));
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
const prereleaseNames = names.map(name => name.replace('1.2.3', '1.2.3-alpha.map-ui.1'));
const helloChecksum = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824';
let directory: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  directory = await mkdtemp(path.join(testDirectory, 'release-test-'));
});

afterEach(async () => {
  await rm(directory, {force: true, recursive: true});
});

async function run(...args: readonly string[]): Promise<CommandResult> {
  const result = Bun.spawn([process.execPath, releaseScript, ...args], {
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    result.exited,
    new Response(result.stderr).text(),
    new Response(result.stdout).text(),
  ]);
  return {exitCode, stderr, stdout};
}

test.each([
  'v1.2.3',
  '01.2.3',
  '1.02.3',
  '1.2.03',
  '1.2',
  '1.2.3-beta',
  '1.2.3-beta.01',
  '1.2.3-preview.1',
  '1.2.3-alpha.1+build',
  '1.2.3-alpha.UPPER.1',
  '1.2.3-alpha.1track.1',
  '1.2.3-alpha.map.ui.1',
  '1.2.3\n',
  '1.2.3;echo bad',
])('rejects invalid release version %s before file operations', async input => {
  const result = await run('validate-version', input);
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stderr).toContain('Expected X.Y.Z');
});

test.each([
  ['1.2.3', names],
  ['1.2.3-alpha.map-ui.1', prereleaseNames],
] as const)(
  'stages and verifies exact %s binary filenames and literal checksums',
  async (releaseVersion: string, releaseNames: readonly string[]) => {
    await Promise.all(
      releaseNames.map(async name => {
        await writeFile(path.join(directory, name), 'hello');
      })
    );
    expect(await run('stage', directory, releaseVersion)).toMatchObject({
      exitCode: successExitCode,
    });
    expect(await readFile(path.join(directory, 'SHA256SUMS'), 'utf8')).toBe(
      releaseNames.map(name => `${helloChecksum}  ${name}\n`).join('')
    );
    expect(await run('verify-assets', directory, releaseVersion)).toMatchObject({
      exitCode: successExitCode,
    });
    await writeFile(
      path.join(directory, `flightsim-things-${releaseVersion}-linux-x64`),
      'corrupted'
    );
    const corrupted = await run('verify-assets', directory, releaseVersion);
    expect(corrupted.exitCode).toBe(failureExitCode);
    expect(corrupted.stderr).toContain('Release checksums do not match');
    expect(await run('stage', directory, releaseVersion)).toMatchObject({
      exitCode: successExitCode,
    });
    expect(await run('verify-assets', directory, releaseVersion)).toMatchObject({
      exitCode: successExitCode,
    });
  }
);

test.each([
  ['1.2.3', names],
  ['1.2.3-alpha.map-ui.1', prereleaseNames],
] as const)(
  'rejects missing and unexpected binaries for %s',
  async (releaseVersion: string, releaseNames: readonly string[]) => {
    const missing = await run('stage', directory, releaseVersion);
    expect(missing.exitCode).toBe(failureExitCode);
    expect(missing.stderr).toContain('Release asset set');
    await Promise.all(
      releaseNames.map(async name => {
        await writeFile(path.join(directory, name), 'hello');
      })
    );
    await writeFile(path.join(directory, 'flightsim-things-9.9.9-linux-x64'), 'hello');
    const unexpected = await run('stage', directory, releaseVersion);
    expect(unexpected.exitCode).toBe(failureExitCode);
  }
);

test.each([
  ['1.2.3', 'stable'],
  ['1.2.3-alpha.0', 'prerelease'],
  ['1.2.3-beta.2', 'prerelease'],
  ['1.2.3-rc.9', 'prerelease'],
  ['1.2.3-alpha.map-ui.12345678901234567890', 'prerelease'],
])('classifies canonical release %s through the CLI', async (input, kind) => {
  const result = await run('release-info', input, 'main');
  expect(result.exitCode).toBe(successExitCode);
  expect(JSON.parse(result.stdout)).toEqual({
    targetBranch: 'main',
    version: {kind, value: input},
  });
});

test('permits tracked prereleases on an independent valid branch name', async () => {
  const result = await run('prepare-request', '1.2.3-beta.map-ui.1', 'feature/map-ui');
  expect(result.exitCode).toBe(successExitCode);
  expect(JSON.parse(result.stdout)).toEqual({
    kind: 'explicit',
    release: {
      targetBranch: 'feature/map-ui',
      version: {kind: 'prerelease', value: '1.2.3-beta.map-ui.1'},
    },
  });
});

test.each(['auto', 'major', 'minor', 'patch', '1.2.3'])(
  'requires main for preparation request %s',
  async input => {
    const accepted = await run('prepare-request', input, 'main');
    expect(accepted.exitCode).toBe(successExitCode);
    const rejected = await run('prepare-request', input, 'feature/map-ui');
    expect(rejected.exitCode).toBe(failureExitCode);
    expect(rejected.stderr).toContain('require target branch main');
  }
);

test.each([
  'release/1.2.3',
  '../bad',
  'bad..branch',
  'bad branch',
  'bad:branch',
  'branch\n',
])('rejects invalid or reserved target %s', async target => {
  const result = await run('release-info', '1.2.3-alpha.1', target);
  expect(result.exitCode).toBe(failureExitCode);
});

test('bumps a manifest to a tracked prerelease using the Craft environment', async () => {
  await writeFile(
    path.join(directory, 'package.json'),
    '{"name":"fixture","version":"0.0.0"}\n'
  );
  const result = Bun.spawn([process.execPath, releaseScript, 'bump-version'], {
    cwd: directory,
    env: {...process.env, CRAFT_NEW_VERSION: '1.2.3-rc.map-ui.1'},
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode] = await Promise.all([
    result.exited,
    new Response(result.stderr).text(),
    new Response(result.stdout).text(),
  ]);
  expect(exitCode).toBe(successExitCode);
  const manifest = await readFile(path.join(directory, 'package.json'), 'utf8');
  expect(JSON.parse(manifest)).toEqual({name: 'fixture', version: '1.2.3-rc.map-ui.1'});
});
