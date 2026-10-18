import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, setDefaultTimeout, test} from 'bun:test';
import {mkdir, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {stripVTControlCharacters} from 'node:util';

import createCliFixture from '#acceptance-cli';

import createTerminalSession from './support/terminal.ts';

const testTimeoutMilliseconds = 60_000;
setDefaultTimeout(testTimeoutMilliseconds);

const firstChoice = 0;
const headingLines = 1;
const lineBreak = /\r?\n/u;
const selectedMarker = /^[❯>] /u;
const successExitCode = 0;
const failureExitCode = 1;
const expectedCommands = [
  'ai',
  'aircraft',
  'airlines',
  'airports',
  'community-path',
  'database',
  'find-flight',
  'openaip-key',
  'scan',
  'sentry',
];
const commandGroups = [
  {commands: 2, name: 'ai'},
  {commands: 1, name: 'aircraft'},
  {commands: 1, name: 'airlines'},
  {commands: 2, name: 'airports'},
  {commands: 3, name: 'community-path'},
  {commands: 1, name: 'database'},
  {commands: 2, name: 'openaip-key'},
  {commands: 3, name: 'sentry'},
];
const down = '\u001B[B';
const enter = '\r';
const controlD = '\u0004';
const controlC = '\u0003';
const escape = '\u001B';
let fixture: Awaited<ReturnType<typeof createCliFixture>>;
type Session = ReturnType<typeof createTerminalSession>;
let sessions: Session[];

beforeEach(async () => {
  fixture = await createCliFixture();
  sessions = [];
});

afterEach(async () => {
  for (const session of sessions) {
    await session.dispose();
  }

  await fixture.dispose();
});

async function waitForMainMenu(
  session: Readonly<Omit<Session, 'exited'>>
): Promise<void> {
  await session.waitFor('Choose a command');
  await session.waitFor('Exit');
}

async function startSession(
  args: readonly string[] = ['tui'],
  executable: readonly string[] = fixture.executable
): Promise<Session> {
  const session = createTerminalSession(executable, fixture.home, args);
  sessions.push(session);
  await waitForMainMenu(session);
  return session;
}

function choose(name: string): string {
  return down.repeat(expectedCommands.indexOf(name)) + enter;
}

async function listAirlines(session: Readonly<Omit<Session, 'exited'>>): Promise<void> {
  session.send(choose('airlines'));
  await session.waitFor('Command');
  session.send(enter);
  await session.waitFor('Set Aircraft (--aircraft)?');
  session.send(enter);
  await session.waitFor('Set Code (--code)?');
  session.send(enter);
  await session.waitFor('No saved airlines found. Run scan to populate the list.');
  await session.waitFor('Command completed.');
  await waitForMainMenu(session);
}

async function saveKey(
  session: Readonly<Omit<Session, 'exited'>>,
  key: string
): Promise<void> {
  session.send(choose('openaip-key'));
  await session.waitFor('Command');
  session.send(down + enter);
  await session.waitFor('Key');
  session.send(key + enter);
  await session.waitFor('OpenAIP API key saved.');
  await waitForMainMenu(session);
}

async function openKeyPrompt(
  session: Readonly<Omit<Session, 'exited'>>,
  prompt: string
): Promise<void> {
  session.send(choose('openaip-key'));
  await session.waitFor('back');
  if (prompt === 'argument') {
    session.send(down + enter);
    await session.waitFor('Key');
    session.send('discard-this-key');
  }
}

test('ordinary command metadata supplies the menu without a recursive tui entry', async () => {
  const session = await startSession();
  const firstMenu = stripVTControlCharacters(session.output()).split(lineBreak);
  const menuNames = firstMenu
    .slice(headingLines)
    .map(line => line.trim().replace(selectedMarker, '').split(' ').at(firstChoice));
  expect(menuNames).toEqual([...expectedCommands, 'Exit']);
  session.send(down.repeat(expectedCommands.length) + enter);
  expect(await session.exited).toBe(successExitCode);
});

test('returns to the menu after failure and repeated successful commands', async () => {
  const session = await startSession();
  session.send(choose('sentry'));
  await session.waitFor('Command');
  session.send(down + down + enter);
  await session.waitFor('Command exited with code 1.');
  await waitForMainMenu(session);
  await listAirlines(session);
  await listAirlines(session);
  session.send(controlD);
  expect(await session.exited).toBe(successExitCode);
});

test('collects a masked credential and saves it through the existing handler', async () => {
  const key = 'tui-private-key-$()`';
  const session = await startSession();
  await saveKey(session, key);
  expect(session.output()).not.toContain(key);
  expect(JSON.parse(await readFile(fixture.configurationFile, 'utf8'))).toMatchObject({
    openaipApiKey: key,
  });
  session.send(controlD);
});

test.skipIf(process.platform !== 'linux' || typeof Bun.which('strace') !== 'string')(
  'keeps prompted credentials out of process arguments',
  async () => {
    const trace = path.join(fixture.home, 'execve.log');
    const key = 'tui-private-execve-probe';
    const session = await startSession(
      ['tui'],
      [
        'strace',
        '-f',
        '-e',
        'trace=execve',
        '-s',
        '4096',
        '-o',
        trace,
        ...fixture.executable,
      ]
    );
    await saveKey(session, key);
    session.send(controlD);
    expect(await session.exited).toBe(successExitCode);
    expect(await readFile(trace, 'utf8')).not.toContain(key);
  }
);

test('saves a literal navigation label as a directory argument', async () => {
  await mkdir(path.join(fixture.home, 'back'));
  const session = await startSession();
  session.send(choose('community-path'));
  await session.waitFor('back');
  session.send(down + enter);
  await session.waitFor('Path');
  session.send(`back${enter}`);
  await session.waitFor('Command completed.');
  const saved = await fixture.run('community-path', 'get');
  expect(await realpath(saved.stdout.trim())).toBe(
    await realpath(path.join(fixture.home, 'back'))
  );
});

test.each(commandGroups)(
  'returns from $name to the main menu with back',
  async (group: Readonly<{name: string; commands: number}>) => {
    const session = await startSession();
    session.send(choose(group.name));
    await session.waitFor('back');
    session.send(down.repeat(group.commands) + enter);
    await waitForMainMenu(session);
    expect(await Bun.file(fixture.configurationFile).exists()).toBe(false);
    await listAirlines(session);
  }
);

test('runs a settings get command with its complete submenu path', async () => {
  const saved = await fixture.run('community-path', 'set', fixture.home);
  expect(saved.exitCode).toBe(successExitCode);
  const session = await startSession();
  session.send(choose('community-path'));
  await session.waitFor('back');
  session.send(enter);
  await session.waitFor(fixture.home);
  await session.waitFor('Command completed.');
  await waitForMainMenu(session);
});

async function openDatabaseTarget(
  session: Readonly<Omit<Session, 'exited'>>
): Promise<void> {
  session.send(choose('database'));
  await session.waitFor('back');
  session.send(enter);
  await session.waitFor('Target');
  await session.waitFor('packages');
}

async function seedDatabaseAirline(): Promise<void> {
  expect(await fixture.run('airlines', 'list')).toMatchObject({exitCode: 0});
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run("INSERT INTO airlines (icao_code) VALUES ('BAW')");
}

test('clears saved airlines through the database target selection', async () => {
  await seedDatabaseAirline();
  const session = await startSession();
  await openDatabaseTarget(session);
  session.send(down + enter);
  await session.waitFor('Cleared airlines from the saved addon database.');
  await session.waitFor('Command completed.');
  await waitForMainMenu(session);
  expect(await fixture.run('airlines', 'list')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'No saved airlines found. Run scan to populate the list.\n',
  });
});

