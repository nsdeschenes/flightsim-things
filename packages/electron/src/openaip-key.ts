import {randomUUID} from 'node:crypto';
import {access, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

import type {OpenAipKeyStatus} from '@flightsim-things/contract';

import {parseOpenAipKey} from './airport-enrichment.js';

interface KeyEncryption {
  available(): boolean;
  encrypt(key: string): Buffer;
  decrypt(bytes: Buffer): string;
}

function missingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export function createOpenAipKeyStore(path: string, encryption: KeyEncryption) {
  let operation: Promise<unknown> = Promise.resolve();
  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = operation.then(run);
    operation = next.catch(() => undefined);
    return next;
  }

  function requireEncryption() {
    if (!encryption.available()) {
      throw new Error(
        'Secure key storage is unavailable. Enter your OpenAIP key for this session.'
      );
    }
  }

  async function status(): Promise<OpenAipKeyStatus> {
    try {
      await access(path);
      return {saved: true, available: encryption.available()};
    } catch (error) {
      if (missingFile(error)) {
        return {saved: false, available: encryption.available()};
      }
      throw new Error('Could not check the saved OpenAIP key. Retry the operation.');
    }
  }

  return {
    status: () => serialize(status),
    save: (value: unknown) =>
      serialize(async () => {
        const key = parseOpenAipKey(value);
        requireEncryption();
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          const encrypted = encryption.encrypt(key);
          await mkdir(dirname(path), {recursive: true});
          await writeFile(temporary, encrypted, {mode: 0o600, flag: 'wx'});
          await rename(temporary, path);
        } catch {
          throw new Error('Could not save the OpenAIP key. Retry the operation.');
        } finally {
          await rm(temporary, {force: true}).catch(() => undefined);
        }
        return status();
      }),
    load: () =>
      serialize(async () => {
        requireEncryption();
        try {
          return parseOpenAipKey(encryption.decrypt(await readFile(path)));
        } catch (error) {
          if (missingFile(error)) {
            throw new Error(
              'No OpenAIP key is saved. Enter a key before enriching airports.'
            );
          }
          throw new Error(
            'Could not read the saved OpenAIP key. Enter a key or save it again.'
          );
        }
      }),
    remove: () =>
      serialize(async () => {
        try {
          await rm(path, {force: true});
        } catch {
          throw new Error('Could not remove the saved OpenAIP key. Retry the operation.');
        }
        return status();
      }),
  };
}
