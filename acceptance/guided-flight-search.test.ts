import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, setDefaultTimeout, test} from 'bun:test';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {stripVTControlCharacters} from 'node:util';

import {z} from 'zod';

import createCliFixture from '#acceptance-cli';

import createTerminalSession from './support/terminal.ts';

type Session = ReturnType<typeof createTerminalSession>;
type TerminalSession = Readonly<Omit<Session, 'exited'>>;
const timeoutMilliseconds = 60_000;
const rootSearchIndex = 6;
const first = 0;
const one = 1;
const two = 2;
const three = 3;
const four = 4;
const down = '\u001B[B';
const up = '\u001B[A';
const enter = '\r';
const controlD = '\u0004';
const controlC = '\u0003';
const escape = '\u001B';
const controlU = '\u0015';
const requestFile = 'ai-requests.json';
const client = path.resolve(import.meta.dir, '../src/find-flight-test-client.ts');
const dataStart = 'Data JSON: ';
const contentSchema = z.object({text: z.string()}).readonly();
const messageSchema = z.object({content: z.array(contentSchema).readonly()}).readonly();
const requestBodySchema = z.object({input: z.array(messageSchema).readonly()}).readonly();
const requestsSchema = z.array(z.object({body: requestBodySchema}).readonly()).readonly();
const extractionSchema = z.object({fixed: z.unknown()});
let fixture: Awaited<ReturnType<typeof createCliFixture>>;
let sessions: Session[];
setDefaultTimeout(timeoutMilliseconds);

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

function expectNoExecution(session: TerminalSession): void {
  expect(session.output()).not.toContain('Command completed.');
  expect(session.output()).not.toContain('Command exited with code 1.');
}

async function mainMenu(session: TerminalSession): Promise<void> {
  await session.waitFor('Choose a command');
  await session.waitFor('Exit');
}

async function openSearch(research = false): Promise<Session> {
  let {executable} = fixture;
  if (research) {
    executable = [process.execPath, client];
  }

  const session = createTerminalSession(executable, fixture.home);
  sessions.push(session);
  await mainMenu(session);
  session.send(down.repeat(rootSearchIndex) + enter);
  await session.waitFor('Search mode');
  await session.waitFor('Back');
  return session;
}

async function seedInventory(): Promise<void> {
  expect(await fixture.run('airlines', 'list')).toMatchObject({exitCode: first});
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run(
    "INSERT INTO packages (source_path) VALUES ('/inventory/one'), ('/inventory/two')"
  );
  db.run(
    "INSERT INTO airports (id, package_id, source_key, icao_code, iata_code, name) VALUES (1, 1, 'paris', ' lfpg ', ' cdg ', 'Paris'), (2, 2, 'paris', 'LFPG', 'CDG', 'Paris'), (3, 1, 'london', 'EGLL', 'LHR', 'London'), (4, 1, 'unknown', NULL, NULL, 'Unknown airport')"
  );
  db.run(
    "INSERT INTO aircraft (id, package_id, source_key, name, manufacturer, model, icao_type_designator) VALUES (1, 1, 'a320', 'Shared jet', 'Airbus', 'A320', ' a320 '), (2, 2, 'a320', 'Shared jet', 'Airbus', 'A320', 'A320'), (3, 1, 'b738', 'Boeing', 'Boeing', '737', 'B738'), (4, 1, 'unidentified', 'No aircraft code', NULL, NULL, NULL), (5, 1, 'partial', 'Partial partner', NULL, NULL, 'C172')"
  );
  db.run(
    "INSERT INTO airlines (id, icao_code, iata_code, name) VALUES (1, ' baw ', 'BA', 'British Airways'), (2, 'AFR', 'AF', 'Air France'), (3, 'DAL', 'DL', 'Delta'), (4, NULL, 'ZZ', 'No airline code')"
  );
  db.run(
    "INSERT INTO liveries (id, package_id, source_key, name, aircraft_id, airline_id) VALUES (1, 1, 'ba', 'BA', 1, 1), (2, 1, 'af', 'AF', 3, 2), (3, 2, 'af320', 'AF duplicate', 2, 2), (4, 1, 'unresolved', 'Unresolved', NULL, 1), (5, 1, 'partial-aircraft', 'No type', 4, 3), (6, 1, 'partial-airline', 'No carrier', 5, 4)"
  );
}