test('Escape cancels a database target without clearing saved records', async () => {
  await seedDatabaseAirline();
  const session = await startSession();
  await openDatabaseTarget(session);
  session.send(escape);
  await waitForMainMenu(session);
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'), {
    readonly: true,
  });
  expect(db.query('SELECT icao_code FROM airlines').all()).toEqual([{icao_code: 'BAW'}]);
  expect(session.output()).not.toContain('Command completed.');
});

test.each(['submenu', 'argument'])(
  'Escape abandons the %s and returns to the main menu',
  async prompt => {
    const session = await startSession();
    await openKeyPrompt(session, prompt);
    session.send(escape);
    await waitForMainMenu(session);
    expect(await Bun.file(fixture.configurationFile).exists()).toBe(false);
    expect(session.output()).not.toContain('Command completed.');
    expect(session.output()).not.toContain('discard-this-key');
    await listAirlines(session);
  }
);

test.each([controlC, controlD])(
  'exits on %j in submenus and argument prompts',
  async input => {
    for (const prompt of ['submenu', 'argument']) {
      const session = await startSession();
      await openKeyPrompt(session, prompt);
      session.send(input);
      expect(await session.exited).toBe(successExitCode);
      expect(await Bun.file(fixture.configurationFile).exists()).toBe(false);
    }
  }
);

