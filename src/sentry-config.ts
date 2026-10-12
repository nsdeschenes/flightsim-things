import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {Effect, Option, Schema} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';
import {Struct as struct} from 'effect/Schema';

const minimumSampleRate = 0;
const maximumSampleRate = 1;
const privateFileMode = 0o600;
const configurationDirectory = path.join(os.homedir(), '.flightsim-things');
const configurationFile = path.join(configurationDirectory, 'sentry.json');
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

type SentryConfiguration = typeof configurationSchema.Type;

class SentryConfigurationError extends taggedError('SentryConfigurationError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function toError(cause: unknown): SentryConfigurationError {
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
    const contents = yield* Effect.tryPromise({
      catch: toError,
      try: async () => {
        try {
          return Option.some(await fs.readFile(configurationFile, 'utf8'));
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
            return Option.none();
          }
          throw error;
        }
      },
    });
    if (Option.isNone(contents)) {
      return Option.none();
    }
    const input = yield* Effect.try({
      catch: () =>
        new SentryConfigurationError({
          message:
            'Sentry configuration contains malformed JSON. Run sentry set with all options to replace it.',
        }),
      try: (): unknown => JSON.parse(contents.value),
    });
    return yield* validateConfiguration(input).pipe(
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
  configuration: SentryConfiguration
): Effect.Effect<void, SentryConfigurationError> {
  return Effect.tryPromise({
    catch: toError,
    try: async () => {
      await fs.mkdir(configurationDirectory, {recursive: true});
      const temporaryFile = path.join(
        configurationDirectory,
        `sentry.${crypto.randomUUID()}.tmp`
      );
      const file = await fs.open(temporaryFile, 'wx', privateFileMode);
      try {
        await file.writeFile(`${JSON.stringify(configuration)}\n`, 'utf8');
        await file.close();
        await fs.rename(temporaryFile, configurationFile);
      } finally {
        await file.close().catch(() => false);
        await fs.rm(temporaryFile, {force: true});
      }
    },
  }).pipe(Effect.uninterruptible);
}

const configurationStore = {
  Error: SentryConfigurationError,
  read: readConfiguration,
  schema: configurationSchema,
  validate: validateConfiguration,
  write: writeConfiguration,
};

export default configurationStore;
