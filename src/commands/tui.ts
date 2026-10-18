import {BunTerminal} from '@effect/platform-bun';
import {Console, Effect, Terminal} from 'effect';
import {Command} from 'effect/cli';
import type {CliError} from 'effect/cli/CliError';
import {Select as select} from 'effect/cli/Prompt';
import {TaggedError as taggedError} from 'effect/Data';
import type {Scope} from 'effect/Scope';

import invocationClassifier from '#invocation';
import sentry from '#sentry';

import type ordinary from './ordinary.ts';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type CommandTree = DeepReadonly<Command.Command.Any>;
type RootCommand = DeepReadonly<typeof ordinary.command>;
type PromptServices = Exclude<Command.Environment, Terminal.Terminal>;
const {catch: catchEffect} = Effect;

type Selection =
  | Readonly<{kind: 'Back'}>
  | Readonly<{kind: 'Exit'}>
  | Readonly<{kind: 'Command'; command: CommandTree}>;
type PreparedCommand = Readonly<{kind: 'Prepared'; args: readonly string[]}>;
type PreparationOutcome = PreparedCommand | Readonly<{kind: 'Exit' | 'Retry'}>;
type Cancellation =
  | Readonly<{kind: 'Root' | 'Nested'}>
  | Readonly<{kind: 'Cancelled'; outcome: Readonly<{kind: 'Exit' | 'Retry'}>}>;
class InteractiveError extends taggedError('InteractiveError')<{
  readonly message: string;
}> {}

const exit = {kind: 'Exit'} as const;
const navigationOutcomes = {Back: {kind: 'Retry'}, Exit: exit} as const;
function runSelectedCommand(
  root: RootCommand,
  args: readonly string[],
  version: string
): Effect.Effect<void, never, Command.Environment> {
  return sentry
    .instrument(
      () => Command.runWith(root, {renderErrors: false, version})(args),
      invocationClassifier.classify(
        args,
        root.subcommands.flatMap(group => group.commands)
      )
    )
    .pipe(
      Effect.matchEffect({
        onFailure: () =>
          Console.error(
            'Could not run the command. Check the values and try again.'
          ).pipe(Effect.andThen(Console.log('\nCommand exited with code 1.\n'))),
        onSuccess: () => Console.log('\nCommand completed.\n'),
      })
    );
}

function prepareArguments(
  args: readonly string[]
): Effect.Effect<PreparedCommand | Readonly<{kind: 'Retry'}>> {
  if (args.some(argument => invocationClassifier.isCliControlArgument(argument))) {
    return Console.error(
      'A value looks like a CLI help or version flag. Use the CLI directly to pass this value.'
    ).pipe(Effect.as({kind: 'Retry'} as const));
  }

  return Effect.succeed({args, kind: 'Prepared'});
}

function cancelInput(
  input: DeepReadonly<Terminal.UserInput>,
  cancellation: Cancellation
): Cancellation {
  if (input.key.name === 'escape') {
    let outcome: Readonly<{kind: 'Exit' | 'Retry'}> = exit;
    if (cancellation.kind === 'Nested') {
      outcome = {kind: 'Retry'};
    }

    return {kind: 'Cancelled', outcome};
  }

  if (input.key.ctrl && (input.key.name === 'c' || input.key.name === 'd')) {
    return {kind: 'Cancelled', outcome: exit};
  }

  return cancellation;
}

function selectCommand(
  command: CommandTree,
  menu: 'Root' | 'Nested'
): Effect.Effect<Selection, Terminal.QuitError, Command.Environment> {
  const choices: Readonly<{
    title: string;
    description?: string | undefined;
    value: Selection;
  }>[] = command.subcommands.flatMap((group: CommandTree['subcommands'][number]) =>
    group.commands
      .filter((child: CommandTree) => !child.unlisted)
      .map((child: CommandTree) => ({
        description: child.shortDescription ?? child.description,
        title: child.name,
        value: {command: child, kind: 'Command'},
      }))
  );
  let message = 'Command';
  if (menu === 'Root') {
    message = 'Choose a command';
    choices.push({title: 'Exit', value: exit});
  } else {
    choices.push({title: 'back', value: {kind: 'Back'}});
  }

  return select({choices, maxPerPage: choices.length, message});
}

function collectSelection(
  selection: Selection,
  prefix: readonly string[]
): Effect.Effect<PreparationOutcome, Terminal.QuitError | CliError, Command.Environment> {
  return Effect.gen(function* collectSelectedCommand() {
    if (selection.kind !== 'Command') {
      return navigationOutcomes[selection.kind];
    }

    const {command} = selection;
    const path = [...prefix, command.name];
    if (
      command.subcommands.some(group => group.commands.some(child => !child.unlisted))
    ) {
      const child = yield* selectCommand(command, 'Nested');
      return yield* collectSelection(child, path);
    }

    yield* Console.log('Escape returns to the menu. Ctrl+C or Ctrl+D exits.');
    const args = yield* Command.wizard(command, {prefix: path});
    return yield* prepareArguments(args);
  });
}

type TuiSession = Readonly<{
  prepare: Effect.Effect<PreparationOutcome, never, PromptServices>;
  terminal: Terminal.Terminal;
}>;

function makeTuiSession(root: CommandTree): Effect.Effect<TuiSession, never, Scope> {
  return Effect.gen(function* createSession() {
    let cancellation: Cancellation = {kind: 'Root'};
    const terminal = yield* BunTerminal.make(
      (input: DeepReadonly<Terminal.UserInput>) => {
        cancellation = cancelInput(input, cancellation);
        return cancellation.kind === 'Cancelled';
      }
    );
    const prepare = Effect.gen(function* promptForCommand() {
      cancellation = {kind: 'Root'};
      const selection = yield* selectCommand(root, 'Root');
      cancellation = {kind: 'Nested'};
      return yield* collectSelection(selection, []);
    }).pipe(
      Effect.provideService(Terminal.Terminal, terminal),
      Effect.catchTag('QuitError', () => {
        if (cancellation.kind === 'Cancelled') {
          return Effect.succeed(cancellation.outcome);
        }

        return Effect.succeed(exit);
      }),
      catchEffect(() =>
        Console.error('Could not prepare the command. Please try again.').pipe(
          Effect.as({kind: 'Retry'} as const)
        )
      )
    );
    return {prepare, terminal};
  });
}

function makeTuiCommand(
  root: RootCommand,
  version: string
): Command.Command<
  'tui',
  Record<string, never>,
  Record<string, never>,
  InteractiveError,
  PromptServices
> {
  return Command.make('tui', {}, () =>
    Effect.gen(function* runTui() {
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return yield* new InteractiveError({
          message:
            'Interactive mode requires a terminal. Run flightsim-things --help for CLI usage.',
        });
      }

      const session = yield* makeTuiSession(root);
      while (true) {
        const prepared = yield* session.prepare;
        if (prepared.kind === 'Exit') {
          return yield* Effect.void;
        }

        if (prepared.kind === 'Prepared') {
          yield* runSelectedCommand(root, prepared.args, version).pipe(
            Effect.provideService(Terminal.Terminal, session.terminal)
          );
        }
      }
    }).pipe(Effect.scoped)
  ).pipe(Command.withDescription('Run commands in an interactive terminal menu'));
}

export default makeTuiCommand;