test.each(['--help', '--h', '--v', '-h'])(
  'refuses credential control token %s',
  async token => {
    const session = await startSession();
    session.send(choose('openaip-key'));
    await session.waitFor('Command');
    session.send(down + enter);
    await session.waitFor('Key');
    session.send(`${token}${enter}`);
    await session.waitFor('A value looks like a CLI help or version flag.');
    await waitForMainMenu(session);
    expect(await Bun.file(fixture.configurationFile).exists()).toBe(false);
    await listAirlines(session);
  }
);

test.each([escape, controlC, controlD])(
  'exits on terminal cancellation %j',
  async input => {
    const session = await startSession();
    session.send(input);
    expect(await session.exited).toBe(successExitCode);
  }
);

test('no arguments opens the menu and runs commands', async () => {
  const session = await startSession([]);
  await listAirlines(session);
  session.send(escape);
  expect(await session.exited).toBe(successExitCode);
});

test('noninteractive launches fail promptly with or without the tui command', async () => {
  const noninteractive = await fixture.run('tui');
  expect(noninteractive.exitCode).toBe(failureExitCode);
  expect(noninteractive.stderr).toContain('requires a terminal');
  const noArguments = await fixture.run();
  expect(noArguments.exitCode).toBe(failureExitCode);
  expect(noArguments.stderr).toContain('requires a terminal');
});

const completedMenuCommands = 3;
const sentrySignal = /"type":"(?:event|log|trace_metric|transaction)"/u;

function sentryReceiver(capture: (envelope: string) => void): Bun.Server<unknown> {
  return Bun.serve({
    async fetch(request: Readonly<{text: () => Promise<string>}>): Promise<Response> {
      capture(await request.text());
      return new Response('{}');
    },
    hostname: '127.0.0.1',
    port: 0,
  });
}

async function saveSentryConfiguration(dsn: string): Promise<void> {
  expect(
    await fixture.run(
      'sentry',
      'set',
      '--dsn',
      dsn,
      '--errors',
      '1',
      '--logs',
      '1',
      '--metrics',
      '1',
      '--traces',
      '1'
    )
  ).toMatchObject({exitCode: 0});
}

async function failCommunityPath(
  session: Readonly<Omit<Session, 'exited'>>
): Promise<void> {
  session.send(choose('community-path'));
  await session.waitFor('back');
  session.send(enter);
  await session.waitFor('Command exited with code 1.');
  await waitForMainMenu(session);
}

async function exerciseTrackedCommands(
  session: Readonly<Omit<Session, 'exited'>>
): Promise<void> {
  await listAirlines(session);
  await failCommunityPath(session);
  await saveKey(session, 'private-tui-telemetry-sentinel');
  await listAirlines(session);
  session.send(controlD);
}

function expectMenuTelemetry(payload: string): void {
  expect(payload.match(/CLI command finished/gu)).toHaveLength(completedMenuCommands);
  expect(payload).toContain('cli.command.completed');
  expect(payload).toContain('"type":"event"');
  expect(payload).toContain('"type":"transaction"');
  expect(payload).toContain('"type":"log"');
  expect(payload).toContain('"type":"trace_metric"');
  expect(payload).not.toContain('private-tui-telemetry-sentinel');
  expect(payload).not.toContain(fixture.home);
}