async function configureResearch(): Promise<void> {
  expect(
    await fixture.run(
      'ai',
      'set',
      '--provider',
      'openai',
      '--model',
      'gpt-5',
      '--api-key',
      'fake-guided-key'
    )
  ).toMatchObject({exitCode: first});
}

async function mode(
  session: TerminalSession,
  index: number,
  next: string
): Promise<void> {
  session.send(down.repeat(index) + enter);
  await session.waitFor(next);
  await session.waitFor('Back');
}

type FieldAnswer = Readonly<{code: string; next: string; savedAvailable?: boolean}>;
async function saved(
  session: TerminalSession,
  field: string,
  answer: FieldAnswer
): Promise<void> {
  session.send(enter);
  await session.waitFor(`Choose ${field}`);
  await session.waitFor('type to filter');
  session.send(answer.code);
  await session.waitFor(answer.code);
  session.send(enter);
  await session.waitFor(answer.next);
}

async function manual(
  session: TerminalSession,
  field: string,
  answer: FieldAnswer
): Promise<void> {
  let move = down;
  if (answer.savedAvailable === false) {
    move = '';
  }

  session.send(move + enter);
  await session.waitFor(`${field} code (empty goes Back)`);
  session.send(answer.code + enter);
  await session.waitFor(answer.next);
}

async function filters(
  session: TerminalSession,
  index: number,
  next: string
): Promise<void> {
  await session.waitFor('Back');
  session.send(down.repeat(index) + enter);
  await session.waitFor(next);
}

async function cancelReview(session: TerminalSession): Promise<void> {
  await session.waitFor('Cancel to menu');
  session.send(down.repeat(two) + enter);
  await mainMenu(session);
  expect(session.output()).not.toContain('Command completed.');
  expect(session.output()).not.toContain('Command exited with code 1.');
}

async function canonicalQuery(): Promise<unknown> {
  const captured = await readFile(path.join(fixture.home, requestFile), 'utf8');
  const requests = requestsSchema.parse(JSON.parse(captured));
  const texts = requests.flatMap(request =>
    request.body.input.flatMap(message => message.content.map(content => content.text))
  );
  const text = texts.find(value => value.includes(dataStart)) ?? '';
  const data: unknown = JSON.parse(
    text.slice(text.indexOf(dataStart) + dataStart.length)
  );
  return extractionSchema.parse(data).fixed;
}

async function search(session: TerminalSession, expected: unknown): Promise<void> {
  await session.waitFor('Cancel to menu');
  expect(await Bun.file(path.join(fixture.home, requestFile)).exists()).toBe(false);
  session.send(enter);
  await session.waitFor('Command completed.');
  await mainMenu(session);
  expect(stripVTControlCharacters(session.output())).toContain('BA123');
  expect(await canonicalQuery()).toEqual(expected);
  session.send(controlD);
}

const searchCases = [
  {
    expected: {airport: 'EGLL', endpoint: 'departure', mode: 'endpoint'},
    filter: first,
    mode: first,
  },
  {
    expected: {
      aircraft: 'A320',
      airport: 'LFPG',
      endpoint: 'destination',
      mode: 'endpoint',
    },
    filter: one,
    mode: one,
  },
  {
    expected: {
      airline: 'BAW',
      airport: 'EGLL',
      destination: 'LFPG',
      endpoint: 'departure',
      mode: 'endpoint',
    },
    filter: two,
    mode: two,
  },
  {
    expected: {
      aircraft: 'A320',
      airline: 'BAW',
      airport: 'EGLL',
      endpoint: 'departure',
      mode: 'endpoint',
    },
    filter: three,
    mode: first,
  },
  {
    expected: {aircraft: 'A320', airline: 'BAW', mode: 'inventory'},
    filter: first,
    mode: three,
  },
];

async function endpointFields(
  session: TerminalSession,
  modeIndex: number
): Promise<void> {
  if (modeIndex === one) {
    await saved(session, 'destination airport', {
      code: '[ID 1]',
      next: 'Optional filters',
    });
    return;
  }

  let next = 'Optional filters';
  if (modeIndex === two) {
    next = 'Destination airport source';
  }

  await saved(session, 'departure airport', {code: 'EGLL', next});
  if (modeIndex === two) {
    await saved(session, 'destination airport', {
      code: '[ID 1]',
      next: 'Optional filters',
    });
  }
}

async function filteredFields(session: TerminalSession, filter: number): Promise<void> {
  if (filter === one || filter === three) {
    let next = 'Review search';
    if (filter === three) {
      next = 'Airline source';
    }

    await saved(session, 'aircraft', {code: '[ID 1]', next});
  }

  if (filter === two || filter === three) {
    await saved(session, 'airline', {code: 'BAW', next: 'Review search'});
  }
}

