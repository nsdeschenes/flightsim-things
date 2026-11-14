import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {checkVersions} from './release-version.mjs';
export const digest = path =>
  createHash('sha256').update(readFileSync(path)).digest('hex');
export function installerIdentity(arch = 'arm64') {
  const filename = `flightsim-things-${checkVersions()}-linux-${arch === 'x64' ? 'amd64' : arch}.deb`;
  assert.deepEqual(
    readdirSync('release').filter(name => name.endsWith('.deb')),
    [filename],
    'Require exactly one installer for this version and architecture'
  );
  return {filename, sha256: digest(join('release', filename))};
}
export function requireCommit(commit) {
  assert.match(commit ?? '', /^[a-f0-9]{40}$/, 'Require a full commit SHA');
  return commit;
}
export function verifyEvidence(report, commit, installer) {
  assert.equal(report.status, 'passed');
  assert.equal(report.commit, requireCommit(commit));
  assert.equal(report.target, 'linux-arm64');
  assert.deepEqual(
    report.installer,
    installer,
    'Installer bytes must match the tested package'
  );
}
