import {and, eq, ne, sql} from 'drizzle-orm';
import {Option} from 'effect';
import type {Effect} from 'effect/Effect';

import database from '#database';
import schema from '#database-schema';

import airportFallback from './airport-fallback.ts';
import contentPolicy from './content-policy.ts';
import type PackageSnapshot from './model.ts';

type ContentPolicy = ReturnType<typeof contentPolicy>;
type WrittenRows = Readonly<{aircraft: readonly number[]; liveries: readonly number[]}>;
type QueryDatabase = Parameters<
  Parameters<typeof database.use>[typeof firstIndex]
>[typeof firstIndex];
type Transaction = Readonly<
  Pick<
    Parameters<
      Parameters<QueryDatabase['transaction']>[typeof firstIndex]
    >[typeof firstIndex],
    'delete' | 'insert' | 'run' | 'select' | 'update'
  >
>;
type AircraftRow = Readonly<typeof schema.aircraft.$inferInsert>;
type AirportRow = Readonly<typeof schema.airports.$inferInsert>;
type LiveryRow = Readonly<typeof schema.liveries.$inferInsert>;
type PackageRows = Readonly<{
  packageId: number;
  policy: ContentPolicy;
  aircraft: readonly AircraftRow[];
  airports: readonly AirportRow[];
  liveries: readonly LiveryRow[];
}>;
type IdLookup = Readonly<Pick<Map<string | null, number>, 'get'>>;
type DatabaseError = InstanceType<typeof database.Error>;
const chunkSize = 100;
const firstIndex = 0;
const missing = Option.getOrNull(Option.none());

function* chunks<Value>(values: readonly Value[]): Generator<readonly Value[]> {
  for (let index = firstIndex; index < values.length; index += chunkSize) {
    yield values.slice(index, index + chunkSize);
  }
}

function savePackages(tx: Transaction, snapshots: readonly PackageSnapshot[]): IdLookup {
  const rows = tx
    .insert(schema.packages)
    .values(snapshots.map(snapshot => snapshot.metadata))
    .onConflictDoUpdate({
      set: {
        contentType: sql`excluded.content_type`,
        creator: sql`excluded.creator`,
        manufacturer: sql`excluded.manufacturer`,
        minimumGameVersion: sql`excluded.minimum_game_version`,
        title: sql`excluded.title`,
        version: sql`excluded.version`,
      },
      target: schema.packages.sourcePath,
    })
    .returning({id: schema.packages.id, sourcePath: schema.packages.sourcePath})
    .all();
  return new Map(rows.map(row => [row.sourcePath, row.id]));
}

function airlineInputs(
  snapshots: readonly PackageSnapshot[]
): readonly Readonly<{icaoCode: string; name: string | null}>[] {
  const rows = new Map<string, {icaoCode: string; name: string | null}>();
  for (const snapshot of snapshots) {
    for (const livery of snapshot.liveries) {
      if (livery.airlineCode !== missing) {
        const prior = rows.get(livery.airlineCode);
        rows.set(livery.airlineCode, {
          icaoCode: livery.airlineCode,
          name: livery.airlineName ?? (prior && prior.name) ?? missing,
        });
      }
    }
  }

  return [...rows.values()];
}

function saveAirlines(tx: Transaction, snapshots: readonly PackageSnapshot[]): IdLookup {
  const ids = new Map<string | null, number>();
  for (const rows of chunks(airlineInputs(snapshots))) {
    const saved = tx
      .insert(schema.airlines)
      .values([...rows])
      .onConflictDoUpdate({
        set: {name: sql`coalesce(excluded.name, ${schema.airlines.name})`},
        target: schema.airlines.icaoCode,
      })
      .returning({icaoCode: schema.airlines.icaoCode, id: schema.airlines.id})
      .all();
    for (const row of saved) {
      ids.set(row.icaoCode, row.id);
    }
  }

  return ids;
}

function liveryRow(
  row: PackageSnapshot['liveries'][number],
  packageId: number,
  airlineIds: IdLookup
): LiveryRow {
  return {
    aircraftId: missing,
    airlineId: airlineIds.get(row.airlineCode) ?? missing,
    name: row.name,
    packageId,
    registration: row.registration,
    sourceKey: row.sourceKey,
    targetAircraftKey: row.targetAircraftKey,
  };
}