async function buildEndpointSearch(
  session: TerminalSession,
  configuration: Readonly<{mode: number; filter: number}>
): Promise<void> {
  let field = 'Departure airport source';
  if (configuration.mode === one) {
    field = 'Destination airport source';
  }

  await mode(session, configuration.mode, field);
  await endpointFields(session, configuration.mode);
  await filters(
    session,
    configuration.filter,
    ['Review search', 'Aircraft source', 'Airline source', 'Aircraft source'].at(
      configuration.filter
    ) ?? 'Review search'
  );
  await filteredFields(session, configuration.filter);
}

async function buildSearch(
  session: TerminalSession,
  configuration: Readonly<{mode: number; filter: number}>
): Promise<void> {
  if (configuration.mode === three) {
    await mode(session, three, 'Aircraft source');
    await saved(session, 'aircraft', {code: '[ID 1]', next: 'Airline source'});
    await saved(session, 'airline', {code: 'BAW', next: 'Review search'});
    return;
  }

  await buildEndpointSearch(session, configuration);
}

test.each(searchCases)(
  'runs guided mode $mode with filter plan $filter through the ordinary runner',
  async (configuration: Readonly<{mode: number; filter: number; expected: unknown}>) => {
    await seedInventory();
    await configureResearch();
    const session = await openSearch(true);
    await buildSearch(session, configuration);
    await search(session, configuration.expected);
  }
);

async function leaveUnmatchedSavedPrompt(session: TerminalSession): Promise<void> {
  session.send(enter);
  await session.waitFor('type to filter');
  session.send('not-a-saved-airport');
  await session.waitFor('No matches. Ctrl+U');
  session.send(enter + controlU);
  await session.waitFor('London');
  session.send(down.repeat(three) + enter);
  await session.waitFor('Departure airport source');
}

test('autocomplete has manual fallback after no matches and preserves normalized manual endpoints', async () => {
  await seedInventory();
  await configureResearch();
  const session = await openSearch(true);
  await mode(session, first, 'Departure airport source');
  await leaveUnmatchedSavedPrompt(session);
  await manual(session, 'Departure airport', {code: ' cyul ', next: 'Optional filters'});
  await filters(session, first, 'Review search');
  await search(session, {airport: 'CYUL', endpoint: 'departure', mode: 'endpoint'});
});

async function inventoryReview(session: TerminalSession): Promise<void> {
  await mode(session, three, 'Aircraft source');
  await saved(session, 'aircraft', {code: '[ID 1]', next: 'Airline source'});
  await saved(session, 'airline', {code: 'BAW', next: 'Review search'});
  await session.waitFor('Cancel to menu');
}

async function backToAircraft(session: TerminalSession): Promise<void> {
  session.send(down + enter);
  await session.waitFor('Airline source');
  await session.waitFor('Keep current BAW');
  session.send(down.repeat(three) + enter);
  await session.waitFor('Aircraft source');
  await session.waitFor('Keep current A320');
}

async function checkRetainedAirline(session: TerminalSession): Promise<void> {
  await backToAircraft(session);
  session.send(enter);
  await session.waitFor('Airline source');
  await session.waitFor('Keep current BAW');
  session.send(down + enter);
  await session.waitFor('type to filter');
  await session.waitFor('Air France');
  expect(session.output()).toContain('Keep current BAW');
}

async function reopenSearch(session: TerminalSession): Promise<void> {
  session.send(escape);
  await mainMenu(session);
  session.send(down.repeat(rootSearchIndex) + enter);
  await session.waitFor('Search mode');
  await session.waitFor('Back');
}

async function changeAircraft(session: TerminalSession): Promise<void> {
  await backToAircraft(session);
  session.send(down + enter);
  await session.waitFor('type to filter');
  session.send(`B738${enter}`);
  await session.waitFor('Airline source');
  session.send(enter);
  await session.waitFor('type to filter');
}

async function confirmChangedAirline(session: TerminalSession): Promise<void> {
  const start = session.output().lastIndexOf('Choose airline');
  expect(stripVTControlCharacters(session.output().slice(start))).toContain('Air France');
  expect(stripVTControlCharacters(session.output().slice(start))).not.toContain(
    'British Airways'
  );
  session.send(enter);
  await session.waitFor('Review search');
  await cancelReview(session);
}

