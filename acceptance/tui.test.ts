import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, setDefaultTimeout, test} from 'bun:test';
import {mkdir, readFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {stripVTControlCharacters} from 'node:util';

import createCliFixture from '#acceptance-cli';

import createTerminalSession from './support/terminal.ts';

const testTimeoutMilliseconds = 60_000;
setDefaultTimeout(testTimeoutMilliseconds);

const firstChoice = 0;
const headingLines = 1;
const lastFrame = -1;
const filterTimeoutMilliseconds = 10_000;
const filterPollMilliseconds = 10;
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
  'liveries',
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
  {commands: 1, name: 'liveries'},
  {commands: 2, name: 'openaip-key'},
  {commands: 3, name: 'sentry'},
];
const down = '\u001B[B';
const enter = '\r';
const controlD = '\u0004';
const controlC = '\u0003';
const escape = '\u001B';
const controlU = '\u0015';
const backspace = '\u007F';
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
  await session.waitFor('No saved airlines found. Run scan to populate the list.');
  await session.waitFor('Command completed.');
  await waitForMainMenu(session);
}

async function openSavedList(
  session: Readonly<Omit<Session, 'exited'>>,
  name: string
): Promise<void> {
  session.send(choose(name));
  await session.waitFor('back');
  session.send(enter);
}

async function seedInventory(): Promise<void> {
  expect(await fixture.run('airlines', 'list')).toMatchObject({exitCode: 0});
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run(`INSERT INTO packages (id, source_path) VALUES
    (1, '/inventory/first'), (2, '/inventory/second')`);
  db.run(`INSERT INTO aircraft
    (id, icao_type_designator, manufacturer, model, name, package_id, source_key) VALUES
    (1, 'A320', 'Airbus', '320neo', 'Skybus', 1, 'first.cfg'),
    (2, 'A320', 'Airbus', '320neo', 'Skybus', 2, 'second.cfg'),
    (3, 'B738', 'Boeing', '737', 'Other aircraft', 1, 'other.cfg'),
    (4, NULL, NULL, NULL, NULL, 1, 'unknown.cfg')`);
  db.run(`INSERT INTO airlines (id, icao_code, iata_code, name) VALUES
    (1, 'BAW', 'BA', 'British Airways'), (2, 'DAL', 'DL', 'Delta Air Lines'),
    (3, NULL, NULL, 'Unnamed carrier')`);
  db.run(`INSERT INTO airports
    (id, icao_code, iata_code, name, latitude, longitude, elevation_meters, package_id, source_key) VALUES
    (1, 'EGLL', 'LHR', 'Heathrow', 51.47, -0.45, 25, 1, 'first.xml'),
    (2, 'EGLL', 'LHR', 'Heathrow', 51.48, -0.46, 26, 2, 'second.xml'),
    (3, 'KJFK', 'JFK', 'Kennedy', NULL, NULL, NULL, 1, 'other.xml'),
    (4, NULL, NULL, NULL, NULL, NULL, NULL, 1, 'unknown.xml')`);
  db.run(`INSERT INTO liveries
    (id, name, registration, aircraft_id, airline_id, package_id, source_key, target_aircraft_key) VALUES
    (1, 'Heritage', 'G-EUAA', 1, 1, 1, 'heritage.cfg', 'base'),
    (2, 'Freighter', 'N999', 3, 2, 2, 'freighter.cfg', 'other'),
    (3, NULL, NULL, NULL, NULL, 1, 'unknown-livery.cfg', 'missing')`);
}

