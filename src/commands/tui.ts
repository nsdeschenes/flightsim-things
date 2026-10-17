import {fileURLToPath} from 'node:url';

import {BunTerminal} from '@effect/platform-bun';
import {Console, Effect, Terminal} from 'effect';
import {Command} from 'effect/cli';
import {Select as select} from 'effect/cli/Prompt';
import {TaggedError as taggedError} from 'effect/Data';

import invocationClassifier from '#invocation';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type CommandTree = DeepReadonly<Command.Command.Any>;
type PromptServices = Exclude<Command.Environment, Terminal.Terminal>;
const {catch: catchEffect} = Effect;

type Selection =
  | Readonly<{kind: 'Exit'}>
  | Readonly<{kind: 'Command'; command: CommandTree}>;
type PreparedCommand = Readonly<{kind: 'Prepared'; args: readonly string[]}>;
class InteractiveError extends taggedError('InteractiveError')<{
  readonly message: string;
}> {}

const exit = {kind: 'Exit'} as const;
const successExitCode = 0;

function relaunchCommand(args: readonly string[]): string[] {
  if (Bun.isStandaloneExecutable) {
    return [process.execPath, ...args];
  }

  return [
    process.execPath,
    fileURLToPath(new URL('../index.ts', import.meta.url)),
    ...args,
  ];
}

function runChild(args: readonly string[]): Effect.Effect<void, InteractiveError> {
  return Effect.scoped(
    Effect.gen(function* executeSelectedCommand() {
      const child = yield* Effect.acquireRelease(
        Effect.try({
          catch: () =>
            new InteractiveError({message: 'Could not start the selected command.'}),
          try: () =>
            Bun.spawn(relaunchCommand(args), {
              stderr: 'inherit',
              stdin: 'inherit',
              stdout: 'inherit',
            }),
        }),
        (running: DeepReadonly<Bun.Subprocess>) =>
          Effect.promise(async () => {
            if (running.exitCode === null) {
              running.kill();
            }

            await running.exited;
          })
      );
      const code = yield* Effect.promise(async () => {
        const exitCode = await child.exited;
        return exitCode;
      });
      let outcome = `\nCommand exited with code ${code}.\n`;
      if (code === successExitCode) {
        outcome = '\nCommand completed.\n';
      }

      yield* Console.log(outcome);
    })
  );
}

function shouldQuit(input: DeepReadonly<Terminal.UserInput>): boolean {
  return (
    input.key.name === 'escape' ||
    (input.key.ctrl && (input.key.name === 'c' || input.key.name === 'd'))
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

function prepareCommand(
  root: CommandTree
): Effect.Effect<
  PreparedCommand | Readonly<{kind: 'Exit' | 'Retry'}>,
  never,
  PromptServices
> {
  return Effect.scoped(
    Effect.gen(function* collectCommand() {
      const terminal = yield* BunTerminal.make(shouldQuit);
      return yield* Effect.gen(function* promptForCommand() {
        const choices: Readonly<{
          title: string;
          description?: string | undefined;
          value: Selection;
        }>[] = root.subcommands.flatMap((group: CommandTree['subcommands'][number]) =>
          group.commands
            .filter((command: CommandTree) => !command.unlisted)
            .map((command: CommandTree) => ({
              description: command.shortDescription ?? command.description,
              title: command.name,
              value: {command, kind: 'Command'},
            }))
        );
        choices.push({title: 'Exit', value: exit});
        const selection = yield* select({
          choices,
          maxPerPage: choices.length,
          message: 'Choose a command',
        });
        if (selection.kind === 'Exit') {
          return exit;
        }

        const args = yield* Command.wizard(selection.command);
        return yield* prepareArguments(args);
      }).pipe(Effect.provideService(Terminal.Terminal, terminal));
    })
  ).pipe(
    Effect.catchTag('QuitError', () => Effect.succeed(exit)),
    catchEffect(() =>
      Console.error('Could not prepare the command. Please try again.').pipe(
        Effect.as({kind: 'Retry'} as const)
      )
    )
  );
}

function makeTuiCommand(
  root: CommandTree
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

      while (true) {
        // Close the prompt terminal before the child inherits stdin and restores its own input mode.
        const prepared = yield* prepareCommand(root);
        if (prepared.kind === 'Exit') {
          return yield* Effect.void;
        }

        if (prepared.kind === 'Prepared') {
          yield* runChild(prepared.args).pipe(
            catchEffect(() => Console.error('Could not run the selected command.'))
          );
        }
      }
    })
  ).pipe(Command.withDescription('Run commands in an interactive terminal menu'));
}

export default makeTuiCommand;
