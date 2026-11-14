import assert from 'node:assert/strict';
import targets from './release-targets.json' with {type: 'json'};
export {targets};
export function releaseTarget(
  id = process.env.PACKAGE_TARGET ?? `${process.platform}-${process.arch}`
) {
  assert.ok(Object.hasOwn(targets, id), `Unsupported release target: ${id}`);
  return {id, ...targets[id]};
}
