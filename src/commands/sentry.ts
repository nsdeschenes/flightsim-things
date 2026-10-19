import {Console, Effect, Option} from 'effect';
import {Command, Flag} from 'effect/cli';

import sentry from '#sentry';
import configurationStore from '#sentry-config';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type UpdateOptions = DeepReadonly<{[Key in keyof typeof flags]: Option.Option<string>}>;
function get(): Effect.Effect<
  typeof configurationStore.schema.Type,
  InstanceType<typeof configurationStore.Error>
> {
  return Effect.gen(function* getSentryConfiguration() {
    const configuration = yield* configurationStore.read();
    if (Option.isNone(configuration)) {
      return yield* new configurationStore.Error({
        message: 'No Sentry configuration is saved. Run sentry set with all options.',
      });
    }

    return configuration.value;
  });
}

const flags = {
  dsn: Flag.String('dsn').pipe(Flag.withDescription('Sentry DSN')),
  errors: Flag.String('errors').pipe(
    Flag.withDescription('Error sample rate from 0 to 1')
  ),
  logs: Flag.String('logs').pipe(Flag.withDescription('Log sample rate from 0 to 1')),
  metrics: Flag.String('metrics').pipe(
    Flag.withDescription('Metric sample rate from 0 to 1')
  ),
  traces: Flag.String('traces').pipe(
    Flag.withDescription('Trace sample rate from 0 to 1')
  ),
};

const setCommand = Command.make('set', flags, input =>
  Effect.gen(function* setSentryConfiguration() {
    const configuration = yield* configurationStore.validate({
      dsn: input.dsn,
      sampleRates: {
        errors: yield* configurationStore.parseSampleRate(input.errors),
        logs: yield* configurationStore.parseSampleRate(input.logs),
        metrics: yield* configurationStore.parseSampleRate(input.metrics),
        traces: yield* configurationStore.parseSampleRate(input.traces),
      },
    });
    yield* configurationStore.write(configuration);
    yield* sentry.refresh;
    yield* Console.log('Sentry configuration saved.');
  })
).pipe(
  Command.withDescription('Save or replace the DSN and all four sample rates'),
  Command.withExamples([
    {
      command:
        'flightsim-things sentry set --dsn https://YOUR_PUBLIC_KEY@example.invalid/1 --errors 0 --logs 0 --metrics 0 --traces 0',
      description:
        'Replace the fake DSN with yours and raise sample rates above zero to enable telemetry. Set requires all four rates.',
    },
  ])
);

const updateCommand = Command.make(
  'update',
  {
    dsn: flags.dsn.pipe(Flag.optional),
    errors: flags.errors.pipe(Flag.optional),
    logs: flags.logs.pipe(Flag.optional),
    metrics: flags.metrics.pipe(Flag.optional),
    traces: flags.traces.pipe(Flag.optional),
  },
  ({dsn, errors, logs, metrics, traces}: UpdateOptions) =>
    Effect.gen(function* updateSentryConfiguration() {
      if (
        Option.isNone(dsn) &&
        Option.isNone(errors) &&
        Option.isNone(logs) &&
        Option.isNone(metrics) &&
        Option.isNone(traces)
      ) {
        return yield* new configurationStore.Error({
          message: 'Provide at least one option to update.',
        });
      }

      yield* configurationStore.update(previous =>
        Effect.gen(function* mergeSentryConfiguration() {
          return yield* configurationStore.validate({
            dsn: Option.getOrElse(dsn, () => previous.dsn),
            sampleRates: {
              errors: yield* Option.match(errors, {
                onNone: () => Effect.succeed(previous.sampleRates.errors),
                onSome: configurationStore.parseSampleRate,
              }),
              logs: yield* Option.match(logs, {
                onNone: () => Effect.succeed(previous.sampleRates.logs),
                onSome: configurationStore.parseSampleRate,
              }),
              metrics: yield* Option.match(metrics, {
                onNone: () => Effect.succeed(previous.sampleRates.metrics),
                onSome: configurationStore.parseSampleRate,
              }),
              traces: yield* Option.match(traces, {
                onNone: () => Effect.succeed(previous.sampleRates.traces),
                onSome: configurationStore.parseSampleRate,
              }),
            },
          });
        })
      );
      yield* sentry.refresh;
      return yield* Console.log('Sentry configuration saved.');
    })
).pipe(
  Command.withDescription('Update selected options in the saved configuration'),
  Command.withExamples([
    {
      command: 'flightsim-things sentry update --traces 0',
      description: 'Update one rate after saving a complete Sentry configuration.',
    },
  ])
);

const getCommand = Command.make('get', {}, () =>
  get().pipe(Effect.flatMap(configuration => Console.log(JSON.stringify(configuration))))
).pipe(Command.withDescription('Print the saved DSN and sample rates as JSON'));

const sentryCommand = Command.make('sentry').pipe(
  Command.withDescription('Manage Sentry telemetry configuration'),
  Command.withExamples([
    {
      command:
        'flightsim-things sentry set --dsn https://YOUR_PUBLIC_KEY@example.invalid/1 --errors 0 --logs 0 --metrics 0 --traces 0',
      description:
        'Replace the fake DSN with yours and raise sample rates above zero to enable telemetry. Set requires all four rates.',
    },
    {
      command: 'flightsim-things sentry update --traces 0',
      description: 'Update one rate after saving a complete Sentry configuration.',
    },
    {
      command: 'flightsim-things sentry get',
      description: 'Show the saved DSN and sample rates.',
    },
  ]),
  Command.withSubcommands([setCommand, updateCommand, getCommand])
);

export default sentryCommand;
