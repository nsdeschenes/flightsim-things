import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {test} from 'node:test';

const scripts = resolve('scripts');
const commit = 'a'.repeat(40);
function fixture(run) {
  const cwd = mkdtempSync(join(tmpdir(), 'flightsim-release-test-'));
  try {
    mkdirSync(join(cwd, 'packages/app'), {recursive: true});
    for (const file of ['package.json', 'packages/app/package.json']) {
      writeFileSync(
        join(cwd, file),
        JSON.stringify({
          name: file,
          version: '0.1.0',
          license: 'MIT',
          scripts: {build: 'echo build'},
        })
      );
    }
    run(cwd);
  } finally {
    rmSync(cwd, {recursive: true, force: true});
  }
}
function command(cwd, name, env = {}, success = true) {
  const result = spawnSync(process.execPath, [join(scripts, name)], {
    cwd,
    env: {...process.env, ...env},
    encoding: 'utf8',
  });
  if (success) {
    assert.equal(result.status, 0, result.stderr);
  } else {
    assert.notEqual(result.status, 0);
  }
  return result;
}

test('Craft bump synchronizes every manifest and retains metadata', () =>
  fixture(cwd => {
    command(cwd, 'bump-version.mjs', {CRAFT_NEW_VERSION: '1.2.3'});
    command(cwd, 'check-release-version.mjs', {VERSION: '1.2.3'});
    assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'packages/app/package.json'))), {
      name: 'packages/app/package.json',
      version: '1.2.3',
      license: 'MIT',
      scripts: {build: 'echo build'},
    });
    for (const version of ['', 'v1.2.3', '01.2.3', '1.2.3-beta', '1.2', '1; echo bad']) {
      command(cwd, 'bump-version.mjs', {CRAFT_NEW_VERSION: version}, false);
      assert.equal(JSON.parse(readFileSync(join(cwd, 'package.json'))).version, '1.2.3');
    }
    command(cwd, 'check-release-version.mjs', {VERSION: '1.2.4'}, false);
    writeFileSync(join(cwd, 'packages/app/package.json'), '{"version":"0.1.0"}');
    command(cwd, 'check-release-version.mjs', {VERSION: '1.2.3'}, false);
  }));

test('staging preserves tested bytes and refuses stale, failed or foreign evidence', () =>
  fixture(cwd => {
    mkdirSync(join(cwd, 'release'));
    const filename = 'flightsim-things-0.1.0-linux-arm64.deb';
    writeFileSync(join(cwd, 'release', filename), 'tested installer');
    const sha256 = createHash('sha256').update('tested installer').digest('hex');
    const report = {
      status: 'passed',
      commit,
      target: 'linux-arm64',
      installer: {filename, sha256},
    };
    const save = data =>
      writeFileSync(join(cwd, 'release/package-proof.json'), JSON.stringify(data));
    save(report);
    command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit});
    command(cwd, 'verify-release-assets.mjs', {RELEASE_SHA: commit});
    assert.equal(
      readFileSync(join(cwd, 'release/assets', filename), 'utf8'),
      'tested installer'
    );
    assert.equal(
      readFileSync(join(cwd, 'release/assets/SHA256SUMS'), 'utf8'),
      `${sha256}  ${filename}\n`
    );
    for (const patch of [
      {status: 'failed'},
      {commit: 'b'.repeat(40)},
      {target: 'linux-x64'},
      {installer: {filename, sha256: 'bad'}},
    ]) {
      save({...report, ...patch});
      command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit}, false);
    }
    save(report);
    command(cwd, 'stage-release.mjs', {GITHUB_SHA: 'abc'}, false);
    writeFileSync(join(cwd, 'release/assets', filename), 'tampered asset');
    command(cwd, 'verify-release-assets.mjs', {RELEASE_SHA: commit}, false);
    command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit});
    writeFileSync(join(cwd, 'release/assets/SHA256SUMS'), 'forged');
    command(cwd, 'verify-release-assets.mjs', {RELEASE_SHA: commit}, false);
    writeFileSync(join(cwd, 'release', filename), 'changed bytes');
    command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit}, false);
    writeFileSync(join(cwd, 'release/extra.deb'), 'extra');
    command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit}, false);
  }));
