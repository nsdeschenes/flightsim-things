import {Effect, Option, Schema} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';
import {
  Record as record,
  Struct as struct,
  StructWithRest as structWithRest,
} from 'effect/Schema';

import configuration from '#configuration';

const minimumSampleRate = 0;
const maximumSampleRate = 1;
const lastPathSegment = -1;
const projectId = /^[0-9]+$/u;
const rawDsn =
  /^https?:\/\/[a-zA-Z0-9_]+@(?:\[[a-fA-F0-9:.%]+\]|[a-zA-Z0-9_.-]+)(?::[0-9]+)?\//u;
const controlOrWhitespace = /[\p{Cc}\s]/u;
const publicKey = /^[a-zA-Z0-9_]+$/u;

function isDsn(input: string): boolean {
  if (
    !URL.canParse(input) ||
    controlOrWhitespace.test(input) ||
    !rawDsn.test(input) ||
    input.includes('\\')
  ) {
    return false;
  }

  const url = new URL(input);
  return (
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    publicKey.test(url.username) &&
    url.password === '' &&
    projectId.test(url.pathname.split('/').at(lastPathSegment) ?? '') &&
    url.search === '' &&
    url.hash === ''
  );
}

const sampleRate = Schema.Finite.check(
  Schema.isBetween({maximum: maximumSampleRate, minimum: minimumSampleRate})
);
const configurationSchema = struct({
  dsn: Schema.String.check(Schema.makeFilter(isDsn)),
  sampleRates: struct({
    errors: sampleRate,
    logs: sampleRate,
    metrics: sampleRate,
    traces: sampleRate,
  }),
});

const additionalProperties = [record(Schema.String, Schema.Json)];
const storedSampleRatesSchema = structWithRest(
  configurationSchema.fields.sampleRates,
  additionalProperties
);
const storedConfigurationSchema = structWithRest(
  struct({...configurationSchema.fields, sampleRates: storedSampleRatesSchema}),
  additionalProperties
);

type SentryConfiguration = typeof configurationSchema.Type;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;

class SentryConfigurationError extends taggedError('SentryConfigurationError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function toError(cause: unknown): SentryConfigurationError {
  if (cause instanceof configuration.Error) {
    return new SentryConfigurationError({cause, message: cause.message});
  }

  if (cause instanceof SentryConfigurationError) {
    return cause;
  }

  return new SentryConfigurationError({
    cause,
    message:
      'Could not access Sentry configuration. Check your configuration directory permissions.',
  });
}

function validateConfiguration(
  input: unknown
): Effect.Effect<SentryConfiguration, SentryConfigurationError> {
  return Schema.decodeUnknownEffect(configurationSchema)(input).pipe(
    Effect.mapError(
      () =>
        new SentryConfigurationError({
          message:
            'Provide an HTTP(S) Sentry DSN with a public key and numeric project ID, and finite sample rates from 0 to 1.',
        })
    )
  );
}

function readConfiguration(): Effect.Effect<
  Option.Option<SentryConfiguration>,
  SentryConfigurationError
> {
  return Effect.gen(function* readSentryConfiguration() {
    const saved = yield* configuration.get('sentry').pipe(Effect.mapError(toError));
    if (!Option.isSome(saved)) {
      return Option.none();
    }

    return yield* validateConfiguration(saved.value).pipe(
      Effect.asSome,
      Effect.mapError(
        () =>
          new SentryConfigurationError({
            message:
              'Sentry configuration has an invalid DSN or sample rates. Run sentry set with all options to replace it.',
          })
      )
    );
  });
}

function writeConfiguration(
  value: SentryConfiguration
): Effect.Effect<void, SentryConfigurationError> {
  return configuration.set('sentry', value).pipe(Effect.mapError(toError));
}

function updateConfiguration(
  change: (
    previous: Readonly<SentryConfiguration>
  ) => Effect.Effect<SentryConfiguration, SentryConfigurationError>
): Effect.Effect<void, SentryConfigurationError> {
  return configuration
    .update('sentry', (saved: DeepReadonly<Option.Option<unknown>>) =>
      Effect.gen(function* updateSentryConfiguration() {
        if (!Option.isSome(saved)) {
          return yield* new SentryConfigurationError({
            message: 'No Sentry configuration is saved. Run sentry set with all options.',
          });
        }

        yield* validateConfiguration(saved.value);
        const previous = yield* Schema.decodeUnknownEffect(storedConfigurationSchema)(
          saved.value
        ).pipe(Effect.mapError(toError));
        const next = yield* change(previous);
        return {
          ...previous,
          ...next,
          sampleRates: {...previous.sampleRates, ...next.sampleRates},
        };
      })
    )
    .pipe(Effect.mapError(toError));
}

const configurationStore = {
  Error: SentryConfigurationError,
  read: readConfiguration,
  schema: configurationSchema,
  update: updateConfiguration,
  validate: validateConfiguration,
  write: writeConfiguration,
};

export default configurationStore;
