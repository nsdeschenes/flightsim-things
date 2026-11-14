import {readdir, readFile, stat} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

import {simulators} from '@flightsim-things/contract';
import type {
  Addon,
  ScanResult,
  ScanWarning,
  SimulatorId,
} from '@flightsim-things/contract';
import type {AddonDatabase} from '@flightsim-things/db';

export function parseSimulator(value: unknown): SimulatorId {
  if (value !== 'msfs2020' && value !== 'msfs2024') {
    throw new Error(`Choose a supported simulator (${simulators.join(', ')}).`);
  }
  return value;
}

export function parseCommunityPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.includes('\0') ||
    !isAbsolute(value)
  ) {
    throw new Error('Enter an absolute Community folder path.');
  }
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export async function scanCommunityDirectory(
  simulator: SimulatorId,
  communityPath: string
) {
  let entries;
  try {
    entries = await readdir(communityPath, {withFileTypes: true});
  } catch {
    throw new Error(
      `Could not read Community folder "${communityPath}". Check the path and folder permissions, then scan again.`
    );
  }
  const addons: Addon[] = [];
  const warnings: ScanWarning[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const folderPath = join(communityPath, entry.name);
    try {
      if (!(await stat(folderPath)).isDirectory()) {
        continue;
      }
      const manifestJson = await readFile(join(folderPath, 'manifest.json'), 'utf8');
      const manifest: unknown = JSON.parse(manifestJson.replace(/^\uFEFF/, ''));
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw new Error('Manifest must be a JSON object.');
      }
      const fields = manifest as Record<string, unknown>;
      const name = optionalText(fields.title);
      if (!name) {
        throw new Error('Manifest must include a nonempty title.');
      }
      addons.push({
        simulator,
        folderName: entry.name,
        folderPath,
        name,
        version: optionalText(fields.package_version),
        creator: optionalText(fields.creator),
        contentType: optionalText(fields.content_type),
        manifestJson,
      });
    } catch (error) {
      warnings.push({
        folderName: entry.name,
        message:
          error instanceof Error ? error.message : 'Could not read package manifest.',
      });
    }
  }
  return {addons, warnings};
}

export function createAddonLibrary(database: AddonDatabase) {
  let operation: Promise<unknown> = Promise.resolve();
  function serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = operation.then(run);
    operation = next.catch(() => undefined);
    return next;
  }
  return {
    getLibrary: () => serialize(() => database.getLibrary()),
    saveCommunityPath: (simulator: SimulatorId, path: string) =>
      serialize(() => database.saveCommunityPath(simulator, path)),
    scan: (simulator: SimulatorId): Promise<ScanResult> =>
      serialize(async () => {
        const {communityPath} = await database.getInventory(simulator);
        if (!communityPath) {
          throw new Error('Save a Community folder path before scanning.');
        }
        const {addons, warnings} = await scanCommunityDirectory(simulator, communityPath);
        const inventory = await database.replaceInventory(
          simulator,
          communityPath,
          addons
        );
        return {inventory, warnings};
      }),
  };
}
