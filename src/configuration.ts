import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {Effect, Option, Schema} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';
import {lock} from 'proper-lockfile';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type ConfigurationValue = DeepReadonly<Schema.Json>;
type ConfigurationDocument = Readonly<Record<string, ConfigurationValue>>;
type ReleaseLock = () => Promise<void>;

const configurationDirectory = path.join(os.homedir(), '.flightsim-things');
const configurationFile = path.join(configurationDirectory, 'config.json');
const privateFileMode = 0o600;
const lockRetries = 40;
const retryDelayMilliseconds = 50;
const retryFactor = 1;
const legacyFiles: Readonly<Record<string, string>> = {sentry: 'sentry.json'};

class ConfigurationError extends taggedError('ConfigurationError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function toError(cause: unknown): ConfigurationError {
  if (cause instanceof ConfigurationError) {
    return cause;
  }
  let detail = String(cause);
  if (cause instanceof Error) {
    detail = cause.message;
  }
  return new ConfigurationError({
    cause,
    message: `Could not access CLI configuration. Check your configuration directory permissions. ${detail}`,
  });
}

function parseDocument(contents: string, file: string): ConfigurationDocument {
  let document: unknown;
  try {
    document = JSON.parse(contents);
  } catch (error) {
    throw new ConfigurationError({
      cause: error,
      message: `Invalid JSON in ${file}. Repair the file before saving configuration; existing settings have been preserved.`,
    });
  }
  const parsed = Schema.decodeUnknownOption(Schema.JsonObject)(document);
  if (Option.isNone(parsed) || Array.isArray(document)) {
    throw new ConfigurationError({
      message: `Configuration in ${file} must be a JSON object. Repair the file before saving configuration; existing settings have been preserved.`,
    });
  }
  return parsed.value;
}

function readDocument(
  file: string
): Effect.Effect<Option.Option<ConfigurationDocument>, ConfigurationError> {
  return Effect.tryPromise({
    catch: toError,
    try: async () => {
      let contents: string;
      try {
        contents = await fs.readFile(file, 'utf8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return Option.none();
        }
        throw error;
      }
      return Option.some(parseDocument(contents, file));
    },
  });
}

function getValue(
  document: ConfigurationDocument,
  key: string
): Effect.Effect<Option.Option<unknown>, ConfigurationError> {
  if (Object.hasOwn(document, key)) {
    return Effect.succeedSome(document[key]);
  }
  if (!Object.hasOwn(legacyFiles, key)) {
    return Effect.succeedNone;
  }
  const legacyFile = Option.fromNullishOr(legacyFiles[key]);
  if (Option.isNone(legacyFile)) {
    return Effect.succeedNone;
  }
  return readDocument(path.join(configurationDirectory, legacyFile.value));
}

function get(key: string): Effect.Effect<Option.Option<unknown>, ConfigurationError> {
  return Effect.gen(function* getConfigurationValue() {
    const document = yield* readDocument(configurationFile);
    return yield* getValue(
      Option.getOrElse(document, () => ({})),
      key
    );
  });
}

function persist(
  document: ConfigurationDocument
): Effect.Effect<void, ConfigurationError> {
  return Effect.tryPromise({
    catch: toError,
    try: async () => {
      const contents = `${JSON.stringify(document)}\n`;
      const temporaryFile = path.join(
        configurationDirectory,
        `config.${crypto.randomUUID()}.tmp`
      );
      const file = await fs.open(temporaryFile, 'wx', privateFileMode);
      try {
        await file.writeFile(contents, 'utf8');
        await file.close();
        await fs.rename(temporaryFile, configurationFile);
      } finally {
        await file.close().catch(() => false);
        await fs.rm(temporaryFile, {force: true});
      }
    },
  });
}

function validateValue(
  value: ConfigurationValue
): Effect.Effect<ConfigurationValue, ConfigurationError> {
  return Schema.decodeEffect(Schema.Json)(value).pipe(
    Effect.mapError(
      () =>
        new ConfigurationError({
          message:
            'Configuration values must be valid JSON. Existing settings have been preserved.',
        })
    ),
    Effect.flatMap((decoded: ConfigurationValue) =>
      Effect.try({catch: toError, try: () => structuredClone(decoded)})
    )
  );
}

function modify<Failure, Requirements>(
  key: string,
  change: (
    document: ConfigurationDocument
  ) => Effect.Effect<ConfigurationValue, Failure, Requirements>
): Effect.Effect<void, ConfigurationError | Failure, Requirements> {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      catch: toError,
      try: async () => {
        await fs.mkdir(configurationDirectory, {recursive: true});
        return lock(configurationFile, {
          realpath: false,
          retries: {
            factor: retryFactor,
            maxTimeout: retryDelayMilliseconds,
            minTimeout: retryDelayMilliseconds,
            retries: lockRetries,
          },
        });
      },
    }),
    () =>
      Effect.gen(function* modifyConfigurationValue() {
        const saved = yield* readDocument(configurationFile);
        const document = Option.getOrElse(saved, () => ({}));
        const next = yield* change(document);
        const value = yield* validateValue(next);
        yield* persist({...document, [key]: value});
      }),
    (release: ReleaseLock) =>
      Effect.tryPromise({
        catch: toError,
        try: async () => {
          await release();
        },
      }).pipe(Effect.orDie)
  ).pipe(Effect.uninterruptible);
}

function set(
  key: string,
  value: ConfigurationValue
): Effect.Effect<void, ConfigurationError> {
  return modify(key, () => Effect.succeed(value));
}

function update<Failure, Requirements>(
  key: string,
  change: (
    current: DeepReadonly<Option.Option<unknown>>
  ) => ConfigurationValue | Effect.Effect<ConfigurationValue, Failure, Requirements>
): Effect.Effect<void, ConfigurationError | Failure, Requirements> {
  return modify(key, document =>
    Effect.gen(function* updateConfigurationValue() {
      const current = yield* getValue(document, key);
      const next = change(current);
      if (Effect.isEffect(next)) {
        return yield* next;
      }
      return next;
    })
  );
}

const configuration = {Error: ConfigurationError, get, set, update};

export default configuration;
