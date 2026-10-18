import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createCliFixture from '#acceptance-cli';
import {version} from '#package';

import createTerminalSession from './support/terminal.ts';

const successExitCode = 0;
const failureExitCode = 1;
const invalidArgumentsExitCode = 252;
const generationMatrixTimeoutMilliseconds = 15_000;
let fixture: Awaited<ReturnType<typeof createCliFixture>>;

beforeEach(async () => {
  fixture = await createCliFixture();
});

afterEach(async () => {
  await fixture.dispose();
});

test.each([
  {marker: 'Static completion script for Bash', shell: 'bash'},
  {marker: 'Static completion script for Bash', shell: 'sh'},
  {marker: '#compdef flightsim-things', shell: 'zsh'},
  {marker: 'complete -c flightsim-things', shell: 'fish'},
])(
  'generates $shell from the command tree without creating local data',
  async ({shell, marker}) => {
    const result = await fixture.run('--completions', shell);
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain(marker);
    for (const candidate of [
      'community-path',
      'scan',
      '--verbose',
      'find-flight',
      'openai',
    ]) {
      expect(result.stdout).toContain(candidate);
    }

    expect(result.stdout.endsWith('\n')).toBe(true);
    expect(await readdir(fixture.home)).not.toContain('.flightsim-things');
  }
);

type SavedFile = Readonly<{file: string; contents: string}>;

async function seedLocalData(): Promise<readonly SavedFile[]> {
  await mkdir(path.dirname(fixture.configurationFile), {recursive: true});
  const files = [
    {
      contents: '{"future":{"keep":true},"communityPath":"missing-directory"}\n',
      file: fixture.configurationFile,
    },
    {
      contents: 'not a database, a command handler must not open this',
      file: path.join(path.dirname(fixture.configurationFile), 'addons.sqlite'),
    },
  ];
  for (const {file, contents} of files) {
    await writeFile(file, contents);
  }

  return files;
}

test(
  'root, nested, inline, and repeated actions generate the same complete script without writes',
  async () => {
    const files = await seedLocalData();
    const baseline = await fixture.run('--completions', 'bash');
    expect(baseline.exitCode).toBe(successExitCode);
    expect(baseline.stderr).toBe('');
    for (const args of [
      ['--completions', 'bash', 'ai', 'set'],
      ['ai', '--completions=bash'],
      ['ai', 'set', '--completions', 'bash'],
      ['openaip-key', 'set', '--completions', 'bash'],
      ['database', 'clear', 'all', '--completions', 'bash'],
      ['scan', '-completions=bash'],
      ['tui', '--completions', 'bash'],
      ['--completions', 'bash', '--completions', 'fish'],
    ]) {
      expect(await fixture.run(...args)).toEqual(baseline);
    }

    for (const {file, contents} of files) {
      expect(await readFile(file, 'utf8')).toBe(contents);
    }

    const storageFiles = await readdir(path.dirname(fixture.configurationFile));
    expect(storageFiles.toSorted()).toEqual(['addons.sqlite', 'config.json']);
  },
  generationMatrixTimeoutMilliseconds
);

test('malformed telemetry configuration preserves script stdout and saved bytes', async () => {
  const baseline = await fixture.run('--completions', 'bash');
  await mkdir(path.dirname(fixture.configurationFile), {recursive: true});
  const contents = '{"sentry":{"dsn":"private-invalid-dsn"}}\n';
  await writeFile(fixture.configurationFile, contents);
  const result = await fixture.run('--completions', 'bash');
  expect(result).toMatchObject({exitCode: successExitCode, stdout: baseline.stdout});
  expect(result.stderr).toContain('Sentry telemetry skipped.');
  expect(result.stderr).not.toContain('private-invalid-dsn');
  expect(await readFile(fixture.configurationFile, 'utf8')).toBe(contents);
  expect(await readdir(path.dirname(fixture.configurationFile))).toEqual(['config.json']);
});

test.each(['invalid-shell', 'powershell', 'pwsh', '-', '-3'])(
  'rejects unsupported shell %j through native validation',
  async shell => {
    const result = await fixture.run('--completions', shell);
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Invalid value for flag --completions');
    expect(await readdir(fixture.home)).not.toContain('.flightsim-things');
  }
);

test('an empty completion value retains native validation failure behavior', async () => {
  for (const args of [['--completions', ''], ['--completions=']]) {
    const result = await fixture.run(...args);
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Missing value for flag --completions');
  }
});

test.each(
  [
    ['--completions'],
    ['--completions', '--help'],
    ['--help', '--completions'],
    ['--completions', '--'],
  ].map((args: readonly string[]) => ({args}))
)(
  'retains missing-operand exit behavior for $args',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    const result = await fixture.run(...args);
    expect(result.exitCode).toBe(invalidArgumentsExitCode);
    expect(result.stderr).toContain('Missing value for flag --completions');
    expect(result.stdout).not.toContain('Static completion script');
  }
);

