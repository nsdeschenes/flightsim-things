import {sql} from 'drizzle-orm';
import {check, integer, sqliteTable, text, uniqueIndex} from 'drizzle-orm/sqlite-core';
import type {SQLiteTableExtraConfigValue} from 'drizzle-orm/sqlite-core/table';

const airlines = sqliteTable(
  'airlines',
  {
    iataCode: text('iata_code'),
    icaoCode: text('icao_code'),
    id: integer().primaryKey({autoIncrement: true}),
    name: text(),
  },
  (): SQLiteTableExtraConfigValue[] => [
    uniqueIndex('airlines_icao').on(airlines.icaoCode),
    uniqueIndex('airlines_iata').on(airlines.iataCode),
    check(
      'airlines_known_identity',
      sql`${airlines.name} IS NOT NULL OR ${airlines.icaoCode} IS NOT NULL OR ${airlines.iataCode} IS NOT NULL`
    ),
  ]
);

export default airlines;
