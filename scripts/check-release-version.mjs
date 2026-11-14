import {checkVersions, validateVersion} from './release-version.mjs';
checkVersions(validateVersion(process.env.VERSION ?? ''));
