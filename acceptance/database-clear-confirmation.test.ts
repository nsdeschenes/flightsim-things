import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, setDefaultTimeout, test} from 'bun:test';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {stripVTControlCharacters} from 'node:util';

import createCliFixture from '#acceptance-cli';

import createTerminalSession from './support/terminal.ts';

const timeoutMilliseconds = 30_000;
setDefaultTimeout(timeoutMilliseconds);
const enter = '\r';
const down = '\u001B[B';
const escape = '\u001B';
const controlC = '\u0003';
const controlD = '\u0004';
const successExitCode = 0;
const databaseMenuIndex = 5;
const firstTarget = 0;
const onePrompt = 1;
const clearQuestion = 'Clear these saved records?';
const tables = ['aircraft', 'airlines', 'airports', 'liveries', 'packages'] as const;
const targets = [...tables, 'all'];
const surfaces = ['Tui', 'Wizard'] as const;
type Surface = (typeof surfaces)[number];
type Session = ReturnType<typeof createTerminalSession>;
type RunningSession = Readonly<Omit<Session, 'exited'>>;
type Row = Readonly<Record<string, unknown>>;
type Snapshot = Readonly<Record<string, readonly Row[]>>;
const cases = [
  {
    copy: 'This clears all saved aircraft. Saved liveries are kept, with their aircraft links removed. Saved packages, airports, and airlines are kept.',
    removed: ['aircraft'],
    target: 'aircraft',
    wizardPath: ['--wizard'],
  },
  {
    copy: 'This clears all saved airlines. Saved liveries are kept, with their airline links removed. Saved packages, aircraft, and airports are kept.',
    removed: ['airlines'],
    target: 'airlines',
    wizardPath: ['database', '--wizard'],
  },
  {
    copy: 'This clears all saved airports. Saved packages, aircraft, airlines, and liveries are kept.',
    removed: ['airports'],
    target: 'airports',
    wizardPath: ['database', 'clear', '--wizard'],
  },
  {
    copy: 'This clears all saved liveries. Saved packages, aircraft, airports, and airlines are kept.',
    removed: ['liveries'],
    target: 'liveries',
    wizardPath: ['database', 'clear', '--wizard'],
  },
  {
    copy: 'This clears all saved packages and their aircraft, airports, and liveries. Saved airlines are kept.',
    removed: ['aircraft', 'airports', 'liveries', 'packages'],
    target: 'packages',
    wizardPath: ['database', 'clear', '--wizard'],
  },
  {
    copy: 'This clears all saved packages, aircraft, airports, liveries, and airlines.',
    removed: [...tables],
    target: 'all',
    wizardPath: ['database', 'clear', '--wizard'],
  },
];
const confirmationCases = surfaces.flatMap(surface =>
  cases.map(
    (
      clearCase: Readonly<{
        copy: string;
        removed: readonly string[];
        target: string;
        wizardPath: readonly string[];
      }>
    ) => ({...clearCase, surface})
  )
);
type ClearCase = Readonly<{
  copy: string;
  removed: readonly string[];
  target: string;
  wizardPath: readonly string[];
  surface: Surface;
}>;
let fixture: Awaited<ReturnType<typeof createCliFixture>>;
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

function databaseFile(): string {
  return path.join(fixture.home, '.flightsim-things/addons.sqlite');
}

function addonFile(): string {
  return path.join(fixture.home, 'addon.cfg');
}

function snapshot(): Snapshot {
  using db = new Database(databaseFile(), {readonly: true});
  return Object.fromEntries(
    tables.map(table => [
      table,
      db.query<Row, []>(`SELECT * FROM ${table} ORDER BY id`).all(),
    ])
  );
}

async function seed(): Promise<void> {
  expect(await fixture.run('community-path', 'set', fixture.home)).toMatchObject({
    exitCode: successExitCode,
  });
  expect(await fixture.run('airlines', 'list')).toMatchObject({
    exitCode: successExitCode,
  });
  await writeFile(addonFile(), 'addon-file-sentinel');
  using db = new Database(databaseFile());
  db.run('PRAGMA foreign_keys = ON');
  db.run('INSERT INTO packages (id, source_path) VALUES (1, ?)', [fixture.home]);
  db.run(`INSERT INTO aircraft (id, package_id, source_key) VALUES (1, 1, 'aircraft');
    INSERT INTO airlines (id, icao_code) VALUES (1, 'BAW');
    INSERT INTO airports (id, package_id, source_key) VALUES (1, 1, 'airport');
    INSERT INTO liveries (id, package_id, source_key, aircraft_id, airline_id)
      VALUES (1, 1, 'livery', 1, 1)`);
}

