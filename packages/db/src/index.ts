import {fileURLToPath} from 'node:url';

import {connect} from '@tursodatabase/database';
import {and, defineRelations, eq, isNull} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/tursodatabase/database';
import {migrate} from 'drizzle-orm/tursodatabase/migrator';

import {simulators} from '@flightsim-things/contract';
import type {
  Addon,
  Airport,
  SimulatorId,
  SimulatorInventory,
} from '@flightsim-things/contract';

import * as schema from './schema.js';

export type AirportMetadata = Partial<
  Pick<
    Airport,
    'icaoCode' | 'iataCode' | 'name' | 'elevationMeters' | 'latitude' | 'longitude'
  >
>;
export interface AirportUpdate {
  airport: Airport;
  metadata: AirportMetadata;
}

function airportIdentity(airport: Airport) {
  return and(
    eq(schema.airports.simulator, airport.simulator),
    eq(schema.airports.folderName, airport.folderName),
    eq(schema.airports.sourceKey, airport.sourceKey)
  );
}

export async function openDatabase(path: string) {
  const client = await connect(path);
  const db = drizzle({client, relations: defineRelations(schema)});
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  } catch (error) {
    client.close();
    throw error;
  }

  async function getInventory(simulator: SimulatorId): Promise<SimulatorInventory> {
    const [settings] = await db
      .select()
      .from(schema.simulatorSettings)
      .where(eq(schema.simulatorSettings.simulator, simulator));
    const addons = await db
      .select()
      .from(schema.addons)
      .where(eq(schema.addons.simulator, simulator))
      .orderBy(schema.addons.name, schema.addons.folderName);
    const airports = await db
      .select()
      .from(schema.airports)
      .where(eq(schema.airports.simulator, simulator))
      .orderBy(schema.airports.folderName, schema.airports.sourceKey);
    return {
      simulator,
      communityPath: settings?.communityPath ?? null,
      scannedPath: settings?.scannedPath ?? null,
      scannedAt: settings?.scannedAt ?? null,
      addons,
      airports,
    };
  }

  return {
    db,
    close: () => client.close(),
    getInventory,
    getLibrary: () => Promise.all(simulators.map(getInventory)),
    async saveCommunityPath(simulator: SimulatorId, communityPath: string) {
      await db
        .insert(schema.simulatorSettings)
        .values({simulator, communityPath})
        .onConflictDoUpdate({
          target: schema.simulatorSettings.simulator,
          set: {communityPath},
        });
      return getInventory(simulator);
    },
    async replaceInventory(
      simulator: SimulatorId,
      scannedPath: string,
      addons: Addon[],
      airports: Airport[] = [],
      incompleteAirportFolders: string[] = []
    ) {
      const scannedAt = new Date().toISOString();
      await db.transaction(async transaction => {
        const previousAirports = await transaction
          .select()
          .from(schema.airports)
          .where(eq(schema.airports.simulator, simulator));
        await transaction
          .delete(schema.addons)
          .where(eq(schema.addons.simulator, simulator));
        for (const addon of addons) {
          await transaction.insert(schema.addons).values({...addon, simulator});
        }
        await transaction
          .delete(schema.airports)
          .where(eq(schema.airports.simulator, simulator));
        const retained = previousAirports.filter(
          airport =>
            incompleteAirportFolders.includes(airport.folderName) &&
            addons.some(addon => addon.folderName === airport.folderName)
        );
        for (const airport of [...retained, ...airports]) {
          const previous = previousAirports.find(
            row =>
              row.folderName === airport.folderName &&
              ((row.sourceKey === airport.sourceKey &&
                (row.icaoCode === airport.icaoCode || airport.icaoCode === null)) ||
                (row.sourceKey === '#package-name-airport' &&
                  row.icaoCode === airport.icaoCode))
          );
          await transaction.insert(schema.airports).values({
            ...airport,
            simulator,
            icaoCode: airport.icaoCode ?? previous?.icaoCode ?? null,
            iataCode: airport.iataCode ?? previous?.iataCode ?? null,
            name: previous?.name ?? airport.name,
            elevationMeters: airport.elevationMeters ?? previous?.elevationMeters ?? null,
            latitude: airport.latitude ?? previous?.latitude ?? null,
            longitude: airport.longitude ?? previous?.longitude ?? null,
          });
        }
        await transaction
          .insert(schema.simulatorSettings)
          .values({simulator, scannedPath, scannedAt})
          .onConflictDoUpdate({
            target: schema.simulatorSettings.simulator,
            set: {scannedPath, scannedAt},
          });
      });
      return getInventory(simulator);
    },
    async applyAirportEnrichment(updates: AirportUpdate[]) {
      return db.transaction(async transaction => {
        let enriched = 0;
        for (const {airport, metadata} of updates) {
          const changed = await transaction
            .update(schema.airports)
            .set(metadata)
            .where(
              and(
                airportIdentity(airport),
                airport.icaoCode === null
                  ? isNull(schema.airports.icaoCode)
                  : eq(schema.airports.icaoCode, airport.icaoCode),
                airport.iataCode === null
                  ? isNull(schema.airports.iataCode)
                  : eq(schema.airports.iataCode, airport.iataCode)
              )
            )
            .returning({sourceKey: schema.airports.sourceKey});
          enriched += changed.length;
        }
        return enriched;
      });
    },
  };
}

export type AddonDatabase = Awaited<ReturnType<typeof openDatabase>>;
