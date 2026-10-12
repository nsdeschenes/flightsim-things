import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

import {version} from '#package';

import releaseVersions from './release-version.ts';

const {parseReleaseIdentity, parseReleaseVersion, validateBranch} = releaseVersions;

const targets = [
  {
    arch: 'x64',
    extension: '.exe',
    id: 'windows-x64',
    platform: 'win32',
    runner: 'windows-2025',
    target: 'bun-windows-x64',
  },
  {
    arch: 'arm64',
    extension: '',
    id: 'macos-arm64',
    platform: 'darwin',
    runner: 'macos-15',
    target: 'bun-darwin-arm64',
  },
  {
    arch: 'x64',
    extension: '',
    id: 'linux-x64',
    platform: 'linux',
    runner: 'ubuntu-24.04',
    target: 'bun-linux-x64',
  },
  {
    arch: 'arm64',
    extension: '',
    id: 'linux-arm64',
    platform: 'linux',
    runner: 'ubuntu-24.04-arm',
    target: 'bun-linux-arm64',
  },
] as const;

const argvOffset = 2;
const successExitCode = 0;
const unknownCommandExitCode = 251;

function assetNames(releaseVersion: string): string[] {
  parseReleaseVersion(releaseVersion);
  return targets.map(
    target => `flightsim-things-${releaseVersion}-${target.id}${target.extension}`
  );
}

async function checksum(directory: string, name: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path.join(directory, name)))
    .digest('hex');
}

async function validateAssets(
  directory: string,
  releaseVersion: string,
  verifyChecksums: boolean
): Promise<void> {
  const binaries = assetNames(releaseVersion).toSorted();
  const files = await readdir(directory);
  let expected = binaries;
  if (verifyChecksums || files.includes('SHA256SUMS')) {
    expected = [...binaries, 'SHA256SUMS'].toSorted();
  }
  assert.deepEqual(
    files.toSorted(),
    expected,
    'Release asset set must contain exactly the four binaries and, when verified, SHA256SUMS'
  );
  const lines = await Promise.all(
    binaries.map(async name => `${await checksum(directory, name)}  ${name}\n`)
  );
  if (verifyChecksums) {
    assert.equal(
      await readFile(path.join(directory, 'SHA256SUMS'), 'utf8'),
      lines.join(''),
      'Release checksums do not match the binaries'
    );
  } else {
    await writeFile(path.join(directory, 'SHA256SUMS'), lines.join(''));
  }
}

async function build(targetId: string): Promise<void> {
  let selected: readonly (typeof targets)[number][] = targets;
  if (targetId !== 'all') {
    selected = targets.filter(target => target.id === targetId);
  }
  assert.ok(selected.length > successExitCode, `Unknown target ${targetId}`);
  await mkdir('dist', {recursive: true});
  for (const target of selected) {
    const outfile = path.join(
      'dist',
      `flightsim-things-${version}-${target.id}${target.extension}`
    );
    const result = await Bun.build({
      compile: {outfile, target: target.target},
      entrypoints: ['src/index.ts'],
      minify: true,
    });
    assert.ok(result.success, `Compilation failed for ${target.id}`);
    process.stdout.write(`${outfile}\n`);
  }
}

type SmokeDirectory = Readonly<{
  binary: string;
  home: string;
  cwd: string;
  community: string;
}>;
type CommandResult = Readonly<{exitCode: number; stderr: string; stdout: string}>;

async function smokeDirectory(executable: string): Promise<SmokeDirectory> {
  const hostTarget = targets.find(
    target => target.platform === process.platform && target.arch === process.arch
  );
  assert.ok(
    hostTarget,
    `Unsupported smoke test host ${process.platform}/${process.arch}`
  );
  assert.equal(
    path.basename(executable),
    `flightsim-things-${version}-${hostTarget.id}${hostTarget.extension}`,
    'Run each binary on its native host'
  );
  const root = path.join(
    homedir(),
    '.cache/agent-work/flightsim-things/release-flow/context'
  );
  await mkdir(root, {recursive: true});
  const home = await mkdtemp(path.join(root, 'binary-smoke-'));
  const directories = {
    binary: path.resolve(executable),
    community: path.join(home, 'Community directory'),
    cwd: path.join(home, 'empty-working-directory'),
    home,
  };
  await Promise.all([mkdir(directories.cwd), mkdir(directories.community)]);
  return directories;
}

