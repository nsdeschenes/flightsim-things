import {copyFileSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {checksums, verifiedInstallers} from './release-evidence.mjs';
const installers = verifiedInstallers(process.env.GITHUB_SHA);
rmSync('release/assets', {recursive: true, force: true});
mkdirSync('release/assets', {recursive: true});
for (const {directory, filename} of installers) {
  copyFileSync(`${directory}/${filename}`, `release/assets/${filename}`);
}
writeFileSync('release/assets/SHA256SUMS', checksums(installers));
