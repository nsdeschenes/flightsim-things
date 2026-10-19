import {expect, setDefaultTimeout, test} from 'bun:test';
import {mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';

import {BunServices} from '@effect/platform-bun';
import {Effect, Option, Redacted} from 'effect';
import {CliConfig, Command, GlobalFlag} from 'effect/cli';

import createCliFixture from '#acceptance-cli';
import ordinary from '#ordinary-commands';

import createTerminalSession from './support/terminal.ts';

const timeoutMilliseconds = 30_000;
setDefaultTimeout(timeoutMilliseconds);
const canonicalExecutable = 'flightsim-things';
const words = /(?<quoted>"[^"\r\n]*")|(?<word>[^\s"'$`\\;|&<>]+)/gu;
const newline = /\r?\n/u;
const firstWord = 1;
const noItems = 0;
const oneItem = 1;
const communitySet =
  'flightsim-things community-path set "C:/Flight Simulator/Community"';
const communityUpdate =
  'flightsim-things community-path update "C:/Flight Simulator/Community"';
const aiSet =
  'flightsim-things ai set --provider openai --model YOUR_MODEL_ID --api-key YOUR_API_KEY';
const aiWizard = 'flightsim-things ai set --wizard';
const openaipSet = 'flightsim-things openaip-key set YOUR_OPENAIP_API_KEY';
const sentrySet =
  'flightsim-things sentry set --dsn https://YOUR_PUBLIC_KEY@example.invalid/1 --errors 0 --logs 0 --metrics 0 --traces 0';
const sentryUpdate = 'flightsim-things sentry update --traces 0';
const flightCases = [
  {
    command: 'flightsim-things find-flight --dep EGLL',
    error:
      'No identified destination airports are saved outside the departure airport. Run scan and airports enrich to populate airport codes.',
    input: {dep: Option.some('EGLL')},
  },
  {
    command: 'flightsim-things find-flight --arr LFPG',
    error:
      'No identified departure airports are saved outside the destination airport. Run scan and airports enrich to populate airport codes.',
    input: {arr: Option.some('LFPG')},
  },
  {
    command: 'flightsim-things find-flight --dep EGLL --arr LFPG',
    error:
      'No identified destination airport matching LFPG is saved outside the departure airport. Choose a different saved destination, or run scan and airports enrich to populate airport codes.',
    input: {arr: Option.some('LFPG'), dep: Option.some('EGLL')},
  },
  {
    command: 'flightsim-things find-flight --aircraft A320 --airline BAW',
    error:
      'At least two distinct identified airports must be saved. Run scan and airports enrich to populate airport codes.',
    input: {aircraft: Option.some('A320'), airline: Option.some('BAW')},
  },
  {
    command: 'flightsim-things find-flight --dep EGLL --aircraft A320 --airline BAW',
    error:
      'No identified destination airports are saved outside the departure airport. Run scan and airports enrich to populate airport codes.',
    input: {
      aircraft: Option.some('A320'),
      airline: Option.some('BAW'),
      dep: Option.some('EGLL'),
    },
  },
] as const;
const helpCases = [
  {
    commands: [
      communitySet,
      'flightsim-things scan',
      'flightsim-things find-flight --help',
      'flightsim-things --wizard',
      aiWizard,
    ],
    path: [],
  },
  {commands: [communitySet, communityUpdate], path: ['community-path']},
  {commands: [communitySet], path: ['community-path', 'set']},
  {commands: [communityUpdate], path: ['community-path', 'update']},
  {
    commands: ['flightsim-things scan', 'flightsim-things scan --verbose'],
    path: ['scan'],
  },
  {
    commands: flightCases.map(
      (entry: DeepReadonly<(typeof flightCases)[number]>) => entry.command
    ),
    path: ['find-flight'],
  },
  {commands: [aiSet, aiWizard, 'flightsim-things ai get'], path: ['ai']},
  {commands: [aiSet, aiWizard], path: ['ai', 'set']},
  {commands: [openaipSet], path: ['openaip-key']},
  {commands: [openaipSet], path: ['openaip-key', 'set']},
  {commands: [sentrySet, sentryUpdate, 'flightsim-things sentry get'], path: ['sentry']},
  {commands: [sentrySet], path: ['sentry', 'set']},
  {commands: [sentryUpdate], path: ['sentry', 'update']},
] as const;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type ParsedCommand = Readonly<{path: string; input: unknown}>;

function exampleArguments(line: string): string[] {
  const matches = [...line.matchAll(words)];
  expect(
    matches.map((match: DeepReadonly<RegExpExecArray>) => match[noItems]).join(' ')
  ).toBe(line);
  const tokens = matches.map((match: DeepReadonly<RegExpExecArray>) => {
    const token = match[noItems];
    if (token.startsWith('"')) {
      return token.slice(firstWord, -firstWord);
    }

    return token;
  });
  expect(tokens[noItems]).toBe(canonicalExecutable);
  return tokens.slice(firstWord);
}

function displayedExamples(output: string): string[] {
  const section = Bun.stripANSI(output)
    .replaceAll('\r\n', '\n')
    .split('EXAMPLES\n')
    .at(firstWord);
  expect(section).toBeDefined();
  return (section ?? '')
    .split(newline)
    .map(line => line.trim())
    .filter(line => line.startsWith(`${canonicalExecutable} `));
}

function inertCommand(
  command: DeepReadonly<Command.Command.Any>,
  onParsed: (selected: ParsedCommand) => void,
  ancestors: readonly string[] = []
): Command.Command<string, never, unknown> {
  const route = [...ancestors, command.name];
  const inert = command.pipe(
    Command.withHandler((input: unknown) =>
      Effect.sync(() => {
        onParsed({input, path: route.join(' ')});
      })
    )
  );
  const children = command.subcommands.flatMap(
    (group: DeepReadonly<Command.Command.Any['subcommands'][number]>) => group.commands
  );
  if (children.length === noItems) {
    return inert;
  }

  return inert.pipe(
    Command.withSubcommands(
      children.map((child: DeepReadonly<Command.Command.Any>) =>
        inertCommand(child, onParsed, route)
      )
    )
  );
}

function revealCredential(value: unknown): unknown {
  if (Redacted.isRedacted(value)) {
    return Redacted.value(value);
  }

  return value;
}

function revealTestCredentials(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) {
    return input;
  }

  return Object.fromEntries(
    Object.entries(input).map(([key, value]: readonly [string, unknown]) => [
      key,
      revealCredential(value),
    ])
  );
}

