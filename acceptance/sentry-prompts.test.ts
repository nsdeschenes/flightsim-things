import {afterEach, beforeEach, expect, setDefaultTimeout, test} from 'bun:test';
import {readFile, writeFile} from 'node:fs/promises';

import createCliFixture from '#acceptance-cli';

import createTerminalSession from './support/terminal.ts';

const timeoutMilliseconds = 30_000;
setDefaultTimeout(timeoutMilliseconds);
const enter = '\r';
const down = '\u001B[B';
const controlU = '\u0015';
const controlC = '\u0003';
const controlD = '\u0004';
const escape = '\u001B';
const successExitCode = 0;
const failureExitCode = 1;
const sentryIndex = 10;
const updateIndex = 1;
const dsn = 'http://key@localhost/123';
const replacementDsn = 'http://other@localhost/456';
const rateError = 'Enter a finite sample rate from 0 to 1.';
const labels = {
  dsn: 'Sentry DSN (--dsn)',
  errors: 'Error sample rate from 0 to 1 (--errors)',
  logs: 'Log sample rate from 0 to 1 (--logs)',
  metrics: 'Metric sample rate from 0 to 1 (--metrics)',
  traces: 'Trace sample rate from 0 to 1 (--traces)',
};
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type Session = DeepReadonly<ReturnType<typeof createTerminalSession>>;
type Surface = 'direct' | 'menu';
let fixture: Awaited<ReturnType<typeof createCliFixture>>;
let sessions: Session[];

beforeEach(async () => {
  fixture = await createCliFixture();
  sessions = [];
  expect(
    await fixture.run(
      'sentry',
      'set',
      '--dsn',
      dsn,
      '--errors',
      '0',
      '--logs',
      '0',
      '--metrics',
      '0',
      '--traces',
      '0'
    )
  ).toMatchObject({exitCode: successExitCode});
});

afterEach(async () => {
  for (const session of sessions) {
    await session.dispose();
  }

  await fixture.dispose();
});

function start(args: readonly string[]): Session {
  const session = createTerminalSession(fixture.executable, fixture.home, args);
  sessions.push(session);
  return session;
}

async function answer(
  session: Readonly<Session>,
  message: string,
  value = ''
): Promise<void> {
  await session.waitFor(message);
  session.send(value + enter);
}

async function openMenu(): Promise<Session> {
  const session = start(['tui']);
  await session.waitFor('Exit');
  session.send(down.repeat(sentryIndex) + enter);
  await session.waitFor('back');
  return session;
}

async function open(surface: Surface, mode: 'set' | 'update'): Promise<Session> {
  if (surface === 'direct') {
    return start(['sentry', mode, '--wizard']);
  }

  const session = await openMenu();

  let choice = enter;
  if (mode === 'update') {
    choice = down.repeat(updateIndex) + enter;
  }

  session.send(choice);
  return session;
}

async function finish(session: Readonly<Session>, surface: Surface): Promise<void> {
  if (surface === 'direct') {
    await answer(session, 'Run this command?', 'y');
    expect(await session.exited).toBe(successExitCode);
    return;
  }

  await session.waitFor('Command completed.');
  await session.waitFor('Exit');
  session.send(controlD);
  expect(await session.exited).toBe(successExitCode);
}

async function saved(): Promise<unknown> {
  const result = await fixture.run('sentry', 'get');
  expect(result.exitCode).toBe(successExitCode);
  return JSON.parse(result.stdout);
}

async function correct(
  session: Readonly<Session>,
  message: string,
  values: Readonly<{bad: string; good: string}>
): Promise<void> {
  await answer(session, message, values.bad);
  await session.waitFor(rateError);
  session.send(controlU + values.good + enter);
}

async function correctDsn(session: Session): Promise<void> {
  await answer(session, labels.dsn, 'bad-dsn');
  await session.waitFor('Enter an HTTP(S) Sentry DSN');
  session.send(controlU + dsn + enter);
}

