import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, setDefaultTimeout, test} from 'bun:test';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {stripVTControlCharacters} from 'node:util';

import createCliFixture from '#acceptance-cli';

import createTerminalSession from './support/terminal.ts';

const timeoutMilliseconds = 30_000;
setDefaultTimeout(timeoutMilliseconds);
const enter = '\r';
const down = '\u001B[B';
const controlC = '\u0003';
const controlD = '\u0004';
const successExitCode = 0;
const failureExitCode = 1;
const argumentExitCode = 252;
const setIndex = 1;
const oneCommand = 1;
const itemLines = 2;
const noCommands = 0;
const sentinel = 'wizard-fake-credential-45';
const newline = /\r?\n/u;
const commands = [
  'ai',
  'aircraft',
  'airlines',
  'airports',
  'community-path',
  'database',
  'find-flight',
  'liveries',
  'openaip-key',
  'scan',
  'sentry',
];
let fixture: Awaited<ReturnType<typeof createCliFixture>>;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type Session = Readonly<Omit<ReturnType<typeof createTerminalSession>, 'exited'>>;
let sessions: ReturnType<typeof createTerminalSession>[];
let envelopes: string[];
let server: Bun.Server<unknown>;

beforeEach(async () => {
  fixture = await createCliFixture();
  sessions = [];
  envelopes = [];
  server = Bun.serve({
    async fetch(request: Readonly<{text: () => Promise<string>}>): Promise<Response> {
      envelopes.push(await request.text());
      return new Response('{}');
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  expect(
    await fixture.run(
      'sentry',
      'set',
      '--dsn',
      `http://publickey@127.0.0.1:${server.port}/123`,
      '--errors',
      '1',
      '--logs',
      '1',
      '--metrics',
      '1',
      '--traces',
      '1'
    )
  ).toMatchObject({exitCode: successExitCode});
});

afterEach(async () => {
  for (const session of sessions) {
    await session.dispose();
  }

  await server.stop(true);
  await fixture.dispose();
});

function start(
  args: readonly string[],
  executable: readonly string[] = fixture.executable
): ReturnType<typeof createTerminalSession> {
  const session = createTerminalSession(executable, fixture.home, args);
  sessions.push(session);
  return session;
}

function payloads(type: string): readonly string[] {
  return envelopes.flatMap(envelope => {
    const lines = envelope.split(newline);
    const payload: string[] = [];
    for (let index = oneCommand; index < lines.length; index += itemLines) {
      const header = lines.at(index) ?? '';
      if (header.includes(`"type":"${type}"`)) {
        payload.push(lines.at(index + oneCommand) ?? '');
      }
    }

    return payload;
  });
}

async function answer(session: Session, prompt: string, input = enter): Promise<void> {
  await session.waitFor(prompt);
  session.send(input);
}

async function chooseRoot(session: Session, name: string): Promise<void> {
  await answer(session, 'scan', down.repeat(commands.indexOf(name)) + enter);
  expect(session.output()).not.toContain('tui');
  await answer(session, '  set ', down.repeat(setIndex) + enter);
}

async function finishConfirmation(
  session: DeepReadonly<ReturnType<typeof createTerminalSession>>,
  exitCode = successExitCode
): Promise<void> {
  session.send(`y${enter}`);
  expect(await session.exited).toBe(exitCode);
}

async function confirm(
  session: DeepReadonly<ReturnType<typeof createTerminalSession>>,
  exitCode = successExitCode
): Promise<void> {
  await session.waitFor('Run this command?');
  await finishConfirmation(session, exitCode);
}

async function collectSecret(
  session: Session,
  name: string,
  model = '--wizard'
): Promise<void> {
  if (name === 'ai') {
    await answer(session, 'Your provider API key', `${sentinel}${enter}`);
    await answer(session, 'Your provider model ID', `${model}${enter}`);
    await answer(session, 'AI provider');
  } else {
    await answer(session, 'Key', `${sentinel}${enter}`);
  }
}

function expectNoCommand(): void {
  expect(envelopes).toHaveLength(noCommands);
}

async function expectSavedSecret(session: Session, name: string): Promise<void> {
  expect(session.output()).not.toContain(sentinel);
  expect(session.output()).toContain('*'.repeat(sentinel.length));
  expect(await readFile(fixture.configurationFile, 'utf8')).toContain(sentinel);
  if (name === 'ai') {
    expect(await fixture.run('ai', 'get')).toMatchObject({
      exitCode: successExitCode,
      stdout: 'Provider: anthropic\nModel: --wizard\nAPI key: <redacted>\n',
    });
  }

  expectNoCommand();
}

function expectOneCommand(): void {
  expect(payloads('transaction')).toHaveLength(oneCommand);
  expect(
    payloads('log')
      .join('\n')
      .match(/CLI command finished/gu)
  ).toHaveLength(oneCommand);
  const metrics = payloads('trace_metric').map((payload): unknown => JSON.parse(payload));
  expect(metrics).toEqual([
    expect.objectContaining({
      items: [
        expect.objectContaining({
          name: 'cli.command.completed',
          type: 'counter',
          value: oneCommand,
        }),
      ],
    }),
  ]);
  expect(envelopes.join('\n')).not.toContain(fixture.home);
}

async function expectPendingCommand(session: Session, name: string): Promise<void> {
  await session.waitFor('Run this command?');
  expect(stripVTControlCharacters(session.output())).toContain(
    `Command: flightsim-things ${name} (values omitted)`
  );
  expectNoCommand();
}

function expectMasked(session: Session): void {
  expect(session.output()).toContain('\u001B[?25h');
  expect(session.output()).not.toContain(sentinel);
}

async function expectSavedDirectory(session: Session, directory: string): Promise<void> {
  const lines = stripVTControlCharacters(session.output()).split(newline);
  expect(lines.filter(line => line === directory)).toHaveLength(oneCommand);
  expect(await readFile(fixture.configurationFile, 'utf8')).toContain(directory);
  expectOneCommand();
}

test.each([
  {args: ['--wizard'], root: true},
  {args: ['community-path', 'set', '--wizard'], root: false},
])(
  'confirms one tracked command for $args',
  async ({args, root}: Readonly<{args: readonly string[]; root: boolean}>) => {
    const directory = path.join(fixture.home, 'Community');
    await mkdir(directory);
    const session = start(args);
    if (root) {
      await chooseRoot(session, 'community-path');
    }

    await answer(session, 'Path', `${directory}${enter}`);
    await expectPendingCommand(session, 'community-path set');
    await finishConfirmation(session);
    await expectSavedDirectory(session, directory);
  }
);

test('a nested confirmed command records one semantic completion of each kind', async () => {
  const session = start(['airlines', 'list', '--wizard']);
  await session.waitFor('Set');
  session.send(enter);
  await session.waitFor('Set');
  session.send(enter);
  await session.waitFor('Run this command?');
  session.send(`y${enter}`);
  expect(await session.exited).toBe(successExitCode);
  expect(session.output()).toContain(
    'No saved airlines found. Run scan to populate the list.'
  );
  expectOneCommand();
});

test.each([enter, controlC, controlD])(
  'declines or cancels final confirmation with %j',
  async input => {
    const session = start(['community-path', 'set', '--wizard']);
    const before = await readFile(fixture.configurationFile, 'utf8');
    await session.waitFor('Path');
    session.send(`${fixture.home}${enter}`);
    await session.waitFor('Run this command?');
    session.send(input);
    expect(await session.exited).toBe(successExitCode);
    expect(await readFile(fixture.configurationFile, 'utf8')).toBe(before);
    expect(
      await Bun.file(path.join(fixture.home, '.flightsim-things/addons.sqlite')).exists()
    ).toBe(false);
    expectNoCommand();
  }
);

test.each([controlC, controlD])('cancels collection with %j', async input => {
  const session = start(['openaip-key', 'set', '--wizard']);
  const before = await readFile(fixture.configurationFile, 'utf8');
  await session.waitFor('Key');
  session.send(sentinel);
  await session.waitFor('*');
  session.send(input);
  expect(await session.exited).toBe(successExitCode);
  expect(await readFile(fixture.configurationFile, 'utf8')).toBe(before);
  expectMasked(session);
  expectNoCommand();
});

test.each(['ai', 'openaip-key'])(
  'root-selected %s masks passwords and retains telemetry exclusions',
  async name => {
    const session = start(['--wizard']);
    await chooseRoot(session, name);
    await collectSecret(session, name);
    await confirm(session);
    await expectSavedSecret(session, name);
  }
);

test.each(['--help', '-h', '-hv', '--version', '--completions', '--wizard', '--'])(
  'rejects generated positional control %j without echo',
  async value => {
    const before = await readFile(fixture.configurationFile, 'utf8');
    const session = start(['openaip-key', 'set', '--wizard']);
    await session.waitFor('Key');
    session.send(`${value}${enter}`);
    expect(await session.exited).toBe(argumentExitCode);
    expect(session.output()).toContain('A value looks like a CLI control flag.');
    expect(session.output()).not.toContain(`${value}\r`);
    expect(session.output()).not.toContain('Run this command?');
    expect(await readFile(fixture.configurationFile, 'utf8')).toBe(before);
    expectNoCommand();
  }
);

test.each(
  [
    ['--wizard', sentinel],
    ['ai', 'set', '--api-key', sentinel, '--wizard'],
    ['ai', 'set', `--api-key=${sentinel}`, '--wizard'],
    ['openaip-key', 'set', sentinel, '--wizard'],
    ['tui', '--wizard'],
    ['unknown', '--wizard'],
    ['--wizard=true'],
    ['--wizard', 'false'],
    ['--no-wizard'],
    ['--wizard', '--wizard'],
  ].map((args: readonly string[]) => ({args}))
)(
  'rejects supplied values or malformed paths $args',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    const before = await readFile(fixture.configurationFile, 'utf8');
    const result = await fixture.run(...args);
    expect(result).toEqual({
      exitCode: argumentExitCode,
      stderr:
        'Wizard accepts a command path only. Enter values at the prompts. Run flightsim-things --help for usage.\n',
      stdout: '',
    });
    expect(await readFile(fixture.configurationFile, 'utf8')).toBe(before);
    expectNoCommand();
  }
);

test.each(
  [
    ['--wizard', '--completions', sentinel],
    ['--wizard', '--completions'],
    ['--wizard', `--completions=${sentinel}`],
    ['--wizard', `--help=${sentinel}`],
    ['--wizard', `--version=${sentinel}`],
    ['--wizard', '--completions', sentinel, `--unknown=${sentinel}`],
  ].map((args: readonly string[]) => ({args}))
)(
  'sanitizes higher-control failures $args',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    const result = await fixture.run(...args);
    expect(result.exitCode).not.toBe(successExitCode);
    expect(result.stderr).toBe(
      'Invalid command arguments. Run flightsim-things --help for usage.\n'
    );
    expect(result.stdout).not.toContain(sentinel);
    expectNoCommand();
  }
);

test.each(
  [
    ['--help'],
    ['--version'],
    ['--completions', 'bash'],
    ['airlines', '--help'],
    ['airlines', '--completions', 'fish'],
  ].map((args: readonly string[]) => ({args}))
)(
  'preserves higher-control output for $args',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    const ordinary = await fixture.run(...args);
    const wizard = await fixture.run('--wizard', ...args);
    expect(wizard).toEqual(ordinary);
    expect(wizard.exitCode).toBe(successExitCode);
    expectNoCommand();
  }
);