async function runBinary(
  directories: SmokeDirectory,
  args: readonly string[]
): Promise<CommandResult> {
  const child = Bun.spawn([directories.binary, ...args], {
    cwd: directories.cwd,
    env: {...process.env, HOME: directories.home, USERPROFILE: directories.home},
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

async function verifyCommands(directories: SmokeDirectory): Promise<void> {
  assert.deepEqual(await runBinary(directories, ['--version']), {
    exitCode: successExitCode,
    stderr: '',
    stdout: `flightsim-things v${version}\n`,
  });
  const help = await runBinary(directories, ['--help']);
  assert.equal(help.exitCode, successExitCode);
  assert.ok(help.stdout.includes('community-path') && help.stdout.includes('hello'));
  assert.deepEqual(await runBinary(directories, ['hello']), {
    exitCode: successExitCode,
    stderr: '',
    stdout: 'Hello via Bun!\n',
  });
  const unknown = await runBinary(directories, ['unknown']);
  assert.equal(unknown.exitCode, unknownCommandExitCode);
}

async function verifyPersistence(directories: SmokeDirectory): Promise<void> {
  assert.deepEqual(
    await runBinary(directories, ['community-path', 'set', directories.community]),
    {exitCode: successExitCode, stderr: '', stdout: `${directories.community}\n`}
  );
  assert.deepEqual(await runBinary(directories, ['community-path', 'get']), {
    exitCode: successExitCode,
    stderr: '',
    stdout: `${directories.community}\n`,
  });
  const configFile = path.join(directories.home, '.flightsim-things/config.json');
  const contents = await readFile(configFile, 'utf8');
  assert.deepEqual(JSON.parse(contents), {communityPath: directories.community});
}

async function smoke(executable: string): Promise<void> {
  const directories = await smokeDirectory(executable);
  try {
    await verifyCommands(directories);
    await verifyPersistence(directories);
    process.stdout.write(`Verified ${path.basename(directories.binary)}\n`);
  } finally {
    await rm(directories.home, {force: true, recursive: true});
  }
}

const versionField = /"version":\s*"[^"\n]+"/u;

async function bumpVersion(): Promise<void> {
  const newVersion = process.env.CRAFT_NEW_VERSION;
  assert.ok(
    typeof newVersion === 'string' && newVersion !== '',
    'Craft must provide CRAFT_NEW_VERSION'
  );
  parseReleaseVersion(newVersion);
  const manifest = await readFile('package.json', 'utf8');
  assert.ok(versionField.test(manifest), 'package.json must contain its release version');
  await writeFile(
    'package.json',
    manifest.replace(versionField, `"version": "${newVersion}"`)
  );
}

const commands = {
  build,
  'bump-version': bumpVersion,
  matrix(): void {
    process.stdout.write(`${JSON.stringify({include: targets})}\n`);
  },
  async 'prepare-request'(input: string, targetBranch: string): Promise<void> {
    if (['auto', 'major', 'minor', 'patch'].includes(input)) {
      await validateBranch(targetBranch);
      assert.equal(targetBranch, 'main', 'Automatic releases require target branch main');
      process.stdout.write(`${JSON.stringify({kind: 'automatic', targetBranch})}\n`);
    } else {
      const release = await parseReleaseIdentity(input, targetBranch);
      process.stdout.write(`${JSON.stringify({kind: 'explicit', release})}\n`);
    }
  },
  async 'release-info'(input: string, targetBranch: string): Promise<void> {
    const release = await parseReleaseIdentity(input, targetBranch);
    process.stdout.write(`${JSON.stringify(release)}\n`);
  },
  smoke,
  async stage(directory: string, releaseVersion: string): Promise<void> {
    await validateAssets(directory, releaseVersion, false);
  },
  'validate-version': parseReleaseVersion,
  async 'verify-assets'(directory: string, releaseVersion: string): Promise<void> {
    await validateAssets(directory, releaseVersion, true);
  },
};

function isCommand(command: string): command is keyof typeof commands {
  return Object.hasOwn(commands, command);
}

const [command = '', argument = '', releaseVersion = version] =
  process.argv.slice(argvOffset);
assert.ok(
  isCommand(command),
  'Expected matrix, build, smoke, stage, verify-assets, validate-version, prepare-request, release-info, or bump-version'
);
const execution = commands[command](argument, releaseVersion);
export default execution;
