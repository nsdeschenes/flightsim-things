import {Console, Effect, Option} from 'effect';
import {Command, Flag} from 'effect/cli';

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

function parseSampleRate(input: string): number {
  if (input.trim() === '') {
    return Number.NaN;
  }

  return Number(input);
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
        errors: parseSampleRate(input.errors),
        logs: parseSampleRate(input.logs),
        metrics: parseSampleRate(input.metrics),
        traces: parseSampleRate(input.traces),
      },
    });
    yield* configurationStore.write(configuration);
    yield* Console.log('Sentry configuration saved.');
  })
).pipe(Command.withDescription('Save or replace the DSN and all four sample rates'));

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
        configurationStore.validate({
          dsn: Option.getOrElse(dsn, () => previous.dsn),
          sampleRates: {
            errors: Option.match(errors, {
              onNone: () => previous.sampleRates.errors,
              onSome: parseSampleRate,
            }),
            logs: Option.match(logs, {
              onNone: () => previous.sampleRates.logs,
              onSome: parseSampleRate,
            }),
            metrics: Option.match(metrics, {
              onNone: () => previous.sampleRates.metrics,
              onSome: parseSampleRate,
            }),
            traces: Option.match(traces, {
              onNone: () => previous.sampleRates.traces,
              onSome: parseSampleRate,
            }),
          },
        })
      );
      return yield* Console.log('Sentry configuration saved.');
    })
).pipe(Command.withDescription('Update selected options in the saved configuration'));

const getCommand = Command.make('get', {}, () =>
  get().pipe(Effect.flatMap(configuration => Console.log(JSON.stringify(configuration))))
).pipe(Command.withDescription('Print the saved DSN and sample rates as JSON'));

const sentryCommand = Command.make('sentry').pipe(
  Command.withDescription('Manage Sentry telemetry configuration'),
  Command.withSubcommands([setCommand, updateCommand, getCommand])
);

export default sentryCommand;