async function collectSet(session: Readonly<Session>): Promise<void> {
  await correctDsn(session);
  await correct(session, labels.errors, {bad: '', good: '0.123456'});
  await session.waitFor(labels.logs);
  for (const invalid of ['1.001', '-0.001', '0.5junk', 'NaN', 'Infinity', '']) {
    session.send(controlU + invalid + enter);
    await session.waitFor(rateError);
  }

  session.send(`${controlU}0${enter}`);
  await correct(session, labels.metrics, {bad: '', good: '1e-3'});
  await correct(session, labels.traces, {bad: '', good: '0x1'});
}

test.each(['direct', 'menu'] as const)(
  'corrects raw input in %s without losing earlier fields or numeric precision',
  async surface => {
    const session = await open(surface, 'set');
    await collectSet(session);
    await finish(session, surface);
    expect(await saved()).toEqual({
      dsn,
      sampleRates: {errors: 0.123456, logs: 0, metrics: 0.001, traces: 1},
    });
  }
);

async function remainingZeroRates(session: Session): Promise<void> {
  for (const label of [labels.logs, labels.metrics, labels.traces]) {
    await answer(session, label, '0');
  }
}

async function selectAncestor(
  session: Session,
  args: readonly string[],
  mode: 'set' | 'update'
): Promise<void> {
  if (args.length === updateIndex) {
    await session.waitFor('scan');
    session.send(down.repeat(sentryIndex) + enter);
  }

  await session.waitFor('  update ');
  let choice = enter;
  if (mode === 'update') {
    choice = down + enter;
  }

  session.send(choice);
}

test.each([{args: ['--wizard']}, {args: ['sentry', '--wizard']}])(
  'routes ancestor %j through the same collector',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    const session = start(args);
    await selectAncestor(session, args, 'set');
    await answer(session, labels.dsn, dsn);
    await correct(session, labels.errors, {bad: '1.001', good: '1'});
    await remainingZeroRates(session);
    await finish(session, 'direct');
    expect(await saved()).toEqual({
      dsn,
      sampleRates: {errors: 1, logs: 0, metrics: 0, traces: 0},
    });
  }
);

async function chooseLogs(session: Readonly<Session>): Promise<void> {
  await answer(session, `Set ${labels.dsn}?`);
  await answer(session, `Set ${labels.errors}?`);
  await answer(session, `Set ${labels.logs}?`, 'y');
}

async function skipRemaining(session: Readonly<Session>): Promise<void> {
  await answer(session, `Set ${labels.metrics}?`);
  await answer(session, `Set ${labels.traces}?`);
}

test.each([{args: ['--wizard']}, {args: ['sentry', '--wizard']}])(
  'routes ancestor update %j through the same collector',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    const session = start(args);
    await selectAncestor(session, args, 'update');
    await chooseLogs(session);
    await correct(session, labels.logs, {bad: '1.001', good: '0.123456'});
    await skipRemaining(session);
    await finish(session, 'direct');
    expect(await saved()).toEqual({
      dsn,
      sampleRates: {errors: 0, logs: 0.123456, metrics: 0, traces: 0},
    });
  }
);

async function changeConcurrentConfiguration(): Promise<void> {
  expect(
    await fixture.run(
      'sentry',
      'update',
      '--dsn',
      replacementDsn,
      '--errors',
      '0.75',
      '--metrics',
      '0.5',
      '--traces',
      '0.25'
    )
  ).toMatchObject({exitCode: successExitCode});
}

async function changeWhileCollecting(session: Session): Promise<void> {
  await session.waitFor(labels.logs);
  await changeConcurrentConfiguration();
  session.send(`1.001${enter}`);
  await session.waitFor(rateError);
  session.send(`${controlU}0${enter}`);
}

async function seedUnknownProperties(): Promise<void> {
  await writeFile(
    fixture.configurationFile,
    JSON.stringify({
      sentry: {
        dsn,
        extra: 'keep',
        sampleRates: {errors: 0, future: 0.6, logs: 1, metrics: 0, traces: 0},
      },
      unrelated: {enabled: true},
    })
  );
}