const inventoryPickers = [
  {
    empty: 'No installed aircraft found. Run scan to populate the list.',
    hidden: 'Other aircraft',
    name: 'aircraft',
    queries: ['Skybus', 'aIrBuS', '320nEo', 'a320'],
    row: [
      '2',
      'A320',
      'Airbus',
      '320neo',
      'Skybus',
      '2',
      'second.cfg',
      '/inventory/second',
    ],
    selection: down,
    unknownId: '[ID 4]',
    unknownRow: ['4', '', '', '', '', '1', 'unknown.cfg', '/inventory/first'],
  },
  {
    empty: 'No saved airlines found. Run scan to populate the list.',
    hidden: 'Delta Air Lines',
    name: 'airlines',
    queries: ['British Airways', 'bAw', 'bA'],
    row: ['1', 'BAW', 'BA', 'British Airways'],
    selection: '',
    unknownId: '[ID 3]',
    unknownRow: ['3', '', '', 'Unnamed carrier'],
  },
  {
    empty: 'No installed airports found. Run scan to populate the list.',
    hidden: 'Kennedy',
    name: 'airports',
    queries: ['Heathrow', 'eGlL', 'lHr'],
    row: [
      '2',
      'EGLL',
      'LHR',
      'Heathrow',
      '51.48',
      '-0.46',
      '26',
      '2',
      'second.xml',
      '/inventory/second',
    ],
    selection: down,
    unknownId: '[ID 4]',
    unknownRow: ['4', '', '', '', '', '', '', '1', 'unknown.xml', '/inventory/first'],
  },
  {
    empty: 'No installed liveries found. Run scan to populate the list.',
    hidden: 'Freighter',
    name: 'liveries',
    queries: ['Heritage', 'g-EuAa', 'Skybus', 'a320', 'British Airways', 'bAw', 'bA'],
    row: [
      '1',
      'Heritage',
      'G-EUAA',
      '1',
      'A320',
      'Skybus',
      '1',
      'BAW',
      'BA',
      'British Airways',
      'base',
      '1',
      'heritage.cfg',
      '/inventory/first',
    ],
    selection: '',
    unknownId: '[ID 3]',
    unknownRow: [
      '3',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      'missing',
      '1',
      'unknown-livery.cfg',
      '/inventory/first',
    ],
  },
];
type Picker = Readonly<{
  name: string;
  queries: readonly string[];
  hidden: string;
  row: readonly string[];
  selection: string;
  unknownId: string;
  unknownRow: readonly string[];
}>;

async function narrowPicker(
  session: Readonly<Omit<Session, 'exited'>>,
  query: string,
  expected: Readonly<{visible: string; hidden: string}>
): Promise<void> {
  const start = session.output().length;
  session.send(controlU + query);
  const deadline = Date.now() + filterTimeoutMilliseconds;
  while (Date.now() < deadline) {
    const frame =
      stripVTControlCharacters(session.output().slice(start))
        .split(`[filter: ${query}]`)
        .slice(headingLines)
        .at(lastFrame) ?? '';
    if (frame.includes(expected.visible)) {
      expect(frame).not.toContain(expected.hidden);
      return;
    }

    await delay(filterPollMilliseconds);
  }

  throw new Error(`Missing filtered frame for "${query}". Output ${session.output()}`);
}

function tableRows(output: string): string[][] {
  return stripVTControlCharacters(output)
    .split(lineBreak)
    .filter(line => line.startsWith('|'))
    .slice(headingLines)
    .map(line =>
      line
        .split('|')
        .slice(headingLines, -headingLines)
        .map(cell => cell.trim())
    );
}

async function submitPicker(
  session: Readonly<Omit<Session, 'exited'>>,
  selection: string,
  row: readonly string[]
): Promise<void> {
  const start = session.output().length;
  session.send(selection + enter);
  await session.waitFor('Command completed.');
  await waitForMainMenu(session);
  expect(tableRows(session.output().slice(start))).toEqual([[...row]]);
  expect(session.output()).not.toContain('Set Code (--code)?');
  expect(session.output()).not.toContain('Set Aircraft (--aircraft)?');
  expect(session.output()).not.toContain('Set Airline (--airline)?');
}

async function startPicker(name: string): Promise<Session> {
  const session = await startSession();
  await openSavedList(session, name);
  await session.waitFor('type to filter');
  return session;
}

async function selectUnknownRecord(
  session: Readonly<Omit<Session, 'exited'>>,
  picker: Picker
): Promise<void> {
  await openSavedList(session, picker.name);
  await session.waitFor('type to filter');
  await narrowPicker(session, picker.unknownId, {
    hidden: '[ID 1]',
    visible: picker.unknownId,
  });
  await submitPicker(session, '', picker.unknownRow);
}

async function recoverFromNoMatches(
  session: Readonly<Omit<Session, 'exited'>>
): Promise<void> {
  session.send('British AirwaysX');
  await session.waitFor('No matches');
  session.send(enter + backspace);
  await session.waitFor('[ID 1]');
  expect(session.output()).not.toContain('Command completed.');
}

function expectDirectoryHyperlink(output: string, directory: string): void {
  const hyperlinkTargets: readonly string[] = output
    .split(`${escape}]8;`)
    .slice(headingLines)
    .filter(sequence => sequence.includes(';'))
    .map(sequence => {
      const [target = ''] = sequence
        .slice(sequence.indexOf(';') + ';'.length)
        .split('\u0007');
      return target.split(`${escape}\\`).at(firstChoice) ?? '';
    });
  const expectedUrl = pathToFileURL(
    path.resolve(fixture.home, directory) + path.sep
  ).href;
  expect(hyperlinkTargets).toContain(expectedUrl);
}

