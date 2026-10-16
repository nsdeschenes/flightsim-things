import {BunRuntime, BunServices} from '@effect/platform-bun';
import {Effect} from 'effect';
import {CliConfig, CliError, Command, GlobalFlag} from 'effect/cli';

import {version} from '#package';

import command from './commands/index.ts';
import withSentry from './sentry.ts';

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

const args = process.argv.slice(argvOffset);
const aiInvocation = args.includes('ai');
const sensitiveInvocation = aiInvocation || args.includes('openaip-key');
let sensitiveUsageError =
  'Invalid OpenAIP key command arguments. Run flightsim-things openaip-key --help for usage.\n';
if (aiInvocation) {
  sensitiveUsageError =
    'Invalid AI command arguments. Run flightsim-things ai --help for usage.\n';
}

const main = withSentry(
  () => Command.runWith(command, {renderErrors: !sensitiveInvocation, version})(args),
  args
).pipe(
  Effect.provide([
    BunServices.layer,
    CliConfig.layer({builtIns: [GlobalFlag.Help, GlobalFlag.Version]}),
  ]),
  Effect.match({
    onFailure(error: unknown) {
      process.exitCode = exitCodeFor(error);
      if (error instanceof CliError.ShowHelp) {
        if (sensitiveInvocation && error.errors.length !== noErrors) {
          process.stderr.write(sensitiveUsageError);
        }
      } else {
        process.stderr.write(`Command failed, ${failureMessage(error)}\n`);
      }
    },
    onSuccess() {
      process.exitCode = successExitCode;
    },
  })
);

BunRuntime.runMain(main);
