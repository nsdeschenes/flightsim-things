import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';

import {version} from '#package';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;

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
const stableVersion = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const successExitCode = 0;
const commandFailureExitCode = 1;
const unknownCommandExitCode = 251;

function validateVersion(input: string): void {
  assert.ok(
    stableVersion.test(input),
    `Expected a stable version without v, received ${input}`
  );
}

function assetNames(releaseVersion: string): string[] {
  validateVersion(releaseVersion);
  return targets.flatMap(target => [
    `flightsim-things-${releaseVersion}-${target.id}${target.extension}`,
    `flightsim-things-${releaseVersion}-${target.id}-desktop.tar.gz`,
  ]);
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
  const assets = assetNames(releaseVersion).toSorted();
  const files = await readdir(directory);
  let expected = assets;
  if (verifyChecksums || files.includes('SHA256SUMS')) {
    expected = [...assets, 'SHA256SUMS'].toSorted();
  }

  assert.deepEqual(
    files.toSorted(),
    expected,
    'Release asset set must contain exactly the four binaries, four desktop bundles and, when verified, SHA256SUMS'
  );
  const lines = await Promise.all(
    assets.map(async name => `${await checksum(directory, name)}  ${name}\n`)
  );
  if (verifyChecksums) {
    assert.equal(
      await readFile(path.join(directory, 'SHA256SUMS'), 'utf8'),
      lines.join(''),
      'Release checksums do not match the assets'
    );
  } else {
    await writeFile(path.join(directory, 'SHA256SUMS'), lines.join(''));
  }
}

const executableMode = 0o755;
const launchers = {
  darwin: {
    contents:
      '#!/bin/sh\nset -eu\napp_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$app_dir/flightsim-things" tui\n',
    name: 'Launch flightsim-things.command',
  },
  linux: {
    contents: `#!/bin/sh
set -eu
app_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -t 0 ] && [ -t 1 ]; then
  exec "$app_dir/flightsim-things" tui
fi
if command -v x-terminal-emulator >/dev/null 2>&1; then
  exec x-terminal-emulator -e "$app_dir/flightsim-things" tui
fi
if command -v gnome-terminal >/dev/null 2>&1; then
  exec gnome-terminal -- "$app_dir/flightsim-things" tui
fi
if command -v konsole >/dev/null 2>&1; then
  exec konsole -e "$app_dir/flightsim-things" tui
fi
if command -v xfce4-terminal >/dev/null 2>&1; then
  exec xfce4-terminal --disable-server --execute "$app_dir/flightsim-things" tui
fi
if command -v xterm >/dev/null 2>&1; then
  exec xterm -e "$app_dir/flightsim-things" tui
fi
printf '%s\\n' 'No supported terminal found. Open a terminal in this folder and run ./flightsim-things tui.' >&2
exit 1
`,
    name: 'Launch flightsim-things.sh',
  },
  win32: {
    contents: '@echo off\r\n"%~dp0flightsim-things.exe" tui\r\nif errorlevel 1 pause\r\n',
    name: 'Launch flightsim-things.cmd',
  },
};

async function writeDesktopFiles(
  target: Readonly<(typeof targets)[number]>,
  staging: string,
  executable: string
): Promise<void> {
  const binary = path.join(staging, `flightsim-things${target.extension}`);
  const launcher = launchers[target.platform];
  await copyFile(executable, binary);
  await writeFile(path.join(staging, launcher.name), launcher.contents);
  await writeFile(
    path.join(staging, 'README.txt'),
    'Extract this entire archive before launching. Keep the launcher beside the executable.\n' +
      'Open the Launch flightsim-things file to start the interactive menu.\n' +
      'On Linux, your file manager may require Run as a program or Run in terminal.\n' +
      'In a terminal, run ./flightsim-things tui, or flightsim-things.exe tui on Windows.\n' +
      'Running the executable without arguments starts the interactive menu. Use --help for CLI help.\n'
  );
  await Promise.all([
    chmod(binary, executableMode),
    chmod(path.join(staging, launcher.name), executableMode),
  ]);
}

async function archiveFiles(args: readonly string[], cwd: string): Promise<void> {
  const child = Bun.spawn(['tar', ...args], {
    cwd,
    stderr: 'inherit',
    stdout: 'inherit',
  });
  assert.equal(
    await child.exited,
    successExitCode,
    'Desktop bundle archive operation failed'
  );
}

async function createDesktopBundle(
  target: Readonly<(typeof targets)[number]>,
  executable: string
): Promise<void> {
  const cache = path.join(
    homedir(),
    '.cache/agent-work/flightsim-things/tui-build/context'
  );
  await mkdir(cache, {recursive: true});
  const staging = await mkdtemp(path.join(cache, 'desktop-bundle-'));
  try {
    await writeDesktopFiles(target, staging, executable);
    const archive = path.resolve(
      'dist',
      `flightsim-things-${version}-${target.id}-desktop.tar.gz`
    );
    await archiveFiles(
      ['-czf', path.basename(archive), '-C', staging, '.'],
      path.dirname(archive)
    );
    process.stdout.write(`${archive}\n`);
  } finally {
    await rm(staging, {force: true, recursive: true});
  }
}