test('duplicate aircraft IDs share code-wide airlines and changed selections discard dependent defaults', async () => {
  await seedInventory();
  const session = await openSearch();
  await inventoryReview(session);
  await checkRetainedAirline(session);
  await reopenSearch(session);
  await inventoryReview(session);
  await changeAircraft(session);
  await confirmChangedAirline(session);
});

async function emptyManualBack(session: TerminalSession): Promise<void> {
  session.send(enter);
  await session.waitFor('code (empty goes Back)');
  session.send(enter);
  await session.waitFor('Departure airport source');
  session.send(down + enter);
  await session.waitFor('Search mode');
}

test('empty inventory keeps manual entry and Back reachable without running a search', async () => {
  const session = await openSearch();
  await mode(session, first, 'Departure airport source');
  expect(session.output()).toContain('No saved departure airport choices');
  expect(session.output()).toContain(
    'Manual codes still need saved counterpart airports and linked liveries.'
  );
  await emptyManualBack(session);
  session.send(down.repeat(four) + enter);
  await mainMenu(session);
  expect(session.output()).not.toContain('Command completed.');
  expect(session.output()).not.toContain('Command exited with code 1.');
});

const controlTokens = ['--help', '--h', '--v', '-h'];
test.each(controlTokens)(
  'keeps the ordinary control-value guard for manual %s',
  async token => {
    const session = await openSearch();
    await mode(session, first, 'Departure airport source');
    await manual(session, 'Departure airport', {
      code: token,
      next: 'Optional filters',
      savedAvailable: false,
    });
    await filters(session, first, 'Review search');
    await session.waitFor('Cancel to menu');
    session.send(enter);
    await session.waitFor('A value looks like a CLI help or version flag.');
    await mainMenu(session);
    expect(session.output()).not.toContain('Command completed.');
  }
);

async function deleteLiveriesAtReview(session: TerminalSession): Promise<void> {
  await buildSearch(session, {filter: first, mode: first});
  await session.waitFor('Cancel to menu');
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  db.run('DELETE FROM liveries');
  session.send(enter);
  await session.waitFor('Command exited with code 1.');
  await mainMenu(session);
}

async function refreshedInventory(session: TerminalSession): Promise<void> {
  session.send(down.repeat(rootSearchIndex) + enter);
  await session.waitFor('Search mode');
  await mode(session, three, 'Aircraft source');
  expect(session.output()).toContain('No saved aircraft choices match');
  expect(await Bun.file(path.join(fixture.home, requestFile)).exists()).toBe(false);
}

test('a changed snapshot fails through normal domain validation and refreshes on the next preparation', async () => {
  await seedInventory();
  await configureResearch();
  const session = await openSearch(true);
  await deleteLiveriesAtReview(session);
  await refreshedInventory(session);
});

async function fromSavedToReview(
  session: TerminalSession,
  family: string
): Promise<void> {
  session.send(`EGLL${enter}`);
  await session.waitFor('Optional filters');
  if (family === 'review') {
    await filters(session, first, 'Review search');
    await session.waitFor('Cancel to menu');
  }
}

async function savedPromptFamily(
  session: TerminalSession,
  family: string
): Promise<void> {
  session.send(enter);
  await session.waitFor('type to filter');
  if (family === 'no-match') {
    session.send('impossible-needle');
    await session.waitFor('No matches. Ctrl+U');
  }

  if (family === 'review' || family === 'filters') {
    await fromSavedToReview(session, family);
  }
}

async function openPromptFamily(session: TerminalSession, family: string): Promise<void> {
  if (family === 'mode') {
    return;
  }

  await mode(session, first, 'Departure airport source');
  if (family === 'source') {
    return;
  }

  if (family === 'manual') {
    session.send(down + enter);
    await session.waitFor('code (empty goes Back)');
    return;
  }

  await savedPromptFamily(session, family);
}

test.each(['mode', 'source', 'saved', 'no-match', 'manual', 'filters', 'review'])(
  'session cancellation works at the %s prompt',
  async family => {
    await seedInventory();
    for (const key of [escape, controlC, controlD]) {
      const session = await openSearch();
      await openPromptFamily(session, family);
      session.send(key);
      if (key === escape) {
        await mainMenu(session);
        session.send(controlD);
      }

      expect(await session.exited).toBe(first);
      expectNoExecution(session);
    }
  }
);

