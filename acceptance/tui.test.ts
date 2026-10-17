import {afterEach, beforeEach, expect, setDefaultTimeout, test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import {stripVTControlCharacters} from 'node:util';

import createCliFixture from '#acceptance-cli';

import createTerminalSession from './support/terminal.ts';

const testTimeoutMilliseconds = 60_000;
setDefaultTimeout(testTimeoutMilliseconds);

const firstChoice = 0;
const headingLines = 1;
const lineBreak = /\r?\n/u;
const selectedMarker = /^❯ /u;
const successExitCode = 0;
const failureExitCode = 1;
const expectedCommands = [
  'ai',
  'aircraft',
  'airlines',
  'airports',
  'community-path',
  'find-flight',
  'openaip-key',
  'scan',
  'sentry',
  'hello',
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

async function startSession(): Promise<Session> {
  const session = createTerminalSession(fixture.executable, fixture.home);
  sessions.push(session);
  await session.waitFor('Choose a command');
  await session.waitFor('Exit');
  return session;
}

function choose(name: string): string {
  return down.repeat(expectedCommands.indexOf(name)) + enter;
}

async function greet(session: Readonly<Omit<Session, 'exited'>>): Promise<void> {
  session.send(choose('hello'));
  await session.waitFor('Hello via Bun!');
  await session.waitFor('Command completed.');
  await session.waitFor('Choose a command');
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
  await session.waitFor('Choose a command');
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
  await session.waitFor('Choose a command');
  await greet(session);
  await greet(session);
  session.send(controlD);
  expect(await session.exited).toBe(successExitCode);
});

test('collects a masked credential and passes it intact to the command child', async () => {
  const key = 'tui-private-key-$()`';
  const session = await startSession();
  await saveKey(session, key);
  expect(session.output()).not.toContain(key);
  expect(JSON.parse(await readFile(fixture.configurationFile, 'utf8'))).toMatchObject({
    openaipApiKey: key,
  });
  session.send(controlD);
});

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
    await session.waitFor('Choose a command');
    expect(await Bun.file(fixture.configurationFile).exists()).toBe(false);
    await greet(session);
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

test('noninteractive tui fails promptly while no arguments still prints help', async () => {
  const noninteractive = await fixture.run('tui');
  expect(noninteractive.exitCode).toBe(failureExitCode);
  expect(noninteractive.stderr).toContain('requires a terminal');
  const noArguments = await fixture.run();
  expect(noArguments.exitCode).toBe(successExitCode);
  expect(noArguments.stdout).toContain('USAGE');
});
