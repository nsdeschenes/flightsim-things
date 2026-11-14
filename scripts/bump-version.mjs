import {writeFileSync} from 'node:fs';
import {manifests, validateVersion} from './release-version.mjs';
const version = validateVersion(process.env.CRAFT_NEW_VERSION ?? '');
for (const {path, data} of manifests()) {
  writeFileSync(path, JSON.stringify({...data, version}, null, 2) + '\n');
}
