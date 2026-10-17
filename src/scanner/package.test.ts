import {expect, test} from 'bun:test';
import {mkdtemp, rm, symlink} from 'node:fs/promises';
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
