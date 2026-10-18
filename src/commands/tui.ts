import {BunTerminal} from '@effect/platform-bun';
import {Console, Data, Deferred, Effect, Queue, Terminal} from 'effect';
import type {Done} from 'effect/Cause';
import {Command} from 'effect/cli';
import type {CliError} from 'effect/cli/CliError';
import {Select as select} from 'effect/cli/Prompt';
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
const {TaggedError: taggedError} = Data;

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
  exitRequested: Effect.Effect<void>;
}>;
type InputSink = DeepReadonly<{
  offer: (input: DeepReadonly<Terminal.UserInput>) => void;
  end: () => void;
}>;
type PromptInput =
  | Readonly<{kind: 'Idle' | 'Ended'}>
  | Readonly<{kind: 'Reading'; sink: InputSink}>;
type SessionInput = DeepReadonly<{
  getCancellation: () => Cancellation;
  setCancellation: (value: Cancellation) => void;
  getPrompt: () => PromptInput;
  setPrompt: (value: PromptInput) => void;
  exitRequested: Effect.Effect<void>;
  requestExit: () => void;
}>;

function makeSessionInput(): Effect.Effect<SessionInput> {
  return Effect.gen(function* createSessionInput() {
    let cancellation: Cancellation = {kind: 'Root'};
    let prompt: PromptInput = {kind: 'Idle'};
    const exitRequested = yield* Deferred.make<Readonly<{kind: 'Exit'}>>();
    return {
      exitRequested: Deferred.await(exitRequested).pipe(Effect.asVoid),
      getCancellation: () => cancellation,
      getPrompt: () => prompt,
      requestExit() {
        Deferred.doneUnsafe(exitRequested, Effect.succeed(exit));
      },
      setCancellation(value) {
        cancellation = value;
      },
      setPrompt(value) {
        prompt = value;
      },
    };
  });
}

function forwardPromptInput(
  input: DeepReadonly<Terminal.UserInput>,
  sink: InputSink,
  session: SessionInput
): void {
  const cancellation = cancelInput(input, session.getCancellation());
  session.setCancellation(cancellation);
  if (cancellation.kind === 'Cancelled') {
    session.setPrompt({kind: 'Idle'});
  }

  sink.offer(input);
  if (cancellation.kind === 'Cancelled') {
    sink.end();
  }
}

function forwardInput(
  input: DeepReadonly<Terminal.UserInput>,
  session: SessionInput
): void {
  const prompt = session.getPrompt();
  if (prompt.kind === 'Reading') {
    forwardPromptInput(input, prompt.sink, session);
  } else if (input.key.ctrl && (input.key.name === 'c' || input.key.name === 'd')) {
    session.requestExit();
  }
}

function readPromptInput(session: SessionInput): Terminal.Terminal['readInput'] {
  return Effect.gen(function* acquirePromptInput() {
    const queue = yield* Queue.make<Terminal.UserInput, Done>();
    const sink: InputSink = {
      end() {
        Queue.endUnsafe(queue);
      },
      offer(input) {
        Queue.offerUnsafe(queue, input);
      },
    };
    if (session.getPrompt().kind === 'Ended') {
      sink.end();
    } else {
      session.setPrompt({kind: 'Reading', sink});
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const prompt = session.getPrompt();
        if (prompt.kind === 'Reading' && prompt.sink === sink) {
          session.setPrompt({kind: 'Idle'});
        }
      })
    );
    return queue;
  });
}

function makeSessionTerminal(
  session: SessionInput
): Effect.Effect<Terminal.Terminal, never, Scope> {
  return Effect.gen(function* acquireSessionInput() {
    const terminal = yield* BunTerminal.make(
      (input: DeepReadonly<Terminal.UserInput>) => {
        forwardInput(input, session);
        return false;
      }
    );
    const input = yield* terminal.readInput;
    yield* Queue.take(input).pipe(
      Effect.forever,
      catchEffect(() =>
        Effect.sync(() => {
          const prompt = session.getPrompt();
          if (prompt.kind === 'Reading') {
            prompt.sink.end();
          }

          session.setPrompt({kind: 'Ended'});
          session.requestExit();
        })
      ),
      Effect.forkScoped
    );
    return Terminal.make({...terminal, readInput: readPromptInput(session)});
  });
}

function makeTuiSession(root: CommandTree): Effect.Effect<TuiSession, never, Scope> {
  return Effect.gen(function* createSession() {
    const input = yield* makeSessionInput();
    const terminal = yield* makeSessionTerminal(input);
    const prepare = Effect.gen(function* promptForCommand() {
      input.setCancellation({kind: 'Root'});
      const selection = yield* selectCommand(root, 'Root');
      input.setCancellation({kind: 'Nested'});
      return yield* collectSelection(selection, []);
    }).pipe(
      Effect.provideService(Terminal.Terminal, terminal),
      Effect.catchTag('QuitError', () => {
        const cancellation = input.getCancellation();
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
    return {
      exitRequested: input.exitRequested,
      prepare,
      terminal,
    };
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
      return yield* Effect.gen(function* runMenuCommands() {
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
      }).pipe(Effect.raceFirst(session.exitRequested));
    }).pipe(Effect.scoped)
  ).pipe(Command.withDescription('Run commands in an interactive terminal menu'));
}

export default makeTuiCommand;