test.each(inventoryPickers)(
  '$name narrows saved records before Enter and displays the exact selected row',
  async (picker: Picker) => {
    await seedInventory();
    const session = await startPicker(picker.name);
    for (const query of picker.queries) {
      await narrowPicker(session, query, {hidden: picker.hidden, visible: '[ID 1]'});
    }

    await submitPicker(session, picker.selection, picker.row);
    if (picker.name !== 'airlines') {
      expectDirectoryHyperlink(session.output(), picker.row.at(lastFrame) ?? '');
    }

    await selectUnknownRecord(session, picker);
    session.send(controlD);
    expect(await session.exited).toBe(successExitCode);
  }
);

test('autocomplete recovers from zero matches, supports Backspace, clearing, and arrow navigation', async () => {
  await seedInventory();
  const session = await startPicker('airlines');
  await recoverFromNoMatches(session);
  const start = session.output().length;
  session.send(controlU);
  await session.waitFor('Delta Air Lines');
  expect(stripVTControlCharacters(session.output().slice(start))).toContain(
    'Unnamed carrier'
  );
  session.send(down);
  await session.waitFor('Delta Air Lines');
  await submitPicker(session, '', ['2', 'DAL', 'DL', 'Delta Air Lines']);
});

test.each(inventoryPickers)(
  '$name bypasses the picker for an empty inventory',
  async (picker: Readonly<{name: string; empty: string}>) => {
    const session = await startSession();
    await openSavedList(session, picker.name);
    await session.waitFor(picker.empty);
    await session.waitFor('Command completed.');
    await waitForMainMenu(session);
    expect(session.output()).not.toContain('type to filter');
  }
);

test.each(inventoryPickers)(
  '$name returns to the menu on Escape and exits on Ctrl+C and Ctrl+D',
  async (picker: Readonly<{name: string}>) => {
    await seedInventory();
    for (const key of [escape, controlC, controlD]) {
      const session = await startPicker(picker.name);
      session.send(key);
      if (key === escape) {
        await waitForMainMenu(session);
        session.send(controlD);
      }

      expect(await session.exited).toBe(successExitCode);
      expect(session.output()).not.toContain('Command completed.');
    }
  }
);

test('autocomplete sanitizes titles and descriptions before rendering', async () => {
  await seedInventory();
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run('UPDATE aircraft SET name = ?, source_key = ? WHERE id = 1', [
    '\u001B[31m東京\u001B[0m\tNorth\nGate',
    '\u001B]8;;https://example.invalid\u0007source.cfg\u001B]8;;\u0007\r\u0000',
  ]);
  const session = await startSession();
  await openSavedList(session, 'aircraft');
  await session.waitFor('type to filter');
  await narrowPicker(session, '東京 North Gate', {
    hidden: 'Other aircraft',
    visible: '[ID 1]',
  });
  expect(session.output()).not.toContain('\u001B[31m');
  expect(session.output()).not.toContain('https://example.invalid');
  expect(session.output()).toContain('source.cfg  ');
});

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

async function openCommunityManual(
  session: Readonly<Omit<Session, 'exited'>>
): Promise<void> {
  session.send(choose('community-path'));
  await session.waitFor('back');
  session.send(down + enter);
  await session.waitFor('Enter a path');
  session.send(down + enter);
  await session.waitFor('Path');
}

test('saves a literal navigation label as a directory argument', async () => {
  await mkdir(path.join(fixture.home, 'back'));
  const session = await startSession();
  await openCommunityManual(session);
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
  await session.waitFor('Clear these saved records?');
  session.send('y');
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

test.each(['--help', '--h', '--v', '-h', '--completions', '--completions=bash'])(
  'refuses credential control token %s',
  async token => {
    const session = await startSession();
    session.send(choose('openaip-key'));
    await session.waitFor('Command');
    session.send(down + enter);
    await session.waitFor('Key');
    session.send(`${token}${enter}`);
    await session.waitFor('A value looks like a CLI control flag.');
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

test.each([controlC, controlD])('interrupts a running command with %j', async key => {
  const session = await startSession(
    ['tui'],
    [
      process.execPath,
      path.resolve(import.meta.dir, '../src/commands/tui.test-client.ts'),
    ]
  );
  session.send(enter);
  await session.waitFor('Command is running.');
  session.send(key);
  expect(await session.exited).toBe(successExitCode);
  expect(session.output()).not.toContain('Command completed.');
});

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
  expect(payload).not.toContain(fixture.home.replaceAll('\\', String.raw`\\`));
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