async function parseExample(line: string): Promise<readonly ParsedCommand[]> {
  const selected: ParsedCommand[] = [];
  const root = inertCommand(ordinary.command, input => {
    selected.push(input);
  });
  const run = Command.runWith(root, {renderErrors: false, version: '1.0.0'});
  const parsing = run(exampleArguments(line));
  const configuration = CliConfig.layer({
    builtIns: [GlobalFlag.Help, GlobalFlag.Version, GlobalFlag.Completions],
  });
  await Effect.runPromise(
    parsing.pipe(Effect.provide([BunServices.layer, configuration]))
  );
  return selected;
}

const expectedInputs = new Map<string, ParsedCommand>([
  [
    communitySet,
    {
      input: {path: 'C:/Flight Simulator/Community'},
      path: 'flightsim-things community-path set',
    },
  ],
  [
    communityUpdate,
    {
      input: {path: 'C:/Flight Simulator/Community'},
      path: 'flightsim-things community-path update',
    },
  ],
  [
    aiSet,
    {
      input: {apiKey: 'YOUR_API_KEY', model: 'YOUR_MODEL_ID', provider: 'openai'},
      path: 'flightsim-things ai set',
    },
  ],
  [
    openaipSet,
    {input: {key: 'YOUR_OPENAIP_API_KEY'}, path: 'flightsim-things openaip-key set'},
  ],
  [
    sentrySet,
    {
      input: {
        dsn: 'https://YOUR_PUBLIC_KEY@example.invalid/1',
        errors: '0',
        logs: '0',
        metrics: '0',
        traces: '0',
      },
      path: 'flightsim-things sentry set',
    },
  ],
  [
    sentryUpdate,
    {
      input: {
        dsn: Option.none(),
        errors: Option.none(),
        logs: Option.none(),
        metrics: Option.none(),
        traces: Option.some('0'),
      },
      path: 'flightsim-things sentry update',
    },
  ],
  ['flightsim-things scan', {input: {verbose: false}, path: 'flightsim-things scan'}],
  [
    'flightsim-things scan --verbose',
    {input: {verbose: true}, path: 'flightsim-things scan'},
  ],
  ['flightsim-things ai get', {input: {}, path: 'flightsim-things ai get'}],
  ['flightsim-things sentry get', {input: {}, path: 'flightsim-things sentry get'}],
  ...flightCases.map(
    (entry: DeepReadonly<(typeof flightCases)[number]>) =>
      [
        entry.command,
        {
          input: {
            aircraft: Option.none(),
            airline: Option.none(),
            arr: Option.none(),
            dep: Option.none(),
            ...entry.input,
          },
          path: 'flightsim-things find-flight',
        },
      ] as const
  ),
]);

