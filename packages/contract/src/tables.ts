import {index, primaryKey, real, sqliteTable, text} from 'drizzle-orm/sqlite-core';

import type {SimulatorId} from './simulators.js';

export const simulatorSettings = sqliteTable('simulator_settings', {
  simulator: text().$type<SimulatorId>().primaryKey(),
  communityPath: text(),
  scannedPath: text(),
  scannedAt: text(),
});

export const addons = sqliteTable(
  'addons',
  {
    simulator: text().$type<SimulatorId>().notNull(),
    folderName: text().notNull(),
    folderPath: text().notNull(),
    name: text().notNull(),
    version: text(),
    creator: text(),
    contentType: text(),
    manifestJson: text().notNull(),
  },
  table => [primaryKey({columns: [table.simulator, table.folderName]})]
);

export const airports = sqliteTable(
  'airports',
  {
    simulator: text().$type<SimulatorId>().notNull(),
    folderName: text().notNull(),
    sourceKey: text().notNull(),
    icaoCode: text(),
    iataCode: text(),
    name: text(),
    elevationMeters: real(),
    latitude: real(),
    longitude: real(),
  },
  table => [
    primaryKey({columns: [table.simulator, table.folderName, table.sourceKey]}),
    index('airports_icao').on(table.icaoCode),
    index('airports_iata').on(table.iataCode),
  ]
);
