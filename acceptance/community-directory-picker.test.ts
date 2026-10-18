import {afterEach, beforeEach, expect, setDefaultTimeout, test} from 'bun:test';
import {chmod, mkdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {stripVTControlCharacters} from 'node:util';

import createCliFixture from '#acceptance-cli';

import createTerminalSession from './support/terminal.ts';

const testTimeoutMilliseconds = 60_000;
setDefaultTimeout(testTimeoutMilliseconds);
const down = '\u001B[B';
const enter = '\r';
const escape = '\u001B';
const controlC = '\u0003';
const controlD = '\u0004';
const communityCommandIndex = 4;
const operationIndex = {set: 1, update: 2};
const manualIndex = 1;
const backIndex = 2;
const successExitCode = 0;
const invalidArgumentsExitCode = 252;
const unreadableMode = 0o000;
const directoryMode = 0o700;
const pageDirectoryCount = 12;
const padLength = 2;
const firstDirectoryOffset = 1;
const directoriesPerPage = 8;
const selectedDirectory = /^❯ (?<name>Community-\d+)/gmu;
const traversalQuestion = 'Would you like to traverse the selected directory?';
type Operation = keyof typeof operationIndex;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type Session = DeepReadonly<ReturnType<typeof createTerminalSession>>;
let fixture: Awaited<ReturnType<typeof createCliFixture>>;
let sessions: Session[];
let restricted: string[];

beforeEach(async () => {
  fixture = await createCliFixture();
  sessions = [];
  restricted = [];
});

afterEach(async () => {
  for (const session of sessions) {
    await session.dispose();
  }

  for (const directory of restricted) {
    await chmod(directory, directoryMode);
  }

  await fixture.dispose();
});

async function mainMenu(session: Readonly<Omit<Session, 'exited'>>): Promise<void> {
  await session.waitFor('Choose a command');
  await session.waitFor('Exit');
}

async function start(): Promise<Session> {
  const session = createTerminalSession(fixture.executable, fixture.home);
  sessions.push(session);
  await mainMenu(session);
  return session;
}

async function open(
  session: Readonly<Omit<Session, 'exited'>>,
  operation: Operation = 'set'
): Promise<void> {
  session.send(down.repeat(communityCommandIndex) + enter);
  await session.waitFor('back');
  session.send(down.repeat(operationIndex[operation]) + enter);
  await session.waitFor('Enter a path');
  await session.waitFor('back');
}

async function browse(session: Readonly<Omit<Session, 'exited'>>): Promise<void> {
  session.send(enter);
  await session.waitFor('Choose a Community directory');
  await session.waitFor('..');
}

async function filter(
  session: Readonly<Omit<Session, 'exited'>>,
  name: string
): Promise<void> {
  session.send(name);
  await session.waitFor(`${name}\u001B[0m]`);
}

async function manual(session: Readonly<Omit<Session, 'exited'>>): Promise<void> {
  session.send(down.repeat(manualIndex) + enter);
  await session.waitFor('Path');
}

async function failedCommand(session: Readonly<Omit<Session, 'exited'>>): Promise<void> {
  await session.waitFor('Command exited with code 1.');
  await mainMenu(session);
}

async function completed(session: Session, expected: string): Promise<void> {
  await session.waitFor('Command completed.');
  await mainMenu(session);
  expect(await fixture.run('community-path', 'get')).toMatchObject({
    exitCode: successExitCode,
    stdout: `${expected}\n`,
  });
  session.send(controlD);
  expect(await session.exited).toBe(successExitCode);
}

async function configuration(): Promise<string> {
  if (!(await Bun.file(fixture.configurationFile).exists())) {
    return '';
  }

  return readFile(fixture.configurationFile, 'utf8');
}

async function seed(directory: string): Promise<void> {
  expect(await fixture.run('community-path', 'set', directory)).toMatchObject({
    exitCode: successExitCode,
  });
}

async function startSource(operation: Operation = 'set'): Promise<Session> {
  const session = await start();
  await open(session, operation);
  return session;
}

async function startBrowser(operation: Operation = 'set'): Promise<Session> {
  const session = await startSource(operation);
  await browse(session);
  return session;
}

async function openManual(
  session: Readonly<Omit<Session, 'exited'>>,
  operation: Operation
): Promise<void> {
  await open(session, operation);
  await manual(session);
}

async function confirmDirectory(
  session: Readonly<Omit<Session, 'exited'>>,
  name: string
): Promise<void> {
  await filter(session, name);
  session.send(enter);
  await session.waitFor(traversalQuestion);
}

test.each(['set', 'update'] as const)(
  '%s selects a spaced directory with subdirectories using n',
  async operation => {
    const directory = path.join(fixture.home, 'MSFS 2024 Community');
    await mkdir(path.join(directory, 'addon'), {recursive: true});
    const session = await startBrowser(operation);
    expect(session.output()).toContain('press y to enter or n to select');
    await confirmDirectory(session, 'MSFS 2024 Community');
    expect(await configuration()).toBe('');
    session.send('n');
    await completed(session, directory);
  }
);

test('y traverses a directory and submits its spaced child', async () => {
  const directory = path.join(fixture.home, 'MSFS', 'Community with spaces');
  await mkdir(directory, {recursive: true});
  const session = await startBrowser('update');
  await confirmDirectory(session, 'MSFS');
  session.send('y');
  await session.waitFor('Community with spaces');
  await filter(session, 'Community with spaces');
  session.send(enter);
  await completed(session, directory);
});

test('manual entry preserves quoted tilde normalization and blank rejection', async () => {
  const directory = path.join(fixture.home, 'Manual Community');
  await mkdir(directory);
  const session = await startSource();
  await manual(session);
  session.send(enter);
  await failedCommand(session);
  expect(await configuration()).toBe('');
  await openManual(session, 'update');
  session.send(`~/Manual Community${enter}`);
  await completed(session, directory);
});

test('back leaves settings absent and the menu usable', async () => {
  const session = await startSource();
  session.send(down.repeat(backIndex) + enter);
  await mainMenu(session);
  expect(await configuration()).toBe('');
  await openManual(session, 'update');
  session.send(fixture.home + enter);
  await completed(session, fixture.home);
});

test('browsing highlights an existing saved directory', async () => {
  const directory = path.join(fixture.home, 'Saved Community');
  await mkdir(directory);
  await seed(directory);
  const before = await configuration();
  const session = await startBrowser('update');
  expect(await configuration()).toBe(before);
  session.send(enter);
  await completed(session, directory);
});

async function removeSavedDirectory(missing: string): Promise<void> {
  const parent = path.join(fixture.home, 'old');
  const directory = path.join(parent, 'Community');
  await mkdir(directory, {recursive: true});
  await seed(directory);
  if (missing === 'parent') {
    await rm(parent, {recursive: true});
    return;
  }

  await rm(directory, {recursive: true});
}

test.each(['target', 'parent'])(
  'a missing saved %s falls back to the working directory',
  async missing => {
    await removeSavedDirectory(missing);
    const replacement = path.join(fixture.home, 'Replacement');
    await mkdir(replacement);
    const session = await start();
    await open(session, 'update');
    expect(session.output()).toContain('Choose a replacement.');
    await browse(session);
    await filter(session, 'Replacement');
    session.send(enter);
    await completed(session, replacement);
  }
);

test('a symlink selection retains its lexical path', async () => {
  const target = path.join(fixture.home, 'target');
  const link = path.join(fixture.home, 'Linked Community');
  await mkdir(target);
  await symlink(target, link, 'dir');
  const session = await startBrowser();
  await filter(session, 'Linked Community');
  session.send(enter);
  await completed(session, link);
});

function selectedDirectoryCount(output: string): number {
  const frames = stripVTControlCharacters(output);
  const names = new Set<string>();
  for (const match of frames.matchAll(selectedDirectory)) {
    if (match.groups) {
      names.add(match.groups.name ?? '');
    }
  }

  return names.size;
}

test('arrow navigation reaches directories beyond the first page', async () => {
  const names = Array.from(
    {length: pageDirectoryCount},
    (_value, index) => `Community-${String(index).padStart(padLength, '0')}`
  );
  await Promise.all(
    names.map(async name => {
      await mkdir(path.join(fixture.home, name));
    })
  );
  const session = await startBrowser();
  await filter(session, 'Community');
  const beforePaging = session.output().length;
  session.send(`${down.repeat(pageDirectoryCount - firstDirectoryOffset)}-11`);
  await session.waitFor(`Community-11${escape}[0m]`);
  expect(selectedDirectoryCount(session.output().slice(beforePaging))).toBeGreaterThan(
    directoriesPerPage
  );
  session.send(enter);
  await completed(session, path.join(fixture.home, 'Community-11'));
});

test('a saved filesystem root opens at root and can be selected', async () => {
  const {root} = path.parse(fixture.home);
  await seed(root);
  const session = await startBrowser('update');
  session.send(enter);
  await session.waitFor(traversalQuestion);
  session.send('n');
  await completed(session, root);
});

const cancellationCases = [
  'source',
  'manual',
  'browser',
  'confirmation',
  'traversal',
].flatMap(stage => [escape, controlC, controlD].map(key => ({key, stage})));

async function reachBrowserStage(
  session: Readonly<Omit<Session, 'exited'>>,
  stage: string
): Promise<void> {
  await browse(session);
  if (stage === 'confirmation' || stage === 'traversal') {
    session.send(enter);
    await session.waitFor(traversalQuestion);
    if (stage === 'traversal') {
      session.send('y');
      await session.waitFor('child');
    }
  }
}

async function reachStage(
  session: Readonly<Omit<Session, 'exited'>>,
  stage: string
): Promise<void> {
  if (stage === 'manual') {
    await manual(session);
    session.send('unfinished');
    await session.waitFor('unfinished');
  } else if (stage !== 'source') {
    await reachBrowserStage(session, stage);
  }
}

async function cancellationSession(
  stage: string
): Promise<Readonly<{session: Session; before: string}>> {
  const directory = path.join(fixture.home, 'Saved');
  await mkdir(path.join(directory, 'child'), {recursive: true});
  if (stage !== 'source' && stage !== 'manual') {
    await seed(directory);
  }

  const before = await configuration();
  const session = await startSource('update');
  await reachStage(session, stage);
  return {before, session};
}

test.each(cancellationCases)(
  'cancels at $stage with $key without writing settings',
  async ({key, stage}: Readonly<{key: string; stage: string}>) => {
    const {session, before} = await cancellationSession(stage);
    session.send(key);
    if (key === escape) {
      await mainMenu(session);
      session.send(controlD);
    }

    expect(await session.exited).toBe(successExitCode);
    expect(await configuration()).toBe(before);
    expect(session.output()).not.toContain('Command completed.');
  }
);

async function causeBrowserFailure(failure: string): Promise<void> {
  if (failure === 'broken link') {
    await symlink(path.join(fixture.home, 'missing'), path.join(fixture.home, 'broken'));
  } else {
    const blocked = path.join(fixture.home, 'Blocked');
    await mkdir(blocked);
    restricted.push(blocked);
    await chmod(blocked, unreadableMode);
  }
}

async function failBrowser(
  session: Readonly<Omit<Session, 'exited'>>,
  failure: string
): Promise<void> {
  session.send(enter);
  if (failure === 'permissions') {
    await session.waitFor('Choose a Community directory');
    await filter(session, 'Blocked');
    session.send(enter);
  }

  await session.waitFor('Could not browse this directory. Enter a path or try again.');
  await session.waitFor('back');
}

async function failedBrowserSession(
  failure: string
): Promise<Readonly<{session: Session; before: string}>> {
  const saved = path.join(fixture.home, 'Saved');
  await mkdir(saved);
  await seed(saved);
  const before = await configuration();
  await causeBrowserFailure(failure);
  const session = await startSource('update');
  await failBrowser(session, failure);
  return {before, session};
}

async function cancelManual(session: Readonly<Omit<Session, 'exited'>>): Promise<void> {
  await manual(session);
  session.send('unfinished');
  await session.waitFor('unfinished');
  session.send(escape);
  await mainMenu(session);
}

test.each(['broken link', 'permissions'])(
  'a browser filesystem failure from %s returns to usable manual entry and cancellation',
  async failure => {
    const {session, before} = await failedBrowserSession(failure);
    expect(await configuration()).toBe(before);
    await cancelManual(session);
    expect(await configuration()).toBe(before);
    await openManual(session, 'update');
    session.send(fixture.home + enter);
    await completed(session, fixture.home);
  }
);

async function unreadableSavedParent(): Promise<string> {
  const parent = path.join(fixture.home, 'Blocked');
  const directory = path.join(parent, 'Community');
  await mkdir(directory, {recursive: true});
  await seed(directory);
  const before = await configuration();
  restricted.push(parent);
  await chmod(parent, unreadableMode);
  return before;
}

test('an unreadable saved parent falls back without changing configuration', async () => {
  const before = await unreadableSavedParent();
  const session = await startSource('update');
  expect(session.output()).toContain('Choose a replacement.');
  await browse(session);
  session.send(escape);
  await mainMenu(session);
  expect(await configuration()).toBe(before);
});

test('a malformed configuration remains unchanged after a replacement attempt', async () => {
  await mkdir(path.dirname(fixture.configurationFile));
  await writeFile(fixture.configurationFile, '{broken');
  const session = await startSource('update');
  expect(session.output()).toContain('config.json');
  await manual(session);
  session.send(fixture.home + enter);
  await failedCommand(session);
  expect(await configuration()).toBe('{broken');
});

test.each(['set', 'update'] as const)(
  'direct %s without a path under a PTY remains a parse error',
  async operation => {
    const session = createTerminalSession(fixture.executable, fixture.home, [
      'community-path',
      operation,
    ]);
    sessions.push(session);
    expect(await session.exited).toBe(invalidArgumentsExitCode);
    expect(session.output()).not.toContain('Browse directories');
    expect(await configuration()).toBe('');
  }
);
