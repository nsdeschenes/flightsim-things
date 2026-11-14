import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {checkVersions} from './release-version.mjs';
import {releaseTarget, targets} from './release-targets.mjs';
export const digest = path =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
export function installerIdentity(id, directory = 'release') {
  const target = releaseTarget(id);
  const filename = target.artifactName.replace('${version}', checkVersions());
  assert.deepEqual(
    readdirSync(directory).filter(name => name.endsWith(`.${target.format}`)),
    [filename],
    'Require exactly one installer for this version and target'
  );
  return {filename, sha256: digest(join(directory, filename))};
}
export function requireCommit(commit) {
  assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'Require a full commit SHA');
  return commit;
}
export function verifyEvidence(report, commit, installer, target) {
  releaseTarget(target);
  assert.equal(report.status, 'passed');
  assert.equal(report.commit, requireCommit(commit));
  assert.equal(report.target, target);
  assert.deepEqual(report.runtime, {
    platform: targets[target].platform,
    arch: targets[target].arch,
  });
  assert.deepEqual(
    report.installer,
    installer,
    'Installer bytes must match the tested package'
  );
}
export function verifiedInstallers(commit) {
  assert.deepEqual(
    readdirSync('release/tested').sort(),
    Object.keys(targets).sort(),
    'Require exactly the full target set'
  );
  return Object.keys(targets).map(id => {
    const directory = join('release/tested', id);
    const installer = installerIdentity(id, directory);
    assert.deepEqual(
      readdirSync(directory).sort(),
      [installer.filename, 'package-proof.json'].sort(),
      'Require only the installer and its proof'
    );
    verifyEvidence(
      JSON.parse(readFileSync(join(directory, 'package-proof.json'), 'utf8')),
      commit,
      installer,
      id
    );
    return {...installer, directory};
  });
}
export const checksums = installers =>
  installers.map(({filename, sha256}) => `${sha256}  ${filename}\n`).join('');