test.each(
  [['--wizard'], ['community-path', 'set', '--wizard']].map(
    (args: readonly string[]) => ({args})
  )
)('requires terminals for $args', async ({args}: Readonly<{args: readonly string[]}>) => {
  expect(await fixture.run(...args)).toEqual({
    exitCode: failureExitCode,
    stderr:
      'Wizard requires a terminal for input and output. Run flightsim-things --help for CLI usage.\n',
    stdout: '',
  });
  expectNoCommand();
});

test('preserves a confirmed handler failure and records one failed attempt', async () => {
  const session = start(['community-path', 'get', '--wizard']);
  await session.waitFor('Run this command?');
  session.send(`y${enter}`);
  expect(await session.exited).toBe(failureExitCode);
  expect(session.output()).toContain('Command failed,');
  expectOneCommand();
  expect(payloads('event')).toHaveLength(oneCommand);
});

async function seedAirlines(): Promise<void> {
  await fixture.run('airlines', 'list');
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run(
    "INSERT INTO airlines (icao_code, iata_code, name) VALUES ('BAW', 'BA', 'British Airways'), ('DAL', 'DL', 'Delta Air Lines')"
  );
  envelopes.length = noCommands;
}

test('uses ordinary optional filters through the parser', async () => {
  await seedAirlines();
  const session = start(['airlines', '--wizard']);
  await answer(session, 'Command');
  await answer(session, 'Set Aircraft');
  await answer(session, 'Set Code', `y${enter}`);
  await answer(session, 'Code (--code)', `BAW${enter}`);
  await confirm(session);
  expect(session.output()).toContain('British Airways');
  expect(session.output()).not.toContain('Delta Air Lines');
  expectOneCommand();
});

