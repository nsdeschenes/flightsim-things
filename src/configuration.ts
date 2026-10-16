import {Database, SQLiteError} from 'bun:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

import {Effect, Option, Schema} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type ConfigurationValue = DeepReadonly<Schema.Json>;
type ConfigurationDocument = Readonly<Record<string, ConfigurationValue>>;

const configurationDirectory = path.join(os.homedir(), '.flightsim-things');
const configurationFile = path.join(configurationDirectory, 'config.json');
const privateFileMode = 0o600;
const lockRetries = 40;
const retryDelayMilliseconds = 50;
const sqliteBusyErrorNumber = 5;
const renameRetries = 4;
const renameRetryFactor = 2;
const attemptIncrement = 1;

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

function parseDocument(contents: string): ConfigurationDocument {
  let document: unknown;
  try {
    document = JSON.parse(contents);
  } catch (error) {
    throw new ConfigurationError({
      cause: error,
      message: `Invalid JSON in ${configurationFile}. Repair the file before saving configuration; existing settings have been preserved.`,
    });
  }

  const parsed = Schema.decodeUnknownOption(Schema.JsonObject)(document);
  if (Option.isNone(parsed) || Array.isArray(document)) {
    throw new ConfigurationError({
      message: `Configuration in ${configurationFile} must be a JSON object. Repair the file before saving configuration; existing settings have been preserved.`,
    });
  }

  return parsed.value;
}

function readDocument(): Effect.Effect<
  Option.Option<ConfigurationDocument>,
  ConfigurationError
> {
  return Effect.tryPromise({
    catch: toError,
    try: async () => {
      let contents: string;
      try {
        contents = await fs.readFile(configurationFile, 'utf8');
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return Option.none();
        }

        throw error;
      }

      return Option.some(parseDocument(contents));
    },
  });
}

function getValue(document: ConfigurationDocument, key: string): Option.Option<unknown> {
  if (Object.hasOwn(document, key)) {
    return Option.some(document[key]);
  }

  return Option.none();
}

function get(key: string): Effect.Effect<Option.Option<unknown>, ConfigurationError> {
  return Effect.gen(function* getConfigurationValue() {
    const document = yield* readDocument();
    return getValue(
      Option.getOrElse(document, () => ({})),
      key
    );
  });
}

async function replaceConfiguration(temporaryFile: string): Promise<void> {
  for (let attempt = 0; attempt <= renameRetries; attempt += attemptIncrement) {
    try {
      await fs.rename(temporaryFile, configurationFile);
      return;
    } catch (error) {
      if (
        process.platform !== 'win32' ||
        attempt === renameRetries ||
        !(error instanceof Error) ||
        !('code' in error) ||
        !['EPERM', 'EACCES', 'EBUSY'].includes(String(error.code))
      ) {
        throw error;
      }

      await delay(retryDelayMilliseconds * renameRetryFactor ** attempt);
    }
  }
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
        await replaceConfiguration(temporaryFile);
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

async function waitForLock(connection: DeepReadonly<Database>): Promise<void> {
  for (let attempt = 0; ; attempt += attemptIncrement) {
    try {
      connection.run('BEGIN IMMEDIATE');
      return;
    } catch (error) {
      if (
        attempt === lockRetries ||
        !(error instanceof SQLiteError) ||
        error.errno !== sqliteBusyErrorNumber
      ) {
        throw error;
      }

      await delay(retryDelayMilliseconds);
    }
  }
}

async function acquireConfigurationLock(): Promise<Database> {
  await fs.mkdir(configurationDirectory, {recursive: true});
  const lockFile = `${configurationFile}.lock.sqlite`;
  const connection = new Database(lockFile, {create: true, strict: true});
  try {
    await fs.chmod(lockFile, privateFileMode);
    connection.run('PRAGMA busy_timeout = 0');
    await waitForLock(connection);
    return connection;
  } catch (error) {
    connection.close(true);
    throw error;
  }
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
      try: acquireConfigurationLock,
    }),
    () =>
      Effect.gen(function* modifyConfigurationValue() {
        const saved = yield* readDocument();
        const document = Option.getOrElse(saved, () => ({}));
        const next = yield* change(document);
        const value = yield* validateValue(next);
        yield* persist({...document, [key]: value});
      }),
    (connection: DeepReadonly<Database>) =>
      Effect.sync(() => {
        connection.close(true);
      })
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
      const current = getValue(document, key);
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
