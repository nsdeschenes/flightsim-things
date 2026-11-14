import {connect} from '@tursodatabase/database';
import {defineRelations, eq} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/tursodatabase/database';

import {simulators} from '@flightsim-things/contract';
import type {Addon, SimulatorId, SimulatorInventory} from '@flightsim-things/contract';

import * as schema from './schema.js';

export async function openDatabase(path: string) {
  const client = await connect(path);
  const db = drizzle({client, relations: defineRelations(schema)});
  try {
    await client.exec(`
      CREATE TABLE IF NOT EXISTS simulator_settings (
        simulator TEXT PRIMARY KEY NOT NULL,
        communityPath TEXT,
        scannedPath TEXT,
        scannedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS addons (
        simulator TEXT NOT NULL,
        folderName TEXT NOT NULL,
        folderPath TEXT NOT NULL,
        name TEXT NOT NULL,
        version TEXT,
        creator TEXT,
        contentType TEXT,
        manifestJson TEXT NOT NULL,
        PRIMARY KEY (simulator, folderName)
      );
    `);
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
    return {
      simulator,
      communityPath: settings?.communityPath ?? null,
      scannedPath: settings?.scannedPath ?? null,
      scannedAt: settings?.scannedAt ?? null,
      addons,
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
    async replaceInventory(simulator: SimulatorId, scannedPath: string, addons: Addon[]) {
      const scannedAt = new Date().toISOString();
      await db.transaction(async transaction => {
        await transaction
          .delete(schema.addons)
          .where(eq(schema.addons.simulator, simulator));
        for (const addon of addons) {
          await transaction.insert(schema.addons).values({...addon, simulator});
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
  };
}

export type AddonDatabase = Awaited<ReturnType<typeof openDatabase>>;
