import {Console, Data, Effect, Option, Redacted} from 'effect';
import {Command, Prompt} from 'effect/cli';

import invocationClassifier from '#invocation';

import type ordinary from './commands/ordinary.ts';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type CommandTree = DeepReadonly<Command.Command.Any>;
type RootCommand = DeepReadonly<typeof ordinary.command>;
type PreparedRequest =
  | Readonly<{kind: 'Ordinary'; args: readonly string[]; sanitizeErrors: boolean}>
  | Readonly<{kind: 'Confirmed'; args: Redacted.Redacted<readonly string[]>}>
  | Readonly<{kind: 'Stopped'}>;
type WizardTarget = Readonly<{command: CommandTree; path: readonly string[]}>;
const {TaggedError: taggedError} = Data;
class WizardFailure extends taggedError('WizardFailure')<{
  readonly exitCode: number;
  readonly message: string;
}> {}

const invalidArgumentsExitCode = 252;
const commandFailureExitCode = 1;
const noArguments = 0;
const missingIndex = -1;
const oneMarker = 1;
const wizardMarker = /^--(?:no-)?wizard(?:=|$)/u;
const stopped = {kind: 'Stopped'} as const;
const {Confirm: confirm} = Prompt;
const usageMessage =
  'Wizard accepts a command path only. Enter values at the prompts. Run flightsim-things --help for usage.';
const {catch: catchEffect} = Effect;

function visibleChildren(command: CommandTree): readonly CommandTree[] {
  return command.subcommands.flatMap(group =>
    group.commands.filter(child => !child.unlisted)
  );
}

function resolveTarget(
  root: RootCommand,
  path: readonly string[]
): Option.Option<WizardTarget> {
  let command: CommandTree = root;
  const canonicalPath: string[] = [];
  for (const name of path) {
    const child = visibleChildren(command).find(
      candidate => candidate.name === name || candidate.alias === name
    );
    if (!child) {
      return Option.none();
    }

    command = child;
    canonicalPath.push(child.name);
  }

  return Option.some({command, path: canonicalPath});
}

function commandSummary(root: RootCommand, args: readonly string[]): string {
  let command: CommandTree = root;
  const path: string[] = [root.name];
  for (const argument of args) {
    const child = visibleChildren(command).find(candidate => candidate.name === argument);
    if (!child) {
      break;
    }

    command = child;
    path.push(child.name);
  }

  return path.join(' ');
}

function hasWizardMarker(args: readonly string[]): boolean {
  const delimiter = args.indexOf('--');
  let options = args;
  if (delimiter !== missingIndex) {
    options = args.slice(noArguments, delimiter);
  }

  return options.some(argument => wizardMarker.test(argument));
}

function sanitizeCollectionError(
  error: DeepReadonly<Effect.Error<ReturnType<typeof Command.wizard>> | WizardFailure>
): Effect.Effect<never, WizardFailure> {
  if (error instanceof WizardFailure) {
    return Effect.fail(error);
  }

  return Effect.fail(
    new WizardFailure({
      exitCode: invalidArgumentsExitCode,
      message: 'Could not collect command values. Run flightsim-things --help for usage.',
    })
  );
}

function collect(
  root: RootCommand,
  target: WizardTarget
): Effect.Effect<PreparedRequest, WizardFailure, Command.Environment> {
  return Effect.gen(function* prepareWizard() {
    const generated = yield* Command.wizard(target.command, {prefix: target.path});
    if (
      generated.some(
        argument =>
          argument === '--' ||
          wizardMarker.test(argument) ||
          invocationClassifier.isCliControlArgument(argument)
      )
    ) {
      return yield* new WizardFailure({
        exitCode: invalidArgumentsExitCode,
        message:
          'A value looks like a CLI control flag. Use the CLI directly to pass this value.',
      });
    }

    yield* Console.log(`Command: ${commandSummary(root, generated)} (values omitted)`);
    const confirmed = yield* Prompt.run(
      confirm({initial: false, message: 'Run this command?'})
    );
    if (!confirmed) {
      return stopped;
    }

    return {
      args: Redacted.make<readonly string[]>(generated),
      kind: 'Confirmed',
    } as const;
  }).pipe(
    Effect.catchTag('QuitError', () => Effect.succeed(stopped)),
    catchEffect(sanitizeCollectionError)
  );
}

function prepare(
  args: readonly string[],
  root: RootCommand
): Effect.Effect<PreparedRequest, WizardFailure, Command.Environment> {
  if (!hasWizardMarker(args)) {
    return Effect.succeed({args, kind: 'Ordinary', sanitizeErrors: false});
  }

  if (invocationClassifier.classify(args, visibleChildren(root)).controlInvocation) {
    return Effect.succeed({args, kind: 'Ordinary', sanitizeErrors: true});
  }

  const target = resolveTarget(
    root,
    args.filter(argument => argument !== '--wizard')
  );
  if (
    args.filter(argument => argument === '--wizard').length !== oneMarker ||
    Option.isNone(target)
  ) {
    return Effect.fail(
      new WizardFailure({exitCode: invalidArgumentsExitCode, message: usageMessage})
    );
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return Effect.fail(
      new WizardFailure({
        exitCode: commandFailureExitCode,
        message:
          'Wizard requires a terminal for input and output. Run flightsim-things --help for CLI usage.',
      })
    );
  }

  return collect(root, target.value);
}

const directWizard = {Error: WizardFailure, prepare};

export default directWizard;