test.each(['direct', 'menu'] as const)(
  'updates only selected values in %s using the latest saved configuration',
  async surface => {
    await seedUnknownProperties();
    const session = await open(surface, 'update');
    await chooseLogs(session);
    await changeWhileCollecting(session);
    await skipRemaining(session);
    await finish(session, surface);
    expect(await saved()).toEqual({
      dsn: replacementDsn,
      sampleRates: {errors: 0.75, logs: 0, metrics: 0.5, traces: 0.25},
    });
    expect(JSON.parse(await readFile(fixture.configurationFile, 'utf8'))).toEqual({
      sentry: {
        dsn: replacementDsn,
        extra: 'keep',
        sampleRates: {errors: 0.75, future: 0.6, logs: 0, metrics: 0.5, traces: 0.25},
      },
      unrelated: {enabled: true},
    });
  }
);

test.each(['direct', 'menu'] as const)(
  'repeats an empty update selection in %s before accepting a change',
  async surface => {
    const session = await open(surface, 'update');
    for (const label of Object.values(labels)) {
      await answer(session, `Set ${label}?`);
    }

    await session.waitFor('Choose at least one option to update.');
    await chooseLogs(session);
    await answer(session, labels.logs, '0.123456');
    await skipRemaining(session);
    await finish(session, surface);
    expect(await saved()).toEqual({
      dsn,
      sampleRates: {errors: 0, logs: 0.123456, metrics: 0, traces: 0},
    });
  }
);

test.each([
  {key: controlC, surface: 'direct'},
  {key: controlD, surface: 'direct'},
  {key: controlC, surface: 'menu'},
  {key: controlD, surface: 'menu'},
  {key: escape, surface: 'menu'},
] as const)(
  'cancels $surface input with $key before any write',
  async ({surface, key}) => {
    const before = await readFile(fixture.configurationFile, 'utf8');
    const session = await open(surface, 'set');
    await answer(session, labels.dsn, dsn);
    await session.waitFor(labels.errors);
    session.send(key);
    if (key === escape) {
      await session.waitFor('Exit');
      session.send(controlD);
    }

    expect(await session.exited).toBe(successExitCode);
    expect(await readFile(fixture.configurationFile, 'utf8')).toBe(before);
  }
);

test('declining direct confirmation preserves saved bytes', async () => {
  const before = await readFile(fixture.configurationFile, 'utf8');
  const session = await open('direct', 'set');
  await answer(session, labels.dsn, replacementDsn);
  for (const label of [labels.errors, labels.logs, labels.metrics, labels.traces]) {
    await answer(session, label, '1');
  }

  await answer(session, 'Run this command?');
  expect(await session.exited).toBe(successExitCode);
  expect(await readFile(fixture.configurationFile, 'utf8')).toBe(before);
});

test('ordinary CLI preserves coercion, precise values, diagnostics, and rejected bytes', async () => {
  for (const {input, expected} of [
    {expected: 0, input: '0'},
    {expected: 1, input: '1'},
    {expected: 0.123456, input: '0.123456'},
    {expected: 0.001, input: '1e-3'},
    {expected: 1, input: '0x1'},
    {expected: 0.5, input: ' 0.5 '},
  ] as const) {
    expect(await fixture.run('sentry', 'update', '--logs', input)).toMatchObject({
      exitCode: successExitCode,
    });
    expect(await saved()).toEqual({
      dsn,
      sampleRates: {errors: 0, logs: expected, metrics: 0, traces: 0},
    });
  }

  const before = await readFile(fixture.configurationFile, 'utf8');
  for (const input of [
    '',
    ' ',
    '0.5junk',
    'NaN',
    'Infinity',
    '-Infinity',
    '1.001',
    '-0.001',
  ]) {
    expect(await fixture.run('sentry', 'update', `--logs=${input}`)).toEqual({
      exitCode: failureExitCode,
      stderr:
        'Command failed, Provide an HTTP(S) Sentry DSN with a public key and numeric project ID, and finite sample rates from 0 to 1.\n',
      stdout: '',
    });
    expect(await readFile(fixture.configurationFile, 'utf8')).toBe(before);
  }
});
