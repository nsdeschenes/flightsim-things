import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {rmSync} from 'node:fs';
import {releaseTarget} from './release-targets.mjs';
const target = releaseTarget(process.argv[2]);
assert.equal(process.platform, target.platform, 'Package on the target platform');
assert.equal(process.arch, target.arch, 'Package on the target architecture');
rmSync('release', {recursive: true, force: true});
execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  [
    '--filter',
    '@flightsim-things/electron',
    'deploy',
    '--legacy',
    '--prod',
    'release/app',
  ],
  {stdio: 'inherit', shell: process.platform === 'win32'}
);
execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  [
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.yml',
    `--${target.builderPlatform}`,
    target.builderTarget,
    `--${target.arch}`,
    '--publish',
    'never',
  ],
  {stdio: 'inherit', shell: process.platform === 'win32'}
);
