import {eq} from 'drizzle-orm';
import type {Effect} from 'effect';

import database from '#database';
import schema from '#database-schema';

type SavedChoice = Readonly<{
  id: number;
  code: string;
  name: string;
  provenance: string;
}>;
type SavedAirport = SavedChoice & Readonly<{aliases: readonly string[]}>;
type SavedPair = Readonly<{aircraft: SavedChoice; airline: SavedChoice}>;
type Snapshot = Readonly<{
  airports: readonly SavedAirport[];
  pairs: readonly SavedPair[];
}>;
type AirportRow = Readonly<{
  airport: Readonly<typeof schema.airports.$inferSelect>;
  package: Readonly<typeof schema.packages.$inferSelect>;
}>;
type PairRow = Readonly<{
  aircraft: Readonly<typeof schema.aircraft.$inferSelect>;
  airline: Readonly<typeof schema.airlines.$inferSelect>;
  package: Readonly<typeof schema.packages.$inferSelect>;
}>;
const firstIndex = 0;
const airportCode = /^(?:[A-Z]{3}|[A-Z0-9]{4})$/u;

function normalize(value: string | null): string {
  return (value ?? '').trim().toUpperCase();
}

function airportChoice({airport, package: addon}: AirportRow): readonly SavedAirport[] {
  const aliases = [normalize(airport.icaoCode), normalize(airport.iataCode)].filter(
    code => airportCode.test(code)
  );
  const code = aliases.at(firstIndex) ?? '';
  if (code === '') {
    return [];
  }

  return [
    {
      aliases,
      code,
      id: airport.id,
      name: airport.name ?? 'Unnamed airport',
      provenance: `Package ${addon.id} | ${airport.sourceKey} | ${addon.sourcePath}`,
    },
  ];
}

function pairChoice({aircraft, airline, package: addon}: PairRow): SavedPair {
  const provenance = `Package ${addon.id} | ${aircraft.sourceKey} | ${addon.sourcePath}`;
  return {
    aircraft: {
      code: normalize(aircraft.icaoTypeDesignator),
      id: aircraft.id,
      name:
        [aircraft.name, aircraft.manufacturer, aircraft.model]
          .filter(Boolean)
          .join(' | ') || 'Unnamed aircraft',
      provenance,
    },
    airline: {
      code: normalize(airline.icaoCode),
      id: airline.id,
      name: airline.name ?? 'Unnamed airline',
      provenance,
    },
  };
}

function load(): Effect.Effect<Snapshot, InstanceType<typeof database.Error>> {
  return database.use(db => {
    const airports = db
      .select({airport: schema.airports, package: schema.packages})
      .from(schema.airports)
      .innerJoin(schema.packages, eq(schema.airports.packageId, schema.packages.id))
      .all()
      .flatMap(row => airportChoice(row));
    const pairs = db
      .select({
        aircraft: schema.aircraft,
        airline: schema.airlines,
        package: schema.packages,
      })
      .from(schema.liveries)
      .innerJoin(schema.aircraft, eq(schema.liveries.aircraftId, schema.aircraft.id))
      .innerJoin(schema.airlines, eq(schema.liveries.airlineId, schema.airlines.id))
      .innerJoin(schema.packages, eq(schema.aircraft.packageId, schema.packages.id))
      .all()
      .map(row => pairChoice(row));
    return {airports, pairs};
  });
}

const flightSearchChoices = {load};

export default flightSearchChoices;