function maliciousLabels(): void {
  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  const label = '\u001B[31m東京\u001B[0m\tNorth\nGate';
  const source =
    '\u001B]8;;https://example.invalid/unsafe\u0007source.cfg\u001B]8;;\u0007\r\u0000';
  db.run('UPDATE airports SET name = ?, source_key = ? WHERE id = 3', [label, source]);
  db.run('UPDATE aircraft SET name = ?, source_key = ? WHERE id = 1', [label, source]);
  db.run('UPDATE airlines SET name = ? WHERE id = 1', [label]);
}

function expectSanitized(session: TerminalSession): void {
  const output = session.output();
  expect(output).toContain('東京 North Gate');
  expect(output).toContain('source.cfg  ');
  expect(output).not.toContain('\u001B[31m');
  expect(output).not.toContain('https://example.invalid/unsafe');
  expect(output).not.toContain('\u0000');
}

test('sanitizes saved titles, descriptions and review lines while executing canonical identity', async () => {
  await seedInventory();
  await configureResearch();
  maliciousLabels();
  const session = await openSearch(true);
  await buildSearch(session, {filter: three, mode: first});
  expectSanitized(session);
  await search(session, {
    aircraft: 'A320',
    airline: 'BAW',
    airport: 'EGLL',
    endpoint: 'departure',
    mode: 'endpoint',
  });
});

async function partiallyCodedAirlines(session: TerminalSession): Promise<void> {
  await mode(session, first, 'Departure airport source');
  await saved(session, 'departure airport', {code: 'EGLL', next: 'Optional filters'});
  await filters(session, two, 'Airline source');
  session.send(enter);
  await session.waitFor('type to filter');
  const frame = stripVTControlCharacters(
    session.output().slice(session.output().lastIndexOf('Choose airline'))
  );
  expect(frame).toContain('Delta');
  expect(frame).not.toContain('No airline code');
  expect(session.output()).not.toContain('Unknown airport');
}

async function partiallyCodedAircraft(session: TerminalSession): Promise<void> {
  await mode(session, three, 'Aircraft source');
  await saved(session, 'aircraft', {code: 'C172', next: 'Airline source'});
  const frame = stripVTControlCharacters(
    session.output().slice(session.output().lastIndexOf('Airline source'))
  );
  expect(frame).toContain('Enter a code');
  expect(frame).not.toContain('Saved records');
  await manual(session, 'Airline', {
    code: 'BAW',
    next: 'Review search',
    savedAvailable: false,
  });
  await cancelReview(session);
}

test('omits unidentified suggestions but retains coded identities with a partially coded linked partner', async () => {
  await seedInventory();
  const session = await openSearch();
  await partiallyCodedAirlines(session);
  await reopenSearch(session);
  await partiallyCodedAircraft(session);
});

async function inspectManualCompatibility(session: TerminalSession): Promise<void> {
  session.send(enter);
  await session.waitFor('type to filter');
  await session.waitFor('British Airways');
  expect(
    session.output().slice(session.output().lastIndexOf('Choose airline'))
  ).toContain('Air France');
  session.send(down.repeat(two) + enter);
  await session.waitFor('Airline source');
}

test('manual aircraft and airline codes share the same linked code-wide semantics', async () => {
  await seedInventory();
  await configureResearch();
  const session = await openSearch(true);
  await mode(session, three, 'Aircraft source');
  await manual(session, 'Aircraft', {code: ' a320 ', next: 'Airline source'});
  await inspectManualCompatibility(session);
  await manual(session, 'Airline', {code: ' baw ', next: 'Review search'});
  await search(session, {aircraft: 'A320', airline: 'BAW', mode: 'inventory'});
});

async function returnToFilters(session: TerminalSession): Promise<void> {
  session.send(down + enter);
  await session.waitFor('Airline source');
  session.send(down.repeat(three) + enter);
  await session.waitFor('Aircraft source');
  session.send(down.repeat(three) + enter);
  await session.waitFor('Optional filters');
}

async function changeFilterPlan(session: TerminalSession): Promise<void> {
  session.send(up.repeat(two) + enter);
  await session.waitFor('Aircraft source');
  const frame = session.output().slice(session.output().lastIndexOf('Aircraft source'));
  expect(frame).not.toContain('Keep current');
  await saved(session, 'aircraft', {code: 'A320', next: 'Review search'});
  await session.waitFor('Cancel to menu');
  const review = stripVTControlCharacters(
    session.output().slice(session.output().lastIndexOf('Departures'))
  );
  expect(review).toContain('Aircraft: A320');
  expect(review).not.toContain('Airline:');
}

