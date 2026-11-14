import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {checksums, digest, verifiedInstallers} from './release-evidence.mjs';
const installers = verifiedInstallers(process.env.RELEASE_SHA);
assert.deepEqual(
  readdirSync('release/assets').sort(),
  [...installers.map(({filename}) => filename), 'SHA256SUMS'].sort()
);
for (const {filename, sha256} of installers) {
  assert.equal(digest(`release/assets/${filename}`), sha256);
}
assert.equal(readFileSync('release/assets/SHA256SUMS', 'utf8'), checksums(installers));
