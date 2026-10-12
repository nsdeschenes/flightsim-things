import {BunRuntime, BunServices} from '@effect/platform-bun';
import {Console, Effect} from 'effect';
import {CliConfig, CliError, Command, GlobalFlag} from 'effect/cli';

import {version} from '#package';

import communityPathCommand from './commands/community-path.ts';
import sentryCommand from './commands/sentry.ts';
import withSentry from './sentry.ts';

const argvOffset = 2;
const successExitCode = 0;
const commandFailureExitCode = 1;
const unknownCommandExitCode = 251;
const invalidArgumentsExitCode = 252;
const noErrors = 0;

const hello = Command.make('hello', {}, () => Console.log('Hello via Bun!')).pipe(
  Command.withDescription('Print a greeting')
);
const command = Command.make('flightsim-things').pipe(
  Command.withDescription('Flight simulator tools'),
  Command.withSubcommands([communityPathCommand, hello, sentryCommand])
);

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
    return error.stack ?? String(error);
  }
  return String(error);
}

const args = process.argv.slice(argvOffset);
const main = withSentry(() => Command.runWith(command, {version})(args), args).pipe(
  Effect.provide([
    BunServices.layer,
    CliConfig.layer({builtIns: [GlobalFlag.Help, GlobalFlag.Version]}),
  ]),
  Effect.match({
    onFailure(error: unknown) {
      process.exitCode = exitCodeFor(error);
      if (!(error instanceof CliError.ShowHelp)) {
        process.stderr.write(`Command failed, ${failureMessage(error)}\n`);
      }
    },
    onSuccess() {
      process.exitCode = successExitCode;
    },
  })
);

BunRuntime.runMain(main);
