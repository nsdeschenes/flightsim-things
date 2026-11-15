import {readdir, readFile, stat} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

import {Effect, Semaphore} from 'effect';

import {simulators} from '@flightsim-things/contract';
import type {
  Addon,
  Airport,
  ScanResult,
  ScanWarning,
  SimulatorId,
} from '@flightsim-things/contract';
import type {AddonDatabase} from '@flightsim-things/db';

import {discoverAirports} from './airport-discovery.js';
import {enrichInstalledAirports} from './airport-enrichment.js';
import {FileSystemError, fileSystem, ValidationError, validate} from './errors.js';

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

export const scanCommunityDirectory = Effect.fn(function* (
  simulator: SimulatorId,
  communityPath: string
) {
  const entries = yield* fileSystem(() =>
    readdir(communityPath, {withFileTypes: true})
  ).pipe(
    Effect.mapError(
      error =>
        new FileSystemError({
          cause: error.cause,
          message: `Could not read Community folder "${communityPath}". Check the path and folder permissions, then scan again.`,
        })
    )
  );
  const addons: Addon[] = [];
  const airports: Airport[] = [];
  const incompleteAirportFolders: string[] = [];
  const warnings: ScanWarning[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const folderPath = join(communityPath, entry.name);
    yield* Effect.gen(function* () {
      if (!(yield* fileSystem(() => stat(folderPath))).isDirectory()) {
        return;
      }
      const manifestJson = yield* fileSystem(() =>
        readFile(join(folderPath, 'manifest.json'), 'utf8')
      );
      const manifest: unknown = yield* validate(() =>
        JSON.parse(manifestJson.replace(/^\uFEFF/, ''))
      );
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        return yield* Effect.fail(
          new ValidationError({message: 'Manifest must be a JSON object.'})
        );
      }
      const fields = manifest as Record<string, unknown>;
      const name = optionalText(fields.title);
      if (!name) {
        return yield* Effect.fail(
          new ValidationError({message: 'Manifest must include a nonempty title.'})
        );
      }
      const addon: Addon = {
        simulator,
        folderName: entry.name,
        folderPath,
        name,
        version: optionalText(fields.package_version),
        creator: optionalText(fields.creator),
        contentType: optionalText(fields.content_type),
        manifestJson,
      };
      addons.push(addon);
      const discovered = yield* discoverAirports(addon);
      airports.push(...discovered.airports);
      if (!discovered.complete) {
        incompleteAirportFolders.push(addon.folderName);
      }
      warnings.push(
        ...discovered.warnings.map(message => ({folderName: addon.folderName, message}))
      );
    }).pipe(
      Effect.catch(error =>
        Effect.sync(() => {
          warnings.push({
            folderName: entry.name,
            message:
              error instanceof Error ? error.message : 'Could not read package manifest.',
          });
        })
      )
    );
  }
  return {addons, airports, incompleteAirportFolders, warnings};
});

export function createAddonLibrary(database: AddonDatabase) {
  const operations = Semaphore.makeUnsafe(1);
  return {
    getLibrary: () => operations.withPermit(database.getLibrary()),
    saveCommunityPath: (simulator: SimulatorId, path: string) =>
      operations.withPermit(database.saveCommunityPath(simulator, path)),
    scan: (simulator: SimulatorId) =>
      operations.withPermit(
        Effect.gen(function* () {
          const {communityPath} = yield* database.getInventory(simulator);
          if (!communityPath) {
            return yield* Effect.fail(
              new ValidationError({
                message: 'Save a Community folder path before scanning.',
              })
            );
          }
          const {addons, airports, incompleteAirportFolders, warnings} =
            yield* scanCommunityDirectory(simulator, communityPath);
          const inventory = yield* database.replaceInventory(
            simulator,
            communityPath,
            addons,
            airports,
            incompleteAirportFolders
          );
          return {inventory, warnings} satisfies ScanResult;
        }).pipe(Effect.uninterruptible)
      ),
    enrichAirports: (simulator: SimulatorId, apiKey: string) =>
      operations.withPermit(enrichInstalledAirports(database, simulator, apiKey)),
  };
}