function packageRows(
  snapshot: PackageSnapshot,
  packageIds: IdLookup,
  airlineIds: IdLookup
): PackageRows {
  const packageId = packageIds.get(snapshot.metadata.sourcePath);
  if (typeof packageId !== 'number') {
    throw new TypeError(`Package upsert did not return ${snapshot.metadata.sourcePath}`);
  }

  return {
    aircraft: snapshot.aircraft.map(row => ({...row, packageId})),
    airports: snapshot.airports.map(row => ({...row, packageId})),
    liveries: snapshot.liveries.map(row => liveryRow(row, packageId, airlineIds)),
    packageId,
    policy: contentPolicy(snapshot.metadata.contentType),
  };
}

function removeDisallowedContent(tx: Transaction, rows: PackageRows): void {
  if (!rows.policy.liveries) {
    tx.delete(schema.liveries).where(eq(schema.liveries.packageId, rows.packageId)).run();
  }

  if (!rows.policy.aircraft) {
    tx.delete(schema.aircraft).where(eq(schema.aircraft.packageId, rows.packageId)).run();
  }

  if (!rows.policy.airports) {
    tx.delete(schema.airports).where(eq(schema.airports.packageId, rows.packageId)).run();
  }
}

function saveAircraft(
  tx: Transaction,
  values: readonly AircraftRow[]
): readonly number[] {
  const ids: number[] = [];
  for (const rows of chunks(values)) {
    const saved = tx
      .insert(schema.aircraft)
      .values([...rows])
      .onConflictDoUpdate({
        set: {
          icaoTypeDesignator: sql`excluded.icao_type_designator`,
          manufacturer: sql`excluded.manufacturer`,
          model: sql`excluded.model`,
          name: sql`excluded.name`,
        },
        target: [schema.aircraft.packageId, schema.aircraft.sourceKey],
      })
      .returning({id: schema.aircraft.id})
      .all();
    for (const row of saved) {
      ids.push(row.id);
    }
  }

  return ids;
}

function promoteAirportFallback(
  tx: Transaction,
  inferred: Readonly<typeof schema.airports.$inferSelect>,
  replacement: AirportRow
): boolean {
  if (replacement.sourceKey === airportFallback.sourceKey) {
    return true;
  }

  const explicit = tx
    .select({id: schema.airports.id})
    .from(schema.airports)
    .where(
      and(
        eq(schema.airports.packageId, inferred.packageId),
        eq(schema.airports.sourceKey, replacement.sourceKey)
      )
    )
    .get();
  if (explicit) {
    return false;
  }

  tx.update(schema.airports)
    .set({sourceKey: replacement.sourceKey})
    .where(eq(schema.airports.id, inferred.id))
    .run();
  return true;
}

function retireFallbackIfExplicit(tx: Transaction, rows: PackageRows): boolean {
  if (!rows.airports.some(row => row.sourceKey === airportFallback.sourceKey)) {
    return false;
  }

  const explicit = tx
    .select({id: schema.airports.id})
    .from(schema.airports)
    .where(
      and(
        eq(schema.airports.packageId, rows.packageId),
        ne(schema.airports.sourceKey, airportFallback.sourceKey)
      )
    )
    .get();
  if (explicit) {
    tx.delete(schema.airports)
      .where(
        and(
          eq(schema.airports.packageId, rows.packageId),
          eq(schema.airports.sourceKey, airportFallback.sourceKey)
        )
      )
      .run();
    return true;
  }

  return false;
}

function reconcileAirportFallback(
  tx: Transaction,
  rows: PackageRows
): readonly AirportRow[] {
  const inferred = tx
    .select()
    .from(schema.airports)
    .where(
      and(
        eq(schema.airports.packageId, rows.packageId),
        eq(schema.airports.sourceKey, airportFallback.sourceKey)
      )
    )
    .get();
  if (!inferred) {
    return rows.airports;
  }

  const replacement = rows.airports.find(row => row.icaoCode === inferred.icaoCode);
  if (!replacement || !promoteAirportFallback(tx, inferred, replacement)) {
    tx.delete(schema.airports).where(eq(schema.airports.id, inferred.id)).run();
    return rows.airports;
  }

  if (replacement.sourceKey !== airportFallback.sourceKey) {
    return rows.airports;
  }

  return rows.airports.map(row => {
    if (row !== replacement) {
      return row;
    }

    return {
      ...row,
      iataCode: row.iataCode ?? inferred.iataCode,
      name: row.name ?? inferred.name,
    };
  });
}

