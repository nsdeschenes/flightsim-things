import {copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {installerIdentity, verifyEvidence} from './release-evidence.mjs';
const installer = installerIdentity();
verifyEvidence(
  JSON.parse(readFileSync('release/package-proof.json', 'utf8')),
  process.env.GITHUB_SHA,
  installer
);
rmSync('release/assets', {recursive: true, force: true});
mkdirSync('release/assets', {recursive: true});
copyFileSync(`release/${installer.filename}`, `release/assets/${installer.filename}`);
writeFileSync(
  'release/assets/SHA256SUMS',
  `${installer.sha256}  ${installer.filename}\n`
);