async function checkParsedExample(line: string): Promise<void> {
  const selected = await parseExample(line);
  if (line.endsWith('--help')) {
    expect(selected).toEqual([]);
    return;
  }

  const expected = expectedInputs.get(line);
  expect(expected).toBeDefined();
  expect(selected).toHaveLength(oneItem);
  for (const parsed of selected) {
    expect(expected).toEqual({
      input: revealTestCredentials(parsed.input),
      path: parsed.path,
    });
  }
}

test.each([...helpCases])(
  'help at $path displays examples accepted by its real parser',
  async (entry: DeepReadonly<(typeof helpCases)[number]>) => {
    const fixture = await createCliFixture();
    try {
      const help = await fixture.run(...entry.path, '--help');
      expect(help).toMatchObject({exitCode: noItems, stderr: ''});
      const displayed = displayedExamples(help.stdout);
      expect(displayed).toEqual([...entry.commands]);
      for (const line of displayed.filter(command => !command.endsWith('--wizard'))) {
        await checkParsedExample(line);
      }
    } finally {
      await fixture.dispose();
    }
  }
);

async function saveExampleConfiguration(
  fixture: Readonly<Awaited<ReturnType<typeof createCliFixture>>>,
  directory: string
): Promise<void> {
  const setupHelp = await fixture.run('community-path', 'set', '--help');
  const [setup = ''] = displayedExamples(setupHelp.stdout);
  const args = exampleArguments(
    setup.replace('C:/Flight Simulator/Community', directory)
  );
  expect(await fixture.run(...args)).toEqual({
    exitCode: noItems,
    stderr: '',
    stdout: `${directory}\n`,
  });
  expect(await fixture.run('scan')).toEqual({
    exitCode: noItems,
    stderr: '',
    stdout:
      'Scanned 0 packages, 0 aircraft, 0 airports, and 0 liveries. 0 packages failed. 0 warnings.\n',
  });
  expect(await fixture.run(...exampleArguments(aiSet))).toEqual({
    exitCode: noItems,
    stderr: '',
    stdout: 'AI configuration saved.\n',
  });
}

async function checkFlightPrerequisites(
  fixture: Readonly<Awaited<ReturnType<typeof createCliFixture>>>
): Promise<void> {
  for (const entry of flightCases) {
    const result = await fixture.run(...exampleArguments(entry.command));
    expect(result).toEqual({
      exitCode: oneItem,
      stderr: `Command failed, ${entry.error}\n`,
      stdout: '',
    });
  }
}

test('setup examples save a spaced path, scan an empty directory, and save fake AI values', async () => {
  const fixture = await createCliFixture();
  try {
    const directory = path.join(fixture.home, 'Flight Simulator', 'Community');
    await mkdir(directory, {recursive: true});
    await saveExampleConfiguration(fixture, directory);
    const saved: unknown = JSON.parse(await readFile(fixture.configurationFile, 'utf8'));
    expect(saved).toMatchObject({
      ai: {apiKey: 'YOUR_API_KEY', model: 'YOUR_MODEL_ID', provider: 'openai'},
      communityPath: directory,
    });
    await checkFlightPrerequisites(fixture);
  } finally {
    await fixture.dispose();
  }
});

const terminalCases = [
  {
    commands: [
      communitySet,
      'flightsim-things scan',
      'flightsim-things find-flight --help',
      'flightsim-things --wizard',
      aiWizard,
    ],
    last: aiWizard,
    route: [],
  },
  {commands: [sentrySet], last: sentrySet, route: ['sentry', 'set']},
] as const;

test.each([...terminalCases])(
  'help examples remain complete in a PTY at $route',
  async entry => {
    const fixture = await createCliFixture();
    const session = createTerminalSession(fixture.executable, fixture.home, [
      ...entry.route,
      '--help',
    ]);
    try {
      await session.waitFor(entry.last);
      expect(await session.exited).toBe(noItems);
      expect(displayedExamples(session.output())).toEqual([...entry.commands]);
      if (entry.route.length === noItems) {
        expect(session.output()).toContain(
          'Replace flightsim-things with your executable'
        );
      }
    } finally {
      await session.dispose();
      await fixture.dispose();
    }
  }
);