function saveAirports(tx: Transaction, values: readonly AirportRow[]): void {
  for (const rows of chunks(values)) {
    tx.insert(schema.airports)
      .values([...rows])
      .onConflictDoUpdate({
        set: {
          iataCode: sql`excluded.iata_code`,
          icaoCode: sql`excluded.icao_code`,
          name: sql`excluded.name`,
        },
        target: [schema.airports.packageId, schema.airports.sourceKey],
      })
      .run();
  }
}

function saveLiveries(tx: Transaction, values: readonly LiveryRow[]): readonly number[] {
  const ids: number[] = [];
  for (const rows of chunks(values)) {
    const saved = tx
      .insert(schema.liveries)
      .values([...rows])
      .onConflictDoUpdate({
        set: {
          aircraftId: sql`CASE WHEN ${schema.liveries.targetAircraftKey} IS excluded.target_aircraft_key
            THEN ${schema.liveries.aircraftId} ELSE excluded.aircraft_id END`,
          airlineId: sql`excluded.airline_id`,
          name: sql`excluded.name`,
          registration: sql`excluded.registration`,
          targetAircraftKey: sql`excluded.target_aircraft_key`,
        },
        target: [schema.liveries.packageId, schema.liveries.sourceKey],
      })
      .returning({id: schema.liveries.id})
      .all();
    for (const row of saved) {
      ids.push(row.id);
    }
  }

  return ids;
}

function saveBatch(
  snapshots: readonly PackageSnapshot[]
): Effect<WrittenRows, DatabaseError> {
  return database.use(db =>
    db.transaction(
      (tx: Transaction) => {
        const packageIds = savePackages(tx, snapshots);
        const airlineIds = saveAirlines(tx, snapshots);
        const rows = snapshots.map(snapshot =>
          packageRows(snapshot, packageIds, airlineIds)
        );
        for (const row of rows) {
          removeDisallowedContent(tx, row);
        }

        saveAirports(
          tx,
          rows.flatMap(row => {
            if (retireFallbackIfExplicit(tx, row)) {
              return row.airports.filter(
                airport => airport.sourceKey !== airportFallback.sourceKey
              );
            }

            return reconcileAirportFallback(tx, row);
          })
        );
        return {
          aircraft: saveAircraft(
            tx,
            rows.flatMap(row => row.aircraft)
          ),
          liveries: saveLiveries(
            tx,
            rows.flatMap(row => row.liveries)
          ),
        };
      },
      {behavior: 'immediate'}
    )
  );
}

function seedLinkScope(tx: Transaction, rows: WrittenRows): void {
  tx.run(
    sql`CREATE TEMP TABLE scan_aircraft (id INTEGER PRIMARY KEY, package_id INTEGER NOT NULL, source_key TEXT NOT NULL)`
  );
  tx.run(sql`CREATE INDEX scan_aircraft_source ON scan_aircraft(source_key, package_id)`);
  tx.run(sql`CREATE TEMP TABLE scan_liveries (id INTEGER PRIMARY KEY)`);
  for (const ids of chunks(rows.aircraft)) {
    tx.run(
      sql`INSERT INTO scan_aircraft SELECT id, package_id, source_key FROM aircraft WHERE id IN (${sql.join(
        ids.map(id => sql`${id}`),
        sql`, `
      )})`
    );
  }

  for (const ids of chunks(rows.liveries)) {
    tx.run(
      sql`INSERT INTO scan_liveries (id) VALUES ${sql.join(
        ids.map(id => sql`(${id})`),
        sql`, `
      )}`
    );
  }
}

function linkLiveries(rows: WrittenRows): Effect<void, DatabaseError> {
  return database.use(db => {
    db.transaction(
      (tx: Transaction) => {
        seedLinkScope(tx, rows);
        tx.run(sql`UPDATE liveries SET aircraft_id = coalesce(
        (SELECT a.id FROM scan_aircraft a
         WHERE a.package_id = liveries.package_id AND a.source_key = liveries.target_aircraft_key),
        (SELECT min(a.id) FROM scan_aircraft a
         WHERE a.source_key = liveries.target_aircraft_key HAVING count(*) = 1)
      ) WHERE id IN (SELECT id FROM scan_liveries)`);
      },
      {behavior: 'immediate'}
    );
  });
}

const persistence = {link: linkLiveries, save: saveBatch};
export default persistence;
