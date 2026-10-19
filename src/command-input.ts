import {Console, Effect, Schema, Struct} from 'effect';
import {Command, Prompt} from 'effect/cli';

import configurationStore from '#sentry-config';

import commandConfirmation from './command-confirmation.ts';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type CommandTree = DeepReadonly<Command.Command.Any>;
type Collection = ReturnType<typeof Command.wizard>;
const rootPathLength = 0;
const groupPathLength = 1;
const leafPathLength = 2;
const noArguments = 0;
const {Confirm: confirm, Select: select, String: string} = Prompt;
type Field = 'dsn' | keyof typeof configurationStore.schema.Type.sampleRates;
const labels = {
  dsn: 'Sentry DSN',
  errors: 'Error sample rate from 0 to 1',
  logs: 'Log sample rate from 0 to 1',
  metrics: 'Metric sample rate from 0 to 1',
  traces: 'Trace sample rate from 0 to 1',
};

function validateField(field: Field, input: string): Effect.Effect<string, string> {
  if (field === 'dsn') {
    return Schema.decodeEffect(configurationStore.schema.fields.dsn)(input).pipe(
      Effect.as(input),
      Effect.mapError(
        () => 'Enter an HTTP(S) Sentry DSN with a public key and numeric project ID.'
      )
    );
  }

  return configurationStore.parseSampleRate(input).pipe(
    Effect.as(input),
    Effect.mapError(() => 'Enter a finite sample rate from 0 to 1.')
  );
}

function collectField(field: Field, mode: 'set' | 'update'): Collection {
  return Effect.gen(function* collectSentryField() {
    const message = `${labels[field]} (--${field})`;
    if (mode === 'update') {
      const include = yield* Prompt.run(
        confirm({initial: false, message: `Set ${message}?`})
      );
      if (!include) {
        return [];
      }
    }

    const value = yield* Prompt.run(
      string({message, validate: input => validateField(field, input)})
    );
    return [`--${field}`, value];
  });
}

function collectSentry(path: readonly string[], mode: 'set' | 'update'): Collection {
  return Effect.gen(function* collectSentryConfiguration() {
    const rates = Struct.keys(configurationStore.schema.fields.sampleRates.fields);
    while (true) {
      const args: string[] = [];
      for (const field of ['dsn', ...rates] as const) {
        args.push(...(yield* collectField(field, mode)));
      }

      if (args.length !== noArguments) {
        return [...path, ...args];
      }

      yield* Console.log('Choose at least one option to update.');
    }
  });
}

function collect(command: CommandTree, path: readonly string[]): Collection {
  if (
    path.length === leafPathLength &&
    path.at(rootPathLength) === 'sentry' &&
    (command.name === 'set' || command.name === 'update')
  ) {
    return collectSentry(path, command.name);
  }

  if (
    path.length === rootPathLength ||
    (path.length === groupPathLength && command.name === 'sentry')
  ) {
    return Effect.gen(function* selectConfigurationCommand() {
      const child = yield* Prompt.run(
        select({
          choices: command.subcommands.flatMap(group =>
            group.commands
              .filter(candidate => !candidate.unlisted)
              .map(candidate => ({
                description: candidate.shortDescription ?? candidate.description,
                title: candidate.name,
                value: candidate,
              }))
          ),
          message: 'Command',
        })
      );
      return yield* collect(child, [...path, child.name]);
    });
  }

  return Command.wizard(command, {prefix: path});
}

const commandInput = {collect, confirm: commandConfirmation.confirm};

export default commandInput;
