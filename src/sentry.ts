import type {EffectServerLayerOptions, Event, Log, Metric} from '@sentry/effect';
import {
  close,
  captureException,
  effectLayer,
  flush,
  init,
  metrics,
  SentryEffectLogger,
  SentryEffectTracer,
  vercelAIIntegration,
} from '@sentry/effect/server';
import {Cause, Effect, ErrorReporter, Exit, Logger, Option} from 'effect';
import {CliError} from 'effect/cli';
import {Service as service} from 'effect/Context';
import {catch as catchEffect} from 'effect/Effect';

import {version} from '#package';
import configurationStore from '#sentry-config';

import type invocationClassifier from './invocation.ts';

const fullSampleRate = 1;
const zeroSampleRate = 0;
const commandCount = 1;
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

function sdkOptions(configuration: Configuration): EffectServerLayerOptions {
  return {
    beforeSendLog: (log: DeepReadonly<Log>) => {
      if (sample(log, configuration.sampleRates.logs)) {
        return {...log, message: String(log.message)};
      }

      return Option.getOrNull(Option.none());
    },
    beforeSendMetric: (metric: DeepReadonly<Metric>) =>
      sample(metric, configuration.sampleRates.metrics),
    dsn: configuration.dsn,
    integrations: [
      vercelAIIntegration({recordInputs: true, recordOutputs: true}),
      {
        name: 'CliControlEvents',
        processEvent: <EventValue extends DeepReadonly<Event>>(event: EventValue) => {
          const trace = event.contexts && event.contexts.trace;
          if (trace && trace.data && trace.data['cli.command.record'] === false) {
            return Option.getOrNull(Option.none());
          }

          return event;
        },
      },
    ],
    release: `flightsim-things@${version}`,
    sampleRate: configuration.sampleRates.errors,
    traceLifecycle: 'static',
    tracesSampleRate: configuration.sampleRates.traces,
  };
}

class SentryRuntime extends service<
  SentryRuntime,
  {readonly refresh: Effect.Effect<void>}
>()('SentryRuntime') {}

function finishSentry(operation: typeof close): Effect.Effect<void> {
  return Effect.tryPromise({
    catch: () => false,
    try: async () => {
      await operation(flushTimeoutMilliseconds);
    },
  }).pipe(
    Effect.timeoutOption(shutdownTimeoutMilliseconds),
    Effect.ignore,
    Effect.asVoid
  );
}

function readConfiguration(): Effect.Effect<Option.Option<Configuration>> {
  return configurationStore.read().pipe(
    catchEffect(({message}: Readonly<{message: string}>) =>
      Effect.sync(() => {
        process.stderr.write(`Sentry telemetry skipped. ${message}\n`);
        return Option.none<Configuration>();
      })
    )
  );
}

const refreshSentry = Effect.serviceOption(SentryRuntime).pipe(
  Effect.flatMap((runtime: DeepReadonly<Option.Option<SentryRuntime['Service']>>) => {
    if (Option.isSome(runtime)) {
      return runtime.value.refresh;
    }

    return Effect.void;
  })
);

function reportTuiFailure(
  cause: DeepReadonly<Cause.Cause<unknown>>
): Effect.Effect<void> {
  if (
    Cause.hasInterruptsOnly(cause) ||
    Cause.squash(cause) instanceof CliError.ShowHelp
  ) {
    return Effect.void;
  }

  return Effect.sync(() => {
    captureException(new Error('Interactive session failed.'));
  });
}

function recordCommand(
  exit: DeepReadonly<Exit.Exit<unknown, unknown>>
): Effect.Effect<void> {
  return Effect.gen(function* recordCommandOutcome() {
    if (
      Exit.isFailure(exit) &&
      (Cause.squash(exit.cause) instanceof CliError.ShowHelp ||
        Cause.hasInterruptsOnly(exit.cause))
    ) {
      yield* Effect.annotateCurrentSpan('cli.command.record', false);
      return;
    }

    if (Exit.isFailure(exit)) {
      yield* ErrorReporter.report(exit.cause);
    }

    yield* Effect.log('CLI command finished');
    yield* Effect.sync(() => {
      metrics.count('cli.command.completed', commandCount);
    });
  });
}

function instrumentCommand<Result, Failure, Requirements>(
  command: () => Effect.Effect<Result, Failure, Requirements>,
  invocation: DeepReadonly<ReturnType<typeof invocationClassifier.classify>>
): Effect.Effect<Result, Failure, Requirements> {
  if (invocation.controlInvocation) {
    return command();
  }

  if (Option.contains(invocation.command, 'tui')) {
    return command().pipe(Effect.tapCause(reportTuiFailure));
  }

  if (
    Option.isSome(invocation.sensitiveCommand) ||
    Option.contains(invocation.command, 'sentry')
  ) {
    return command();
  }

  return Effect.onExit(command(), recordCommand).pipe(
    Effect.withSpan('CLI command'),
    Effect.withTracer(SentryEffectTracer),
    Effect.provide(Logger.layer([SentryEffectLogger])),
    Effect.ensuring(finishSentry(flush))
  );
}

function withSentry<Result, Failure, Requirements>(
  command: () => Effect.Effect<Result, Failure, Requirements>
): Effect.Effect<Result, Failure, Requirements> {
  return Effect.gen(function* runWithSentry() {
    const initial = yield* readConfiguration();
    const sdkLayer = effectLayer(
      Option.match(initial, {
        onNone: () => ({enabled: false}),
        onSome: sdkOptions,
      })
    );
    return yield* Effect.scoped(
      Effect.gen(function* ownSentry() {
        let active = initial;
        const refresh = Effect.gen(function* refreshConfiguration() {
          const configuration = yield* readConfiguration();
          if (JSON.stringify(configuration) === JSON.stringify(active)) {
            return;
          }

          yield* finishSentry(close);
          active = configuration;
          if (Option.isSome(configuration)) {
            yield* Effect.sync(() => {
              init(sdkOptions(configuration.value));
            });
          }
        });
        yield* Effect.addFinalizer(() => finishSentry(close));
        return yield* command().pipe(Effect.provideService(SentryRuntime, {refresh}));
      })
    ).pipe(Effect.provide(sdkLayer));
  });
}

const sentry = {instrument: instrumentCommand, refresh: refreshSentry, run: withSentry};

export default sentry;
