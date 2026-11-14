import {primaryKey, sqliteTable, text} from 'drizzle-orm/sqlite-core';

import type {SimulatorId} from '@flightsim-things/contract';

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