async function waitForMenu(session: RunningSession): Promise<void> {
  await session.waitFor('Choose a command');
  await session.waitFor('Exit');
}

async function selectClearCommand(
  session: RunningSession,
  surface: Surface,
  wizardPath: readonly string[]
): Promise<void> {
  if (surface === 'Tui' || wizardPath.at(firstTarget) === '--wizard') {
    const prompts = {Tui: 'Exit', Wizard: 'scan'};
    await session.waitFor(prompts[surface]);
    session.send(down.repeat(databaseMenuIndex) + enter);
  }

  if (surface === 'Tui' || !wizardPath.includes('clear')) {
    await session.waitFor('Command');
    session.send(enter);
  }
}

async function openClear(
  surface: Surface,
  target: string,
  wizardPath: readonly string[] = ['database', 'clear', '--wizard']
): Promise<Session> {
  let args = wizardPath;
  if (surface === 'Tui') {
    args = ['tui'];
  }

  const session = createTerminalSession(fixture.executable, fixture.home, args);
  sessions.push(session);
  await selectClearCommand(session, surface, wizardPath);
  await session.waitFor('packages');
  session.send(down.repeat(targets.indexOf(target)) + enter);
  await session.waitFor(clearQuestion);
  return session;
}

function submittedQuestions(session: RunningSession): readonly string[] {
  return (
    stripVTControlCharacters(session.output()).match(
      /Clear these saved records\?[^\r\n]*[»…] (?:yes|no)/gu
    ) ?? []
  );
}

async function stop(
  session: Readonly<Omit<Session, 'exited'>> &
    Readonly<{exited: Readonly<PromiseLike<number>>}>,
  surface: Surface
): Promise<void> {
  if (surface === 'Tui') {
    await waitForMenu(session);
    session.send(controlC);
  }

  expect(await session.exited).toBe(successExitCode);
}

async function expectSentinels(settings: string): Promise<void> {
  expect(await readFile(fixture.configurationFile, 'utf8')).toBe(settings);
  expect(await readFile(addonFile(), 'utf8')).toBe('addon-file-sentinel');
}

async function prepareSeededClear(
  clearCase: ClearCase
): Promise<Readonly<{before: Snapshot; session: Session; settings: string}>> {
  await seed();
  return {
    before: snapshot(),
    session: await openClear(clearCase.surface, clearCase.target, clearCase.wizardPath),
    settings: await readFile(fixture.configurationFile, 'utf8'),
  };
}

function expectNoExecution(session: RunningSession): void {
  expect(session.output()).not.toContain('Cleared ');
  expect(session.output()).not.toContain('Command completed.');
}

function expectSingleQuestion(session: RunningSession): void {
  expect(session.output()).not.toContain('Run this command?');
  expect(submittedQuestions(session)).toHaveLength(onePrompt);
}

function expectedSnapshot(before: Snapshot, clearCase: ClearCase): Snapshot {
  const expected: Record<string, readonly Row[]> = {...before};
  for (const table of clearCase.removed) {
    expected[table] = [];
  }

  return expected;
}

function expectLiveryLinks(target: string): void {
  using db = new Database(databaseFile(), {readonly: true});
  const links = db
    .query(`SELECT coalesce(aircraft_id, 0) AS aircraft_id,
    coalesce(airline_id, 0) AS airline_id FROM liveries`)
    .all();
  if (target === 'aircraft') {
    expect(links).toEqual([{aircraft_id: 0, airline_id: 1}]);
  } else if (target === 'airlines') {
    expect(links).toEqual([{aircraft_id: 1, airline_id: 0}]);
  }
}

function withoutLink(rows: readonly Row[], omitted: string): readonly Row[] {
  return rows.map(row =>
    Object.fromEntries(
      Object.entries(row).filter(
        ([column]: readonly [string, unknown]) => column !== omitted
      )
    )
  );
}

