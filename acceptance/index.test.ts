import {afterEach, beforeEach, expect, test} from 'bun:test';

import createCliFixture from '#acceptance-cli';
import {version} from '#package';

const successExitCode = 0;

let fixture: Awaited<ReturnType<typeof createCliFixture>>;

beforeEach(async () => {
  fixture = await createCliFixture();
});

afterEach(async () => {
  await fixture.dispose();
});

test('root help lists the available commands', async () => {
  const rootHelp = await fixture.run('--help');
  expect(rootHelp.exitCode).toBe(successExitCode);
  for (const command of [
    'ai',
    'airports',
    'community-path',
    'hello',
    'openaip-key',
    'scan',
    'sentry',
  ]) {
    expect(rootHelp.stdout).toContain(command);
  }
});

test('hello still prints the greeting', async () => {
  expect(await fixture.run('hello')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'Hello via Bun!\n',
  });
});

test('command failures print a concise message', async () => {
  expect(await fixture.run('sentry', 'get')).toEqual({
    exitCode: 1,
    stderr:
      'Command failed, No Sentry configuration is saved. Run sentry set with all options.\n',
    stdout: '',
  });
});

test('version reports the manifest version', async () => {
  expect(await fixture.run('--version')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `flightsim-things v${version}\n`,
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
  {
    args: ['hello', 'ai'],
    exitCode: 252,
    stderr: 'Unexpected positional argument: "ai"',
  },
  {
    args: ['--unknown', 'community-path', 'set', 'ai'],
    exitCode: 252,
    stderr: 'Unrecognized flag: --unknown',
  },
  {
    args: ['unknown', 'ai'],
    exitCode: 251,
    stderr: 'Unknown subcommand "unknown"',
  },
])(
  'argument errors show Effect help and preserve exit code for $args',
  async ({args, exitCode, stderr}) => {
    const result = await fixture.run(...args);
    expect(result.exitCode).toBe(exitCode);
    expect(result.stderr).toContain(stderr);
    expect(result.stdout).toContain('USAGE');
  }
);

test('no command and short help print the same root help', async () => {
  expect(await fixture.run()).toEqual(await fixture.run('--help'));
  expect(await fixture.run('-h')).toEqual(await fixture.run('--help'));
});
