import {fileURLToPath} from 'node:url';

import {Effect} from 'effect';

import {simulators} from '@flightsim-things/contract';
import type {AddonDatabase} from '@flightsim-things/db';

import {scanCommunityDirectory} from './addons.js';

const airportPositions = new Map([
  ['KSEA', {latitude: 47.449, longitude: -122.3093}],
  ['LOWI', {latitude: 47.2602, longitude: 11.344}],
  ['CYUL', {latitude: 45.4706, longitude: -73.7408}],
  ['RJTT', {latitude: 35.5523, longitude: 139.7798}],
]);

export const seedDemoLibrary = Effect.fn(function* (database: AddonDatabase) {
  for (const simulator of simulators) {
    const inventory = yield* database.getInventory(simulator);
    if (inventory.communityPath !== null) {
      continue;
    }
    const communityPath = fileURLToPath(
      new URL(`../../../fixtures/community/${simulator}`, import.meta.url)
    );
    const {addons, airports, incompleteAirportFolders} = yield* scanCommunityDirectory(
      simulator,
      communityPath
    );
    const positionedAirports = airports.map(airport => ({
      ...airport,
      ...(airport.icaoCode && airportPositions.get(airport.icaoCode)),
    }));
    yield* database.replaceInventory(
      simulator,
      communityPath,
      addons,
      positionedAirports,
      incompleteAirportFolders
    );
    yield* database.saveCommunityPath(simulator, communityPath);
  }
});
