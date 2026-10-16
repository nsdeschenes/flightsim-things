import type {Log, Metric} from '@sentry/effect';
import {
  close,
  effectLayer,
  getClient,
  metrics,
  SentryEffectLogger,
  SentryEffectTracer,
} from '@sentry/effect/server';
import {Cause, Effect, ErrorReporter, Logger, Option} from 'effect';
import {CliError} from 'effect/cli';

import {version} from '#package';
import configurationStore from '#sentry-config';

const fullSampleRate = 1;
const zeroSampleRate = 0;
const commandCount = 1;
const noArguments = 0;
const flushTimeoutMilliseconds = 2000;
const shutdownTimeoutMilliseconds = 2500;

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type Configuration = DeepReadonly<typeof configurationStore.schema.Type>;

function sample<Signal>(signal: Readonly<Signal>, rate: number): Readonly<Signal> | null {
  if (rate === fullSampleRate || (rate > zeroSampleRate && Math.random() < rate)) {
    return signal;
  }

  return Option.getOrNull(Option.none());
}

function makeSdkLayer(configuration: Configuration): ReturnType<typeof effectLayer> {
  return effectLayer({
    beforeSendLog: (log: DeepReadonly<Log>) => {
      if (sample(log, configuration.sampleRates.logs)) {
        return {...log, message: String(log.message)};
      }

      return Option.getOrNull(Option.none());
    },
    beforeSendMetric: (metric: DeepReadonly<Metric>) =>
      sample(metric, configuration.sampleRates.metrics),
    dsn: configuration.dsn,
    release: `flightsim-things@${version}`,
    sampleRate: configuration.sampleRates.errors,
    traceLifecycle: 'static',
    tracesSampleRate: configuration.sampleRates.traces,
  });
}

function flushSentry(): Effect.Effect<void> {
  return Effect.tryPromise({
    catch: () => false,
    try: async () => {
      const flushed = await close(flushTimeoutMilliseconds);
      return flushed;
    },
  }).pipe(
    Effect.timeoutOption(shutdownTimeoutMilliseconds),
    Effect.ignore,
    Effect.asVoid
  );
}

function instrument<Result, Failure, Requirements>(
  command: () => Effect.Effect<Result, Failure, Requirements>,
  configuration: Readonly<Configuration>
): Effect.Effect<Result, Failure, Requirements> {
  const sdkLayer = makeSdkLayer(configuration);
  return Effect.scoped(
    Effect.gen(function* runInstrumentedCommand() {
      yield* Effect.addFinalizer(flushSentry);
      let recordCommand = true;
      return yield* command().pipe(
        Effect.tapCause((cause: DeepReadonly<Cause.Cause<unknown>>) => {
          if (
            Cause.squash(cause) instanceof CliError.ShowHelp ||
            Cause.hasInterruptsOnly(cause)
          ) {
            recordCommand = false;
            const client = getClient();
            if (client) {
              client.getOptions().ignoreSpans = ['CLI command'];
            }

            return Effect.void;
          }

          return ErrorReporter.report(cause);
        }),
        Effect.onExit(() => {
          if (!recordCommand) {
            return Effect.void;
          }

          return Effect.log('CLI command finished').pipe(
            Effect.andThen(
              Effect.sync(() => {
                metrics.count('cli.command.completed', commandCount);
              })
            )
          );
        }),
        Effect.withSpan('CLI command'),
        Effect.withTracer(SentryEffectTracer),
        Effect.provide(Logger.layer([SentryEffectLogger]))
      );
    }).pipe(Effect.provide(sdkLayer))
  );
}

function withSentry<Result, Failure, Requirements>(
  command: () => Effect.Effect<Result, Failure, Requirements>,
  args: readonly string[]
): Effect.Effect<Result, Failure, Requirements> {
  if (
    args.length === noArguments ||
    args.some(argument => ['--help', '-h', '--version'].includes(argument)) ||
    args.some(argument => ['sentry', 'openaip-key', 'ai'].includes(argument))
  ) {
    return command();
  }

  return Effect.gen(function* runWithSentry() {
    const configuration = yield* configurationStore.read().pipe(
      Effect.catch(({message}: Readonly<{message: string}>) =>
        Effect.sync(() => {
          process.stderr.write(`Sentry telemetry skipped. ${message}\n`);
          return Option.none<Configuration>();
        })
      )
    );
    if (Option.isNone(configuration)) {
      return yield* command();
    }

    return yield* instrument(command, configuration.value);
  });
}

export default withSentry;
