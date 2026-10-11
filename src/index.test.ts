import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('index.ts', import.meta.url));
const testDirectory = path.join(
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

function run(...args: readonly string[]): {
  exitCode: number;
  stdout: string;
  stderr: string;
} {
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
}

test('root help lists the available commands', () => {
  const rootHelp = run('--help');
  expect(rootHelp.exitCode).toBe(0);
  expect(rootHelp.stdout).toContain('community-path');
  expect(rootHelp.stdout).toContain('hello');
});

test('hello still prints the greeting', () => {
  expect(run('hello')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'Hello via Bun!\n',
  });
});

test.each([
  {args: ['unknown'], exitCode: 251, stderr: 'Unknown subcommand "unknown"'},
  {
    args: ['hello', '--unknown'],
    exitCode: 252,
    stderr: 'Unrecognized flag: --unknown',
  },
  {
    args: ['hello', 'extra'],
    exitCode: 252,
    stderr: 'Unexpected positional argument: "extra"',
  },
])(
  'argument errors show Effect help and preserve exit code for $args',
  ({args, exitCode, stderr}) => {
    const result = run(...args);
    expect(result.exitCode).toBe(exitCode);
    expect(result.stderr).toContain(stderr);
    expect(result.stdout).toContain('USAGE');
  }
);

test('no command and short help print the same root help', () => {
  expect(run()).toEqual(run('--help'));
  expect(run('-h')).toEqual(run('--help'));
});