async function returnToMode(session: TerminalSession): Promise<void> {
  session.send(down + enter);
  await session.waitFor('Aircraft source');
  session.send(down.repeat(three) + enter);
  await session.waitFor('Optional filters');
  session.send(down.repeat(three) + enter);
  await session.waitFor('Departure airport source');
  session.send(down.repeat(three) + enter);
  await session.waitFor('Search mode');
}

async function changedMode(session: TerminalSession): Promise<void> {
  await mode(session, one, 'Destination airport source');
  const frame = session
    .output()
    .slice(session.output().lastIndexOf('Destination airport source'));
  expect(frame).not.toContain('Keep current');
  await saved(session, 'destination airport', {code: 'LFPG', next: 'Optional filters'});
  await filters(session, first, 'Review search');
  const review = stripVTControlCharacters(
    session.output().slice(session.output().lastIndexOf('Arrivals'))
  );
  expect(review).toContain('Destination airport: LFPG');
  expect(review).not.toContain('Aircraft:');
  await cancelReview(session);
}

test('changing filter plans clears optional selections and changing modes clears the prior search', async () => {
  await seedInventory();
  const session = await openSearch();
  await buildSearch(session, {filter: three, mode: first});
  await session.waitFor('Cancel to menu');
  await returnToFilters(session);
  await changeFilterPlan(session);
  await returnToMode(session);
  await changedMode(session);
});

async function returnToDeparture(session: TerminalSession): Promise<void> {
  session.send(down + enter);
  await session.waitFor('Optional filters');
  session.send(down.repeat(four) + enter);
  await session.waitFor('Destination airport source');
  session.send(down.repeat(three) + enter);
  await session.waitFor('Departure airport source');
  session.send(enter);
  await session.waitFor('Destination airport source');
  expect(
    session.output().slice(session.output().lastIndexOf('Destination airport source'))
  ).toContain('Keep current LFPG');
}

async function replaceDeparture(session: TerminalSession): Promise<void> {
  session.send(down.repeat(three) + enter);
  await session.waitFor('Departure airport source');
  session.send(down.repeat(two) + enter);
  await session.waitFor('code (empty goes Back)');
  session.send(`CYUL${enter}`);
  await session.waitFor('Destination airport source');
  expect(
    session.output().slice(session.output().lastIndexOf('Destination airport source'))
  ).not.toContain('Keep current');
  await saved(session, 'destination airport', {code: 'EGLL', next: 'Optional filters'});
}

test('keeps a route destination for an unchanged departure and clears it after a departure change', async () => {
  await seedInventory();
  const session = await openSearch();
  await buildSearch(session, {filter: first, mode: two});
  await session.waitFor('Cancel to menu');
  await returnToDeparture(session);
  await replaceDeparture(session);
  await filters(session, first, 'Review search');
  expect(session.output()).toContain('Departure airport: CYUL | manual');
  await cancelReview(session);
});

async function replaceDuplicateAircraft(session: TerminalSession): Promise<void> {
  await backToAircraft(session);
  session.send(down + enter);
  await session.waitFor('type to filter');
  session.send(`[ID 2]${enter}`);
  await session.waitFor('Airline source');
  expect(
    session.output().slice(session.output().lastIndexOf('Airline source'))
  ).not.toContain('Keep current');
  await saved(session, 'airline', {code: 'AFR', next: 'Review search'});
  expect(session.output()).toContain('Shared jet | Airbus | A320 [ID 2]');
  await cancelReview(session);
}

test('changing saved aircraft IDs with the same code resets the dependent airline', async () => {
  await seedInventory();
  const session = await openSearch();
  await inventoryReview(session);
  await replaceDuplicateAircraft(session);
});

async function rejectSearch(session: TerminalSession): Promise<void> {
  await session.waitFor('Cancel to menu');
  session.send(enter);
  await session.waitFor('Command exited with code 1.');
  await mainMenu(session);
  expect(await Bun.file(path.join(fixture.home, requestFile)).exists()).toBe(false);
}

test.each([' ', 'NOT-A-CODE'])(
  'leaves manual airport validity for the ordinary domain validator for %j',
  async code => {
    await seedInventory();
    await configureResearch();
    const session = await openSearch(true);
    await mode(session, first, 'Departure airport source');
    await manual(session, 'Departure airport', {code, next: 'Optional filters'});
    await filters(session, first, 'Review search');
    await rejectSearch(session);
  }
);
