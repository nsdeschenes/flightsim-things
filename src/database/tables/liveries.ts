import {index, integer, sqliteTable, text, uniqueIndex} from 'drizzle-orm/sqlite-core';
import type {SQLiteTableExtraConfigValue} from 'drizzle-orm/sqlite-core/table';

import aircraft from './aircraft.ts';
import airlines from './airlines.ts';
import packages from './packages.ts';

const liveries = sqliteTable(
  'liveries',
  {
    aircraftId: integer('aircraft_id').references(() => aircraft.id, {
      onDelete: 'set null',
    }),
    airlineId: integer('airline_id').references(() => airlines.id, {
      onDelete: 'set null',
    }),
    id: integer().primaryKey({autoIncrement: true}),
    name: text(),
    packageId: integer('package_id')
      .notNull()
      .references(() => packages.id, {onDelete: 'cascade'}),
    registration: text(),
    sourceKey: text('source_key').notNull(),
    targetAircraftKey: text('target_aircraft_key'),
  },
  (): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('liveries_package_source').on(liveries.packageId, liveries.sourceKey),
    index('liveries_aircraft').on(liveries.aircraftId),
    index('liveries_airline').on(liveries.airlineId),
  ]
);

export default liveries;
