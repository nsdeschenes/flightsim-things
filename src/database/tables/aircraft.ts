import {integer, sqliteTable, text, uniqueIndex} from 'drizzle-orm/sqlite-core';
import type {SQLiteTableExtraConfigValue} from 'drizzle-orm/sqlite-core/table';

import packages from './packages.ts';

const aircraft = sqliteTable(
  'aircraft',
  {
    icaoTypeDesignator: text('icao_type_designator'),
    id: integer().primaryKey({autoIncrement: true}),
    manufacturer: text(),
    model: text(),
    name: text(),
    packageId: integer('package_id')
      .notNull()
      .references(() => packages.id, {onDelete: 'cascade'}),
    sourceKey: text('source_key').notNull(),
  },
  (): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('aircraft_package_source').on(aircraft.packageId, aircraft.sourceKey),
  ]
);

export default aircraft;
