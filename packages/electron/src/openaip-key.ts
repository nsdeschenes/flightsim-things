import {randomUUID} from 'node:crypto';
import {access, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

import {Effect, Semaphore} from 'effect';

import type {OpenAipKeyStatus} from '@flightsim-things/contract';

import {parseOpenAipKey} from './airport-enrichment.js';
import {KeyStoreError, validate} from './errors.js';

interface KeyEncryption {
  available(): boolean;
  encrypt(key: string): Buffer;
  decrypt(bytes: Buffer): string;
}

function missingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function createOpenAipKeyStore(path: string, encryption: KeyEncryption) {
  const operations = Semaphore.makeUnsafe(1);
  const serialize = <A, E>(operation: Effect.Effect<A, E>) =>
    operations.withPermit(operation.pipe(Effect.uninterruptible));

  const requireEncryption = Effect.try({
    try: () => {
      if (!encryption.available()) {
        throw new Error(
          'Secure key storage is unavailable. Enter your OpenAIP key for this session.'
        );
      }
    },
    catch: () =>
      new KeyStoreError({
        message:
          'Secure key storage is unavailable. Enter your OpenAIP key for this session.',
      }),
  });

  const status = Effect.gen(function* () {
    const saved = yield* Effect.tryPromise({
      try: () => access(path).then(() => true),
      catch: error => error,
    }).pipe(
      Effect.catch(error =>
        missingFile(error)
          ? Effect.succeed(false)
          : Effect.fail(
              new KeyStoreError({
                message: 'Could not check the saved OpenAIP key. Retry the operation.',
              })
            )
      )
    );
    const available = yield* Effect.try({
      try: () => encryption.available(),
      catch: () =>
        new KeyStoreError({
          message: 'Could not check the saved OpenAIP key. Retry the operation.',
        }),
    });
    return {saved, available} satisfies OpenAipKeyStatus;
  });

  return {
    status: () => serialize(status),
    save: (value: unknown) =>
      serialize(
        Effect.gen(function* () {
          const key = yield* validate(() => parseOpenAipKey(value));
          yield* requireEncryption;
          const temporary = `${path}.${randomUUID()}.tmp`;
          const saveError = () =>
            new KeyStoreError({
              message: 'Could not save the OpenAIP key. Retry the operation.',
            });
          yield* Effect.gen(function* () {
            const encrypted = yield* Effect.try({
              try: () => encryption.encrypt(key),
              catch: saveError,
            });
            yield* Effect.tryPromise({
              try: () => mkdir(dirname(path), {recursive: true}),
              catch: saveError,
            });
            yield* Effect.tryPromise({
              try: () => writeFile(temporary, encrypted, {mode: 0o600, flag: 'wx'}),
              catch: saveError,
            });
            yield* Effect.tryPromise({
              try: () => rename(temporary, path),
              catch: saveError,
            });
          }).pipe(
            Effect.ensuring(
              Effect.tryPromise({
                try: () => rm(temporary, {force: true}),
                catch: saveError,
              }).pipe(Effect.ignore)
            )
          );
          return yield* status;
        })
      ),
    load: () =>
      serialize(
        Effect.gen(function* () {
          yield* requireEncryption;
          const readError = () =>
            new KeyStoreError({
              message:
                'Could not read the saved OpenAIP key. Enter a key or save it again.',
            });
          const bytes = yield* Effect.tryPromise({
            try: () => readFile(path),
            catch: error =>
              missingFile(error)
                ? new KeyStoreError({
                    message:
                      'No OpenAIP key is saved. Enter a key before enriching airports.',
                  })
                : readError(),
          });
          return yield* Effect.try({
            try: () => parseOpenAipKey(encryption.decrypt(bytes)),
            catch: readError,
          });
        })
      ),
    remove: () =>
      serialize(
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => rm(path, {force: true}),
            catch: () =>
              new KeyStoreError({
                message: 'Could not remove the saved OpenAIP key. Retry the operation.',
              }),
          });
          return yield* status;
        })
      ),
  };
}
