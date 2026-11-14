import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {_electron as electron} from '@playwright/test';
import {installerIdentity, requireCommit} from './release-evidence.mjs';
import {releaseTarget} from './release-targets.mjs';
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
const target = releaseTarget();
assert.equal(process.arch, target.arch, 'Run the package natively');
assert.equal(process.platform, target.platform, 'Run the package on its target OS');
const installer = installerIdentity(target.id);
const directory = mkdtempSync(join(tmpdir(), 'flightsim-package-'));
try {
  let appDirectory;
  let executablePath;
  let resourcesDirectory;
  if (target.platform === 'linux') {
    assert.equal(
      execFileSync('dpkg-deb', ['-f', `release/${installer.filename}`, 'Architecture'], {
        encoding: 'utf8',
      }).trim(),
      'arm64'
    );
    execFileSync('dpkg-deb', ['-x', `release/${installer.filename}`, directory]);
    appDirectory = join(directory, 'opt/Flightsim Things');
    resourcesDirectory = join(appDirectory, 'resources');
    executablePath = resolve(appDirectory, 'flightsim-things');
  } else if (target.platform === 'darwin') {
    const mount = join(directory, 'mounted');
    mkdirSync(mount);
    execFileSync('hdiutil', [
      'attach',
      resolve('release', installer.filename),
      '-readonly',
      '-nobrowse',
      '-mountpoint',
      mount,
    ]);
    try {
      appDirectory = join(directory, 'Flightsim Things.app');
      cpSync(join(mount, 'Flightsim Things.app'), appDirectory, {
        recursive: true,
        verbatimSymlinks: true,
      });
    } finally {
      execFileSync('hdiutil', ['detach', mount]);
    }
    resourcesDirectory = join(appDirectory, 'Contents/Resources');
    executablePath = join(appDirectory, 'Contents/MacOS/Flightsim Things');
    assert.equal(
      execFileSync('lipo', ['-archs', executablePath], {encoding: 'utf8'}).trim(),
      target.arch
    );
  } else {
    appDirectory = join(directory, 'installed app');
    execFileSync(
      resolve('release', installer.filename),
      ['/S', '/currentuser', `/D=${appDirectory}`],
      {
        timeout: 120000,
        windowsVerbatimArguments: true,
      }
    );
    resourcesDirectory = join(appDirectory, 'resources');
    executablePath = join(appDirectory, 'Flightsim Things.exe');
    const binary = readFileSync(executablePath);
    assert.equal(
      binary.readUInt16LE(binary.readUInt32LE(0x3c) + 4),
      0x8664,
      'Require an x64 PE executable'
    );
  }

  assert.equal(
    readFileSync(join(resourcesDirectory, 'LICENSE'), 'utf8'),
    readFileSync('LICENSE', 'utf8')
  );
  const app = await electron.launch({
    executablePath,
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
      {
        status: 'passed',
        commit,
        target: target.id,
        runtime: {platform: process.platform, arch: process.arch},
        installer,
      },
      null,
      2
    ) + '\n'
  );
} finally {
  rmSync(directory, {recursive: true, force: true});
}
