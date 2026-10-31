import {expect, test} from 'bun:test';
import {mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import packageReader from './package.ts';

test('package root resolution failures retain local paths only in the CLI message', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flightsim-package-'));
  const sourcePath = path.join(root, 'alias');
  await symlink(path.join(root, 'private-target'), sourcePath);
  try {
    const result = await packageReader.read(sourcePath);
    expect(result).toMatchObject({
      diagnosticMessage: 'ENOENT',
      sourcePath,
      status: 'failure',
    });
    if (result.status === 'failure') {
      expect(result.message).toContain(sourcePath);
    }
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});

test('a missing manifest rejects a direct package read with a safe repair instruction', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'flightsim-package-'));
  await writeFile(path.join(root, 'layout.json'), JSON.stringify({content: []}));
  try {
    const result = await packageReader.read(root);
    expect(result).toMatchObject({
      diagnosticMessage:
        'Missing required metadata in manifest.json; package skipped. Restore the file or repair the package installation and run scan again.',
      status: 'failure',
    });
    if (result.status === 'failure') {
      expect(result.message).toBe(result.diagnosticMessage);
      expect(result.message).not.toContain(root);
    }
  } finally {
    await rm(root, {force: true, recursive: true});
  }
});