async function buildTarget(target: Readonly<(typeof targets)[number]>): Promise<void> {
  const outfile = path.join(
    'dist',
    `flightsim-things-${version}-${target.id}${target.extension}`
  );
  const result = await Bun.build({
    compile: {assets: ['./drizzle'], outfile, target: target.target},
    entrypoints: ['src/index.ts'],
    minify: true,
  });
  assert.ok(result.success, `Compilation failed for ${target.id}`);
  process.stdout.write(`${outfile}\n`);
  await createDesktopBundle(target, outfile);
}

async function build(targetId: string): Promise<void> {
  let selected: readonly (typeof targets)[number][] = targets;
  if (targetId !== 'all') {
    selected = targets.filter(target => target.id === targetId);
  }

  assert.ok(selected.length > successExitCode, `Unknown target ${targetId}`);
  await mkdir('dist', {recursive: true});
  for (const target of selected) {
    await buildTarget(target);
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
  const interactive = await runBinary(directories, ['tui']);
  assert.equal(interactive.exitCode, commandFailureExitCode);
  assert.ok(interactive.stderr.includes('requires a terminal'));
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

const executableExtension = /(?:\.exe)?$/u;

async function verifyBundleFiles(
  extracted: string,
  target: Readonly<(typeof targets)[number]>
): Promise<void> {
  const launcher = launchers[target.platform];
  const files = await readdir(extracted);
  assert.deepEqual(
    files.toSorted(),
    ['README.txt', launcher.name, `flightsim-things${target.extension}`].toSorted()
  );
  assert.equal(
    await readFile(path.join(extracted, launcher.name), 'utf8'),
    launcher.contents
  );
}

const launcherTimeoutMilliseconds = 15_000;
const terminalColumns = 180;
const terminalRows = 60;
const selectExit = '\u001B[A\r';

async function runLauncher(
  launcher: string,
  directories: SmokeDirectory,
  terminal: DeepReadonly<Bun.Terminal>
): Promise<void> {
  let argv = [launcher];
  if (process.platform === 'win32') {
    argv = ['cmd.exe', '/d', '/c', launcher];
  }

  try {
    const child = Bun.spawn(argv, {
      cwd: directories.cwd,
      env: {
        ...process.env,
        HOME: directories.home,
        TERM: 'xterm-256color',
        USERPROFILE: directories.home,
      },
      terminal,
    });
    const timeout = setTimeout(() => {
      child.kill();
    }, launcherTimeoutMilliseconds);
    try {
      assert.equal(
        await child.exited,
        successExitCode,
        'Desktop launcher must open the menu and exit successfully'
      );
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    terminal.close();
  }
}

async function verifyLauncher(
  directories: SmokeDirectory,
  extracted: string,
  target: Readonly<(typeof targets)[number]>
): Promise<void> {
  let output = '';
  let selectedExit = false;
  const decoder = new TextDecoder();
  const terminal = new Bun.Terminal({
    cols: terminalColumns,
    data(
      input: Readonly<{write: (value: string) => number}>,
      data: DeepReadonly<Uint8Array>
    ): void {
      output += decoder.decode(data, {stream: true});
      if (
        !selectedExit &&
        output.includes('Choose a command') &&
        output.includes('Exit')
      ) {
        selectedExit = true;
        input.write(selectExit);
      }
    },
    rows: terminalRows,
  });
  await runLauncher(
    path.join(extracted, launchers[target.platform].name),
    directories,
    terminal
  );
  assert.ok(selectedExit, 'Desktop launcher must display the interactive menu');
}

async function verifyDesktopBundle(directories: SmokeDirectory): Promise<void> {
  const archive = directories.binary.replace(executableExtension, '-desktop.tar.gz');
  const extracted = path.join(directories.home, 'Extracted desktop bundle');
  await mkdir(extracted);
  await archiveFiles(
    ['-xzf', path.basename(archive), '-C', extracted],
    path.dirname(archive)
  );
  const target = targets.find(
    candidate =>
      candidate.platform === process.platform && candidate.arch === process.arch
  );
  assert.ok(target);
  await verifyBundleFiles(extracted, target);
  const bundled = {
    ...directories,
    binary: path.join(extracted, `flightsim-things${target.extension}`),
  };
  await verifyCommands(bundled);
  await verifyLauncher(directories, extracted, target);
}

async function smoke(executable: string): Promise<void> {
  const directories = await smokeDirectory(executable);
  try {
    await verifyCommands(directories);
    await verifyPersistence(directories);
    await verifyDesktopBundle(directories);
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
  validateVersion(newVersion);
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
  smoke,
  async stage(directory: string, releaseVersion: string): Promise<void> {
    await validateAssets(directory, releaseVersion, false);
  },
  'validate-version': validateVersion,
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
  'Expected matrix, build, smoke, stage, verify-assets, validate-version, or bump-version'
);
const execution = commands[command](argument, releaseVersion);
export default execution;
