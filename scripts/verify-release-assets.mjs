import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {digest, installerIdentity, verifyEvidence} from './release-evidence.mjs';

const installer = installerIdentity();
verifyEvidence(
  JSON.parse(readFileSync('release/package-proof.json', 'utf8')),
  process.env.RELEASE_SHA,
  installer
);
assert.deepEqual(
  readdirSync('release/assets').sort(),
  [installer.filename, 'SHA256SUMS'].sort()
);
assert.equal(digest(`release/assets/${installer.filename}`), installer.sha256);
assert.equal(
  readFileSync('release/assets/SHA256SUMS', 'utf8'),
  `${installer.sha256}  ${installer.filename}\n`
);