test('inline values and operands after the delimiter do not request a wizard', async () => {
  expect(
    await fixture.run(
      'ai',
      'set',
      '--api-key',
      sentinel,
      '--provider',
      'openai',
      '--model=--wizard'
    )
  ).toMatchObject({exitCode: successExitCode});
  expect(await fixture.run('openaip-key', 'set', '--', '--wizard')).toMatchObject({
    exitCode: successExitCode,
  });
  expectNoCommand();
});

test.each(['</dev/null', '>/dev/null'])(
  'requires each terminal independently with %s',
  async redirect => {
    const session = start(
      ['--wizard'],
      ['bash', '-c', `exec "$@" ${redirect}`, 'wizard-redirection', ...fixture.executable]
    );
    expect(await session.exited).toBe(failureExitCode);
    expect(session.output()).toContain(
      'Wizard requires a terminal for input and output.'
    );
    expectNoCommand();
  }
);

test.each(['--help', '--wizard'])(
  'retains inline flag data %j after confirmation',
  async model => {
    const session = start(['ai', 'set', '--wizard']);
    await collectSecret(session, 'ai', model);
    await confirm(session);
    expect(await fixture.run('ai', 'get')).toMatchObject({
      exitCode: successExitCode,
      stdout: `Provider: anthropic\nModel: ${model}\nAPI key: <redacted>\n`,
    });
    expectMasked(session);
    expectNoCommand();
  }
);

test('root-selected sensitive failure preserves the exit code without reporting secrets', async () => {
  const before = await readFile(fixture.configurationFile, 'utf8');
  const session = start(['--wizard']);
  await chooseRoot(session, 'ai');
  await collectSecret(session, 'ai', 'invalid model');
  await confirm(session, failureExitCode);
  expect(session.output()).toContain('Command failed, AI configuration requires');
  expectMasked(session);
  expect(await readFile(fixture.configurationFile, 'utf8')).toBe(before);
  expectNoCommand();
});
