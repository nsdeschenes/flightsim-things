import {index, integer, sqliteTable, text, uniqueIndex} from 'drizzle-orm/sqlite-core';
import type {SQLiteTableExtraConfigValue} from 'drizzle-orm/sqlite-core/table';

import packages from './packages.ts';

const airports = sqliteTable(
  'airports',
  {
    iataCode: text('iata_code'),
    icaoCode: text('icao_code'),
    id: integer().primaryKey({autoIncrement: true}),
    name: text(),
    packageId: integer('package_id')
      .notNull()
      .references(() => packages.id, {onDelete: 'cascade'}),
    sourceKey: text('source_key').notNull(),
  },
  (): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('airports_package_source').on(airports.packageId, airports.sourceKey),
    index('airports_icao').on(airports.icaoCode),
    index('airports_iata').on(airports.iataCode),
  ]
);

export default airports;