test.each([{args: []}, {args: ['tui']}])(
  'Sentry stays active across repeated menu commands and handled failures for $args',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    const envelopes: string[] = [];
    const server = sentryReceiver(envelope => {
      envelopes.push(envelope);
    });
    try {
      await saveSentryConfiguration(`http://publickey@127.0.0.1:${server.port}/123`);
      const session = await startSession(args);
      await exerciseTrackedCommands(session);
      expect(await session.exited).toBe(successExitCode);
      expectMenuTelemetry(envelopes.join('\n'));
    } finally {
      await server.stop(true);
    }
  }
);

async function setSentryInMenu(
  session: Readonly<Omit<Session, 'exited'>>,
  dsn: string,
  rate: string
): Promise<void> {
  session.send(choose('sentry'));
  await session.waitFor('back');
  session.send(enter);
  for (const [label, value] of [
    ['Sentry DSN', dsn],
    ['Error sample rate from 0 to 1', rate],
    ['Log sample rate from 0 to 1', rate],
    ['Metric sample rate from 0 to 1', rate],
    ['Trace sample rate from 0 to 1', rate],
  ]) {
    await session.waitFor(`${label} (--`);
    session.send(`${value}${enter}`);
  }

  await session.waitFor('Sentry configuration saved.');
  await waitForMainMenu(session);
  await listAirlines(session);
}

async function changeLiveSentry(
  session: Readonly<Omit<Session, 'exited'>>,
  originalPort: number | undefined,
  replacementPort: number | undefined
): Promise<void> {
  await setSentryInMenu(session, `http://publickey@127.0.0.1:${originalPort}/123`, '1');
  await setSentryInMenu(
    session,
    `http://publickey@127.0.0.1:${replacementPort}/123`,
    '0'
  );
}

function expectNoSignals(envelopes: readonly string[]): void {
  expect(envelopes.filter(envelope => sentrySignal.test(envelope))).toEqual([]);
}

async function openSentryUpdate(
  session: Readonly<Omit<Session, 'exited'>>
): Promise<void> {
  session.send(choose('sentry'));
  await session.waitFor('back');
  session.send(down + enter);
  await session.waitFor('Set Sentry DSN (--dsn)?');
  session.send(enter);
}

async function updateSentrySampling(
  session: Readonly<Omit<Session, 'exited'>>
): Promise<void> {
  await openSentryUpdate(session);
  for (const [label, flag] of [
    ['Error sample rate from 0 to 1', 'errors'],
    ['Log sample rate from 0 to 1', 'logs'],
    ['Metric sample rate from 0 to 1', 'metrics'],
    ['Trace sample rate from 0 to 1', 'traces'],
  ]) {
    await session.waitFor(`Set ${label} (--${flag})?`);
    session.send(`y${enter}`);
    await session.waitFor(`${label} (--${flag})`);
    session.send(`1${enter}`);
  }

  await session.waitFor('Sentry configuration saved.');
  await waitForMainMenu(session);
}

async function finishLiveSentry(
  session: Readonly<Omit<Session, 'exited'>>
): Promise<void> {
  await updateSentrySampling(session);
  await listAirlines(session);
  session.send(controlD);
}

async function verifyLiveRefresh(
  first: readonly string[],
  second: readonly string[],
  ports: Readonly<{first: number | undefined; second: number | undefined}>
): Promise<void> {
  const session = await startSession([]);
  await changeLiveSentry(session, ports.first, ports.second);
  expectNoSignals(second);
  const originalCount = first.length;
  await finishLiveSentry(session);
  expect(await session.exited).toBe(successExitCode);
  expect(first).toHaveLength(originalCount);
  expect(first.join('\n')).toContain('cli.command.completed');
  expect(second.join('\n')).toContain('cli.command.completed');
  expect(second.join('\n')).toContain('"type":"transaction"');
}

test('menu set activates and replaces the DSN while update refreshes sampling', async () => {
  const first: string[] = [];
  const second: string[] = [];
  const original = sentryReceiver(envelope => {
    first.push(envelope);
  });
  const replacement = sentryReceiver(envelope => {
    second.push(envelope);
  });
  try {
    await verifyLiveRefresh(first, second, {
      first: original.port,
      second: replacement.port,
    });
  } finally {
    await original.stop(true);
    await replacement.stop(true);
  }
});