test('help and version retain native precedence over completion actions', async () => {
  for (const args of [
    ['--completions', 'invalid-shell', '--help'],
    ['--help', '--completions', 'bash'],
  ]) {
    const result = await fixture.run(...args);
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('USAGE');
    expect(result.stdout).not.toContain('Static completion script');
  }

  expect(await fixture.run('--completions', 'fish', '--version')).toEqual({
    exitCode: successExitCode,
    stderr: '',
    stdout: `flightsim-things v${version}\n`,
  });
});

test.each([
  {
    args: ['ai', 'set', '--completions=private-shell'],
    command: 'AI',
    exitCode: failureExitCode,
    root: 'ai',
  },
  {
    args: ['--completions', 'private-shell', 'ai', 'set'],
    command: 'AI',
    exitCode: failureExitCode,
    root: 'ai',
  },
  {
    args: ['openaip-key', 'set', 'private-key', '-completions=private-shell'],
    command: 'OpenAIP key',
    exitCode: failureExitCode,
    root: 'openaip-key',
  },
  {
    args: ['--unknown', 'private-key', 'ai', 'set', '--completions=private-shell'],
    command: 'AI',
    exitCode: failureExitCode,
    root: 'ai',
  },
  {
    args: ['openaip-key', 'set', 'private-key', '--completions'],
    command: 'OpenAIP key',
    exitCode: invalidArgumentsExitCode,
    root: 'openaip-key',
  },
])(
  'masks every sensitive completion parse failure for $args',
  async ({args, command, root, exitCode}) => {
    const result = await fixture.run(...args);
    expect(result.exitCode).toBe(exitCode);
    expect(result.stderr).toBe(
      `Invalid ${command} command arguments. Run flightsim-things ${root} --help for usage.\n`
    );
    expect(result.stdout + result.stderr).not.toContain('private-');
    expect(await readdir(fixture.home)).not.toContain('.flightsim-things');
  }
);

test('delimiter and inline credential values preserve ordinary command execution', async () => {
  expect(await fixture.run('openaip-key', 'set', '--', '--completions')).toEqual({
    exitCode: successExitCode,
    stderr: '',
    stdout: 'OpenAIP API key saved.\n',
  });
  expect(await fixture.run('openaip-key', 'get')).toMatchObject({
    stdout: '--completions\n',
  });
  const ai = await fixture.run(
    'ai',
    'set',
    '--provider',
    'openai',
    '--model',
    'model',
    '--api-key=--completions'
  );
  expect(ai.exitCode).toBe(successExitCode);
  expect(ai.stdout).not.toContain('Static completion script');
});

async function assertBashCandidates(
  session: Readonly<Pick<ReturnType<typeof createTerminalSession>, 'send' | 'waitFor'>>
): Promise<void> {
  session.send('source ./completion.bash\n');
  session.send(
    'COMP_WORDS=(flightsim-things sc); COMP_CWORD=1; COMP_LINE="flightsim-things sc"; _flightsim_things; printf "ROOT=%s\\n" "$COMPREPLY"\n'
  );
  await session.waitFor('ROOT=scan');
  session.send(
    'COMP_WORDS=(flightsim-things scan --v); COMP_CWORD=2; COMP_LINE="flightsim-things scan --v"; _flightsim_things; printf "FLAG=%s\\n" "$COMPREPLY"\n'
  );
  await session.waitFor('FLAG=--verbose');
}

const bash = Bun.which('bash');
test.skipIf(bash === null || process.platform === 'win32')(
  'Bash loads the generated registration and completes root commands and nested flags',
  async () => {
    const generated = await fixture.run('--completions', 'bash');
    expect(generated.exitCode).toBe(successExitCode);
    await writeFile(path.join(fixture.home, 'completion.bash'), generated.stdout);
    const session = createTerminalSession(
      [bash ?? 'bash', '--noprofile', '--norc'],
      fixture.home,
      ['-i']
    );
    try {
      await assertBashCandidates(session);
      session.send('exit\n');
      expect(await session.exited).toBe(successExitCode);
      expect(await readdir(fixture.home)).not.toContain('.flightsim-things');
    } finally {
      await session.dispose();
    }
  }
);

async function verifyShellSyntax(shell: string): Promise<void> {
  const generated = await fixture.run('--completions', shell);
  expect(generated.exitCode).toBe(successExitCode);
  const child = Bun.spawn([shell, '-n'], {
    stderr: 'pipe',
    stdin: new Blob([generated.stdout]),
    stdout: 'pipe',
  });
  expect(await child.exited).toBe(successExitCode);
  expect(await new Response(child.stderr).text()).toBe('');
}

test.skipIf(Bun.which('zsh') === null)('validates generated Zsh syntax', async () => {
  await verifyShellSyntax('zsh');
});

test.skipIf(Bun.which('fish') === null)('validates generated Fish syntax', async () => {
  await verifyShellSyntax('fish');
});
