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

const installers = [
  ['linux-arm64', 'linux', 'arm64', 'flightsim-things-0.1.0-linux-arm64.deb'],
  ['darwin-arm64', 'darwin', 'arm64', 'flightsim-things-0.1.0-macos-arm64.dmg'],
  ['win32-x64', 'win32', 'x64', 'flightsim-things-0.1.0-win32-x64.exe'],
];
function packageFixture(cwd) {
  return installers.map(([target, platform, arch, filename]) => {
    const directory = join(cwd, 'release/tested', target);
    mkdirSync(directory, {recursive: true});
    const bytes = `tested ${target} installer`;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const report = {
      status: 'passed',
      commit,
      target,
      runtime: {platform, arch},
      installer: {filename, sha256},
    };
    const proof = join(directory, 'package-proof.json');
    writeFileSync(join(directory, filename), bytes);
    writeFileSync(proof, JSON.stringify(report));
    return {directory, proof, report, bytes};
  });
}
test('staging and publication preserve the complete native tested installer set', () =>
  fixture(cwd => {
    const packages = packageFixture(cwd);
    command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit});
    command(cwd, 'verify-release-assets.mjs', {RELEASE_SHA: commit});
    for (const {report, bytes} of packages) {
      assert.equal(
        readFileSync(join(cwd, 'release/assets', report.installer.filename), 'utf8'),
        bytes
      );
    }
    assert.equal(
      readFileSync(join(cwd, 'release/assets/SHA256SUMS'), 'utf8'),
      packages
        .map(({report}) => `${report.installer.sha256}  ${report.installer.filename}\n`)
        .join('')
    );
    for (const {proof, report} of packages) {
      for (const patch of [
        {status: 'failed'},
        {commit: 'b'.repeat(40)},
        {target: 'wrong-target'},
        {runtime: {...report.runtime, arch: 'wrong'}},
        {runtime: {...report.runtime, platform: 'wrong'}},
        {installer: {...report.installer, sha256: 'bad'}},
        {installer: {...report.installer, filename: 'foreign'}},
      ]) {
        writeFileSync(proof, JSON.stringify({...report, ...patch}));
        command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit}, false);
        command(cwd, 'verify-release-assets.mjs', {RELEASE_SHA: commit}, false);
      }
      writeFileSync(proof, JSON.stringify(report));
    }
    command(cwd, 'stage-release.mjs', {GITHUB_SHA: 'abc'}, false);
    const asset = join(cwd, 'release/assets', packages[1].report.installer.filename);
    writeFileSync(asset, 'changed');
    command(cwd, 'verify-release-assets.mjs', {RELEASE_SHA: commit}, false);
    command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit});
    writeFileSync(join(cwd, 'release/assets/SHA256SUMS'), 'forged');
    command(cwd, 'verify-release-assets.mjs', {RELEASE_SHA: commit}, false);
  }));
for (const [target, , , filename] of installers) {
  test(`release rejects missing, duplicate, stale and changed ${target} artifacts`, () =>
    fixture(cwd => {
      const packages = packageFixture(cwd);
      const {directory, proof, report, bytes} = packages.find(
        ({report}) => report.target === target
      );
      const fail = () => command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit}, false);
      rmSync(proof);
      fail();
      writeFileSync(proof, JSON.stringify(report));
      rmSync(join(directory, filename));
      fail();
      writeFileSync(join(directory, filename), 'changed installer');
      fail();
      writeFileSync(join(directory, filename), bytes);
      const duplicate = join(directory, filename.replace('0.1.0', '0.2.0'));
      writeFileSync(duplicate, bytes);
      fail();
      rmSync(duplicate);
      rmSync(join(directory, filename));
      writeFileSync(duplicate, bytes);
      fail();
      rmSync(directory, {recursive: true});
      fail();
    }));
}
test('release rejects an unexpected or duplicated target directory', () =>
  fixture(cwd => {
    packageFixture(cwd);
    mkdirSync(join(cwd, 'release/tested/duplicate-linux-arm64'));
    command(cwd, 'stage-release.mjs', {GITHUB_SHA: commit}, false);
  }));

test('Craft requires and publishes every registered target and its acceptance context', () => {
  const targets = JSON.parse(readFileSync(join(scripts, 'release-targets.json'), 'utf8'));
  assert.deepEqual(Object.keys(targets).sort(), [
    'darwin-arm64',
    'linux-arm64',
    'win32-x64',
  ]);
  const craft = readFileSync(join(scripts, '../.craft.yml'), 'utf8');
  const required = [
    ...craft
      .split('requireNames:')[1]
      .split('targets:')[0]
      .matchAll(/  - \/(.+)\/\n/g),
  ].map(match => new RegExp(match[1]));
  const included = new RegExp(craft.match(/includeNames: \/(.+)\//)[1]);
  const expected = [...installers.map(([, , , filename]) => filename), 'SHA256SUMS'];
  assert.equal(required.length, expected.length);
  for (const name of expected) {
    assert.equal(required.filter(pattern => pattern.test(name)).length, 1, name);
    assert.ok(included.test(name), name);
  }
  for (const name of [
    'package-proof.json',
    'flightsim-things-0.1.0-linux-amd64.deb',
    'flightsim-things-0.1.0-win32-ia32.exe',
    'flightsim-things-0.1.0-macos-x64.dmg',
    'installer.exe.blockmap',
  ]) {
    assert.equal(
      required.some(pattern => pattern.test(name)),
      false,
      name
    );
    assert.equal(included.test(name), false, name);
  }
  for (const [id, target] of Object.entries(targets)) {
    assert.ok(craft.includes(`- ${id} build and acceptance\n`));
    assert.ok(expected.includes(target.artifactName.replace('${version}', '0.1.0')));
  }
});
