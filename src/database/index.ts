import {Database, SQLiteError} from 'bun:sqlite';
import {chmod, mkdir} from 'node:fs/promises';

import {sql} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/bun-sqlite';
import {migrate} from 'drizzle-orm/bun-sqlite/migrator';
import {readMigrationFiles} from 'drizzle-orm/migrator';
import {Data, Effect, Schedule} from 'effect';

import location from './location.ts';
import schema from './schema.ts';

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;

type AddonDatabase = ReturnType<typeof drizzle<typeof schema.relations>>;

type Methods<Value> = {
  readonly [
    Key in keyof Value as Value[Key] extends (...args: readonly never[]) => unknown
      ? Key
      : never
  ]: Value[Key];
};

type QueryDatabase = Methods<AddonDatabase> & {
  readonly query: {
    readonly [Key in keyof AddonDatabase['query']]: Methods<AddonDatabase['query'][Key]>;
  };
};

const {databaseFile, directory, lockFile, migrationsFolder} = location;
const privateDirectoryMode = 0o700;
const privateFileMode = 0o600;
const busyTimeoutMilliseconds = 5000;
const lockBusyTimeoutMilliseconds = 0;
const sqliteBusyErrorNumber = 5;
const lockRetries = 100;
const lockRetryDelayMilliseconds = 50;

const {TaggedError: taggedError} = Data;

class DatabaseError extends taggedError('DatabaseError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function toError(cause: unknown): DatabaseError {
  if (cause instanceof DatabaseError) {
    return cause;
  }

  let detail = String(cause);
  if (cause instanceof Error) {
    detail = cause.message;
  }

  return new DatabaseError({
    cause,
    message: `Could not access addon database at ${databaseFile}. ${detail}`,
  });
}

function withDatabaseLock<Value>(run: () => Value): Effect.Effect<Value, DatabaseError> {
  return Effect.scoped(
    Effect.gen(function* useLockedDatabase() {
      const coordination = yield* Effect.acquireRelease(
        Effect.try({
          catch: toError,
          try: () => new Database(lockFile, {create: true, strict: true}),
        }),
        (connection: DeepReadonly<Database>) =>
          Effect.sync(() => {
            connection.close(true);
          })
      );
      yield* Effect.tryPromise({
        catch: toError,
        try: async () => {
          await chmod(lockFile, privateFileMode);
        },
      });
      yield* Effect.try({
        catch: toError,
        try: () => {
          coordination.run(`PRAGMA busy_timeout = ${lockBusyTimeoutMilliseconds}`);
        },
      });
      yield* Effect.try({
        catch: toError,
        try: () => {
          coordination.run('BEGIN IMMEDIATE');
        },
      }).pipe(
        Effect.retry({
          schedule: Schedule.spaced(lockRetryDelayMilliseconds),
          times: lockRetries,
          while: (error: DeepReadonly<DatabaseError>) =>
            error.cause instanceof SQLiteError &&
            error.cause.errno === sqliteBusyErrorNumber,
        })
      );
      return yield* Effect.try({
        catch: toError,
        try: run,
      });
    })
  );
}

function verifyMigrationHistory(db: QueryDatabase): void {
  const historyExists = db.all(
    sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`
  ).length;
  if (historyExists) {
    const knownNames = readMigrationFiles({migrationsFolder}).map(
      (migration: Readonly<{name: string}>) => migration.name
    );
    const applied = db.all<{name: string}>(sql`SELECT name FROM __drizzle_migrations`);
    if (
      applied.some(
        (migration: Readonly<{name: string}>) => !knownNames.includes(migration.name)
      )
    ) {
      throw new DatabaseError({
        message: 'This addon database requires a newer application version.',
      });
    }
  }
}

type Synchronous<Value> = Value extends
  | PromiseLike<unknown>
  | {readonly [Effect.TypeId]: unknown}
  ? never
  : Value;

function synchronousResult<Value>(value: Value): Value {
  if (
    Effect.isEffect(value) ||
    (typeof value === 'object' && value !== null && 'then' in value)
  ) {
    throw new DatabaseError({
      message: 'Database callbacks must return synchronous, materialized data.',
    });
  }

  return value;
}

/** Run synchronous Drizzle queries; return materialized data before the connection closes. */
function use<Value>(
  query: (db: QueryDatabase) => Synchronous<Value>
): Effect.Effect<Value, DatabaseError> {
  return Effect.scoped(
    Effect.gen(function* useDatabase() {
      yield* Effect.tryPromise({
        catch: toError,
        try: async () => {
          await mkdir(directory, {mode: privateDirectoryMode, recursive: true});
        },
      });
      const client = yield* Effect.acquireRelease(
        Effect.try({
          catch: toError,
          try: () => new Database(databaseFile, {create: true, strict: true}),
        }),
        (connection: DeepReadonly<Database>) =>
          Effect.sync(() => {
            connection.close();
          })
      );
      yield* Effect.tryPromise({
        catch: toError,
        try: async () => {
          await chmod(databaseFile, privateFileMode);
        },
      });
      const db = drizzle({client, relations: schema.relations});
      yield* Effect.try({
        catch: toError,
        try: () => {
          client.run(`PRAGMA busy_timeout = ${busyTimeoutMilliseconds}`);
          client.run('PRAGMA foreign_keys = ON');
        },
      });
      return yield* withDatabaseLock(() => {
        verifyMigrationHistory(db);
        migrate(db, {migrationsFolder});
        db.run(sql`PRAGMA journal_mode = WAL`);
        return synchronousResult(query(db));
      });
    })
  );
}

const database = {Error: DatabaseError, use};

export default database;