function expectAcceptedSnapshot(before: Snapshot, clearCase: ClearCase): void {
  const expected = {...expectedSnapshot(before, clearCase)};
  const after = {...snapshot()};
  if (clearCase.target === 'aircraft' || clearCase.target === 'airlines') {
    expectLiveryLinks(clearCase.target);
    const linkNames = {aircraft: 'aircraft_id', airlines: 'airline_id'};
    const omitted = linkNames[clearCase.target];
    expected.liveries = withoutLink(expected.liveries ?? [], omitted);
    after.liveries = withoutLink(after.liveries ?? [], omitted);
  }

  expect(after).toEqual(expected);
}

test.each(confirmationCases)(
  '$surface explains and declines $target without mutation',
  async (clearCase: ClearCase) => {
    const {session, before, settings} = await prepareSeededClear(clearCase);
    expect(stripVTControlCharacters(session.output())).toContain(
      `${clearCase.copy} Settings and addon files are preserved.`
    );
    expect(session.output()).toContain('(y/N)');
    expect(snapshot()).toEqual(before);
    session.send(enter);
    await stop(session, clearCase.surface);
    expect(snapshot()).toEqual(before);
    await expectSentinels(settings);
    expectNoExecution(session);
    expectSingleQuestion(session);
  }
);

test.each(confirmationCases)(
  '$surface accepts $target once and preserves unrelated data',
  async (clearCase: ClearCase) => {
    const {session, before, settings} = await prepareSeededClear(clearCase);
    session.send('y');
    await session.waitFor('from the saved addon database.');
    await stop(session, clearCase.surface);
    expectAcceptedSnapshot(before, clearCase);
    await expectSentinels(settings);
    expectSingleQuestion(session);
    expect(stripVTControlCharacters(session.output()).match(/Cleared /gu)).toHaveLength(
      onePrompt
    );
  }
);

const cancellationCase = {
  copy: '',
  removed: [],
  target: 'all',
  wizardPath: ['database', 'clear', '--wizard'],
};
const cancellationCases = surfaces.flatMap(surface =>
  ['n', controlC, controlD].map(input => ({input, surface}))
);

test.each(cancellationCases)(
  '$surface rejects or cancels with $input',
  async ({input, surface}: Readonly<{input: string; surface: Surface}>) => {
    const {session, before, settings} = await prepareSeededClear({
      ...cancellationCase,
      surface,
    });
    session.send(input);
    if (input === 'n') {
      await stop(session, surface);
    } else {
      expect(await session.exited).toBe(successExitCode);
    }

    expect(snapshot()).toEqual(before);
    await expectSentinels(settings);
    expectNoExecution(session);
  }
);

test.each([...surfaces])('%s decline does not create a database', async surface => {
  const session = await openClear(surface, 'packages');
  expect(await Bun.file(databaseFile()).exists()).toBe(false);
  session.send(enter);
  await stop(session, surface);
  expect(await Bun.file(databaseFile()).exists()).toBe(false);
  expect(await Bun.file(fixture.configurationFile).exists()).toBe(false);
});

async function expectUsableMenu(
  session: Readonly<Omit<Session, 'exited'>> &
    Readonly<{exited: Readonly<PromiseLike<number>>}>
): Promise<void> {
  session.send(down.repeat(databaseMenuIndex) + enter);
  await session.waitFor('back');
  session.send(controlC);
  expect(await session.exited).toBe(successExitCode);
}

test('TUI Escape returns to a usable menu without mutation', async () => {
  await seed();
  const before = snapshot();
  const session = await openClear('Tui', 'all');
  session.send(escape);
  await waitForMenu(session);
  await expectUsableMenu(session);
  expect(snapshot()).toEqual(before);
  expectNoExecution(session);
});

test('wizard Escape beeps and keeps confirmation pending', async () => {
  await seed();
  const before = snapshot();
  const session = await openClear('Wizard', 'all');
  session.send(escape);
  await session.waitFor('\u0007');
  expect(snapshot()).toEqual(before);
  session.send('n');
  expect(await session.exited).toBe(successExitCode);
  expect(snapshot()).toEqual(before);
  expect(session.output()).not.toContain('Cleared ');
});

test.each(
  [['tui'], ['database', 'clear', '--wizard']].map((args: readonly string[]) => ({args}))
)(
  'nonterminal $args cannot create a database',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    const result = await fixture.run(...args);
    expect(result.exitCode).not.toBe(successExitCode);
    expect(result.stderr).toContain('requires a terminal');
    expect(await Bun.file(databaseFile()).exists()).toBe(false);
  }
);
