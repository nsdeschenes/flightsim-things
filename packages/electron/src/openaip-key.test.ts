import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

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
    expect(await f.store.status()).toEqual({saved: false, available: true});
    expect(await f.store.save(key)).toEqual({saved: true, available: true});
    expect((await readFile(f.path)).includes(Buffer.from(key))).toBe(false);
    if (process.platform !== 'win32') {
      expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    }
    const reopened = createOpenAipKeyStore(f.path, f.encryption);
    expect(await reopened.load()).toBe(key);
    expect(await reopened.status()).toEqual({saved: true, available: true});
    await reopened.save('replacement-key');
    expect(await f.store.load()).toBe('replacement-key');
    expect(await readdir(f.directory)).toEqual(['openaip-key.enc']);
    expect(await reopened.remove()).toEqual({saved: false, available: true});
    expect(await reopened.remove()).toEqual({saved: false, available: true});
    await expect(reopened.load()).rejects.toThrow('No OpenAIP key is saved');
  } finally {
    await rm(f.directory, {recursive: true, force: true});
  }
});

test('serializes save, read, replacement, and removal in invocation order', async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([
      f.store.save(key),
      f.store.load(),
      f.store.save('replacement-key'),
      f.store.load(),
      f.store.remove(),
      f.store.status(),
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
    await f.store.save(key);
    const unavailable = createOpenAipKeyStore(f.path, {
      ...f.encryption,
      available: () => false,
    });
    expect(await unavailable.status()).toEqual({saved: true, available: false});
    await expect(unavailable.save('replacement-key')).rejects.toThrow(
      'Secure key storage is unavailable'
    );
    await expect(unavailable.load()).rejects.toThrow('Secure key storage is unavailable');
    expect(await f.store.load()).toBe(key);
    expect(await unavailable.remove()).toEqual({saved: false, available: false});
    await expect(unavailable.save(key)).rejects.toThrow(
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
    await f.store.save(key);
    const broken = createOpenAipKeyStore(f.path, {
      ...f.encryption,
      encrypt() {
        throw new Error(key);
      },
    });
    await expect(broken.save('replacement-key')).rejects.toThrow(
      'Could not save the OpenAIP key. Retry the operation.'
    );
    expect(await f.store.load()).toBe(key);
    await expect(f.store.save(`${key}\nheader`)).rejects.toThrow(
      'Enter a valid OpenAIP API key.'
    );
    expect(await f.store.load()).toBe(key);
    expect(await readdir(f.directory)).toEqual(['openaip-key.enc']);
    await writeFile(f.path, key);
    await expect(f.store.load()).rejects.toThrow(
      'Could not read the saved OpenAIP key. Enter a key or save it again.'
    );
    expect(await f.store.remove()).toEqual({saved: false, available: true});
  } finally {
    await rm(f.directory, {recursive: true, force: true});
  }
});

test('failed atomic replacement cleans temporary bytes and reports a safe error', async () => {
  const f = await fixture();
  try {
    await mkdir(f.path);
    await expect(f.store.save(key)).rejects.toThrow(
      'Could not save the OpenAIP key. Retry the operation.'
    );
    expect(await readdir(f.directory)).toEqual(['openaip-key.enc']);
    await expect(f.store.remove()).rejects.toThrow(
      'Could not remove the saved OpenAIP key. Retry the operation.'
    );
  } finally {
    await rm(f.directory, {recursive: true, force: true});
  }
});
