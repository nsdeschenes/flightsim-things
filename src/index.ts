import {BunRuntime, BunServices} from '@effect/platform-bun';
import {Effect, Option, Redacted} from 'effect';
import {CliConfig, CliError, Command, GlobalFlag} from 'effect/cli';

import {version} from '#package';
import sentry from '#sentry';

import command from './commands/index.ts';
import ordinary from './commands/ordinary.ts';
import directWizard from './direct-wizard.ts';
import invocationClassifier from './invocation.ts';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;

const argvOffset = 2;
const successExitCode = 0;
const commandFailureExitCode = 1;
const unknownCommandExitCode = 251;
const invalidArgumentsExitCode = 252;
const noErrors = 0;

function exitCodeFor(error: unknown): number {
  if (!(error instanceof CliError.ShowHelp)) {
    return commandFailureExitCode;
  }

  if (error.errors.length === noErrors) {
    return successExitCode;
  }

  if (
    error.errors.some(
      (parseError: Readonly<Error>) => parseError instanceof CliError.UnknownSubcommand
    )
  ) {
    return unknownCommandExitCode;
  }

  return invalidArgumentsExitCode;
}

function failureMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

const noArguments = 0;
let args = process.argv.slice(argvOffset);
if (args.length === noArguments) {
  args = ['tui'];
}

function renderFailure(
  error: unknown,
  sensitiveCommand: DeepReadonly<Option.Option<'ai' | 'openaip-key'>>,
  sanitizeErrors: boolean
): void {
  process.exitCode = exitCodeFor(error);
  if (
    (Option.isSome(sensitiveCommand) || sanitizeErrors) &&
    CliError.isCliError(error) &&
    (!(error instanceof CliError.ShowHelp) || error.errors.length !== noErrors)
  ) {
    let message = 'Invalid command arguments. Run flightsim-things --help for usage.\n';
    if (!sanitizeErrors && Option.contains(sensitiveCommand, 'ai')) {
      message =
        'Invalid AI command arguments. Run flightsim-things ai --help for usage.\n';
    } else if (!sanitizeErrors) {
      message =
        'Invalid OpenAIP key command arguments. Run flightsim-things openaip-key --help for usage.\n';
    }

    process.stderr.write(message);
  } else if (!(error instanceof CliError.ShowHelp)) {
    process.stderr.write(`Command failed, ${failureMessage(error)}\n`);
  }
}

function execute(
  executionArgs: readonly string[],
  tree: DeepReadonly<typeof command | typeof ordinary.command>,
  sanitizeErrors = false
): Effect.Effect<void, never, Command.Environment> {
  const invocation = invocationClassifier.classify(
    executionArgs,
    tree.subcommands.flatMap(group => group.commands)
  );
  return sentry
    .instrument(
      () =>
        Command.runWith(tree, {
          renderErrors: !Option.isSome(invocation.sensitiveCommand) && !sanitizeErrors,
          version,
        })(executionArgs),
      invocation
    )
    .pipe(
      Effect.match({
        onFailure(error: unknown) {
          renderFailure(error, invocation.sensitiveCommand, sanitizeErrors);
        },
        onSuccess() {
          process.exitCode = successExitCode;
        },
      })
    );
}

const main = sentry
  .run(() =>
    directWizard.prepare(args, ordinary.command).pipe(
      Effect.flatMap(
        (
          request: DeepReadonly<Effect.Success<ReturnType<typeof directWizard.prepare>>>
        ) => {
          if (request.kind === 'Ordinary') {
            return execute(request.args, command, request.sanitizeErrors);
          }

          if (request.kind === 'Confirmed') {
            return execute(Redacted.value(request.args), ordinary.command);
          }

          return Effect.void;
        }
      )
    )
  )
  .pipe(
    Effect.provide([
      BunServices.layer,
      CliConfig.layer({
        builtIns: [GlobalFlag.Help, GlobalFlag.Version, GlobalFlag.Completions],
      }),
    ]),
    Effect.match({
      onFailure(error: unknown) {
        if (error instanceof directWizard.Error) {
          process.exitCode = error.exitCode;
          process.stderr.write(`${error.message}\n`);
        } else {
          process.exitCode = commandFailureExitCode;
          process.stderr.write(
            'Could not prepare the command. Run flightsim-things --help for usage.\n'
          );
        }
      },
      onSuccess() {
        process.exitCode ??= successExitCode;
      },
    })
  );

BunRuntime.runMain(main);
