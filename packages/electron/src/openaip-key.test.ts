import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Effect} from 'effect';

import {expect, test} from 'vitest';

import {createOpenAipKeyStore} from './openaip-key.js';

const key = 'private-openaip-key';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-key-'));
  const path = join(directory, 'openaip-key.enc');
  const encryptionKey = randomBytes(32);
  const encryption = {
    available: () => true,
    encrypt(value: string) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    },
    decrypt(bytes: Buffer) {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        encryptionKey,
        bytes.subarray(0, 12)
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString('utf8');
    },
  };
  return {directory, path, encryption, store: createOpenAipKeyStore(path, encryption)};
}

test('saves encrypted bytes, reloads across store instances, replaces and removes the shared key', async () => {
  const f = await fixture();
  try {
    expect(await Effect.runPromise(f.store.status())).toEqual({
      saved: false,
      available: true,
    });
    const save = f.store.save(key);
    expect(await readdir(f.directory)).toEqual([]);
    expect(await Effect.runPromise(save)).toEqual({saved: true, available: true});
    expect((await readFile(f.path)).includes(Buffer.from(key))).toBe(false);
    if (process.platform !== 'win32') {
      expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    }
    const reopened = createOpenAipKeyStore(f.path, f.encryption);
    expect(await Effect.runPromise(reopened.load())).toBe(key);
    expect(await Effect.runPromise(reopened.status())).toEqual({
      saved: true,
      available: true,
    });
    await Effect.runPromise(reopened.save('replacement-key'));
    expect(await Effect.runPromise(f.store.load())).toBe('replacement-key');
    expect(await readdir(f.directory)).toEqual(['openaip-key.enc']);
    expect(await Effect.runPromise(reopened.remove())).toEqual({
      saved: false,
      available: true,
    });
    expect(await Effect.runPromise(reopened.remove())).toEqual({
      saved: false,
      available: true,
    });
    await expect(Effect.runPromise(reopened.load())).rejects.toThrow(
      'No OpenAIP key is saved'
    );
  } finally {
    await rm(f.directory, {recursive: true, force: true});
  }
});

test('serializes save, read, replacement, and removal in invocation order', async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([
      Effect.runPromise(f.store.save(key)),
      Effect.runPromise(f.store.load()),
      Effect.runPromise(f.store.save('replacement-key')),
      Effect.runPromise(f.store.load()),
      Effect.runPromise(f.store.remove()),
      Effect.runPromise(f.store.status()),
    ]);
    expect(results).toEqual([
      {saved: true, available: true},
      key,
      {saved: true, available: true},
      'replacement-key',
      {saved: false, available: true},
      {saved: false, available: true},
    ]);
  } finally {
    await rm(f.directory, {recursive: true, force: true});
  }
});

test('unavailable encryption cannot save or read but can remove an existing key', async () => {
  const f = await fixture();
  try {
    await Effect.runPromise(f.store.save(key));
    const unavailable = createOpenAipKeyStore(f.path, {
      ...f.encryption,
      available: () => false,
    });
    expect(await Effect.runPromise(unavailable.status())).toEqual({
      saved: true,
      available: false,
    });
    await expect(Effect.runPromise(unavailable.save('replacement-key'))).rejects.toThrow(
      'Secure key storage is unavailable'
    );
    await expect(Effect.runPromise(unavailable.load())).rejects.toThrow(
      'Secure key storage is unavailable'
    );
    expect(await Effect.runPromise(f.store.load())).toBe(key);
    expect(await Effect.runPromise(unavailable.remove())).toEqual({
      saved: false,
      available: false,
    });
    await expect(Effect.runPromise(unavailable.save(key))).rejects.toThrow(
      'Secure key storage is unavailable'
    );
    expect(await readdir(f.directory)).toEqual([]);
  } finally {
    await rm(f.directory, {recursive: true, force: true});
  }
});

test('failed encryption and invalid keys preserve the old value without leaking errors', async () => {
  const f = await fixture();
  try {
    await Effect.runPromise(f.store.save(key));
    const broken = createOpenAipKeyStore(f.path, {
      ...f.encryption,
      encrypt() {
        throw new Error(key);
      },
    });
    await expect(Effect.runPromise(broken.save('replacement-key'))).rejects.toThrow(
      'Could not save the OpenAIP key. Retry the operation.'
    );
    expect(await Effect.runPromise(f.store.load())).toBe(key);
    await expect(Effect.runPromise(f.store.save(`${key}\nheader`))).rejects.toThrow(
      'Enter a valid OpenAIP API key.'
    );
    expect(await Effect.runPromise(f.store.load())).toBe(key);
    expect(await readdir(f.directory)).toEqual(['openaip-key.enc']);
    await writeFile(f.path, key);
    await expect(Effect.runPromise(f.store.load())).rejects.toThrow(
      'Could not read the saved OpenAIP key. Enter a key or save it again.'
    );
    expect(await Effect.runPromise(f.store.remove())).toEqual({
      saved: false,
      available: true,
    });
  } finally {
    await rm(f.directory, {recursive: true, force: true});
  }
});

test('failed atomic replacement cleans temporary bytes and reports a safe error', async () => {
  const f = await fixture();
  try {
    await mkdir(f.path);
    await expect(Effect.runPromise(f.store.save(key))).rejects.toThrow(
      'Could not save the OpenAIP key. Retry the operation.'
    );
    expect(await readdir(f.directory)).toEqual(['openaip-key.enc']);
    await expect(Effect.runPromise(f.store.remove())).rejects.toThrow(
      'Could not remove the saved OpenAIP key. Retry the operation.'
    );
  } finally {
    await rm(f.directory, {recursive: true, force: true});
  }
});
