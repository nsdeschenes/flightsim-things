import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {rmSync} from 'node:fs';
const arch = process.env.PACKAGE_ARCH ?? process.arch;
assert.ok(['arm64', 'x64'].includes(arch), 'Package Linux arm64 or x64');
assert.equal(process.platform, 'linux');
rmSync('release', {recursive: true, force: true});
execFileSync(
  'pnpm',
  [
    '--filter',
    '@flightsim-things/electron',
    'deploy',
    '--legacy',
    '--prod',
    'release/app',
  ],
  {stdio: 'inherit'}
);
execFileSync(
  'pnpm',
  [
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.yml',
    '--linux',
    'deb',
    `--${arch}`,
    '--publish',
    'never',
  ],
  {stdio: 'inherit'}
);
