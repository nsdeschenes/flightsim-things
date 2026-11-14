import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {_electron as electron} from '@playwright/test';
import {installerIdentity, requireCommit} from './release-evidence.mjs';
rmSync('release/package-proof.json', {force: true});
const commit = requireCommit(
  process.env.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim()
);
assert.equal(
  readFileSync(process.env.BUILD_COMMIT_FILE ?? 'release-build.commit', 'utf8').trim(),
  commit,
  'Package the same-commit shared build'
);
const arch = process.env.PACKAGE_ARCH ?? process.arch;
assert.equal(arch, process.arch, 'Run the package natively');
const installer = installerIdentity(arch);
const directory = mkdtempSync(join(tmpdir(), 'flightsim-package-'));
try {
  assert.equal(
    execFileSync('dpkg-deb', ['-f', `release/${installer.filename}`, 'Architecture'], {
      encoding: 'utf8',
    }).trim(),
    arch === 'x64' ? 'amd64' : 'arm64'
  );
  execFileSync('dpkg-deb', ['-x', `release/${installer.filename}`, directory]);
  const appDirectory = join(directory, 'opt/Flightsim Things');
  assert.equal(
    readFileSync(join(appDirectory, 'resources/LICENSE'), 'utf8'),
    readFileSync('LICENSE', 'utf8')
  );
  const app = await electron.launch({
    executablePath: resolve(appDirectory, 'flightsim-things'),
    args: [
      `--user-data-dir=${join(directory, 'profile')}`,
      ...(process.env.SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    ],
    timeout: 30000,
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole('heading', {name: 'Flightsim Things'}).waitFor();
    await page
      .getByRole('status')
      .filter({hasText: 'Runtime ready. Database connected.'})
      .waitFor();
    assert.deepEqual(
      await page.evaluate(() => ({
        require: typeof Reflect.get(window, 'require'),
        process: typeof Reflect.get(window, 'process'),
      })),
      {require: 'undefined', process: 'undefined'}
    );
  } finally {
    await app.close();
  }
  writeFileSync(
    'release/package-proof.json',
    JSON.stringify(
      {status: 'passed', commit, target: `linux-${arch}`, installer},
      null,
      2
    ) + '\n'
  );
} finally {
  rmSync(directory, {recursive: true, force: true});
}
