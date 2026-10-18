import {BunRuntime, BunServices} from '@effect/platform-bun';
import {Effect, Option} from 'effect';
import {CliConfig, CliError, Command, GlobalFlag} from 'effect/cli';

import {version} from '#package';
import sentry from '#sentry';

import command from './commands/index.ts';
import invocationClassifier from './invocation.ts';

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

const invocation = invocationClassifier.classify(
  args,
  command.subcommands.flatMap(
    (
      group: Readonly<{
        commands: readonly Readonly<{name: string; alias: string | undefined}>[];
      }>
    ) => group.commands
  )
);
const sensitiveInvocation = Option.isSome(invocation.sensitiveCommand);
let sensitiveUsageError =
  'Invalid OpenAIP key command arguments. Run flightsim-things openaip-key --help for usage.\n';
if (Option.contains(invocation.sensitiveCommand, 'ai')) {
  sensitiveUsageError =
    'Invalid AI command arguments. Run flightsim-things ai --help for usage.\n';
}

const main = sentry
  .run(() =>
    sentry.instrument(
      () => Command.runWith(command, {renderErrors: !sensitiveInvocation, version})(args),
      invocation
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
        process.exitCode = exitCodeFor(error);
        if (
          sensitiveInvocation &&
          CliError.isCliError(error) &&
          (!(error instanceof CliError.ShowHelp) || error.errors.length !== noErrors)
        ) {
          process.stderr.write(sensitiveUsageError);
        } else if (!(error instanceof CliError.ShowHelp)) {
          process.stderr.write(`Command failed, ${failureMessage(error)}\n`);
        }
      },
      onSuccess() {
        process.exitCode = successExitCode;
      },
    })
  );

BunRuntime.runMain(main);
