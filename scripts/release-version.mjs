import assert from 'node:assert/strict';
import {globSync, readFileSync} from 'node:fs';

export function validateVersion(version) {
  assert.match(
    version,
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
    'Use a stable version without v'
  );
  return version;
}
export function manifests() {
  return ['package.json', ...globSync('packages/*/package.json').sort()].map(path => ({
    path,
    data: JSON.parse(readFileSync(path, 'utf8')),
  }));
}
export function checkVersions(expected = manifests()[0].data.version) {
  validateVersion(expected);
  for (const {path, data} of manifests()) {
    assert.equal(data.version, expected, `${path} must use ${expected}`);
  }
  return expected;
}
