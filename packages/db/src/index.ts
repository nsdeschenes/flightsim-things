import {fileURLToPath} from 'node:url';

import * as SqliteClient from '@effect/sql-sqlite-node/SqliteClient';
import {and, defineRelations, eq, isNull} from 'drizzle-orm';
import {makeWithDefaults} from 'drizzle-orm/effect-sqlite-node';
import {migrate} from 'drizzle-orm/effect-sqlite-node/migrator';
import {Effect} from 'effect';
import type {Scope} from 'effect';
import * as Reactivity from 'effect/reactivity/Reactivity';

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

export class DatabaseError extends Error {
  readonly _tag = 'DatabaseError';

  constructor(
    readonly operation: string,
    cause: unknown
  ) {
    super(`Database ${operation} failed`, {cause});
  }
}

function createDatabase() {
  return makeWithDefaults({relations: defineRelations(schema)});
}

function airportIdentity(airport: Airport) {
  return and(
    eq(schema.airports.simulator, airport.simulator),
    eq(schema.airports.folderName, airport.folderName),
    eq(schema.airports.sourceKey, airport.sourceKey)
  );
}

export function openDatabase(
  path: string
): Effect.Effect<AddonDatabase, DatabaseError, Scope.Scope> {
  return Effect.gen(function* () {
    const client = yield* SqliteClient.make({filename: path}).pipe(
      Effect.provide(Reactivity.layer),
      Effect.mapError(cause => new DatabaseError('connect', cause))
    );
    const db = yield* createDatabase().pipe(
      Effect.provideService(SqliteClient.SqliteClient, client)
    );
    yield* migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    }).pipe(Effect.mapError(cause => new DatabaseError('migrate', cause)));

    function getInventory(
      simulator: SimulatorId,
      connection: Pick<Effect.Success<ReturnType<typeof createDatabase>>, 'select'>
    ) {
      return Effect.gen(function* () {
        const [settings] = yield* connection
          .select()
          .from(schema.simulatorSettings)
          .where(eq(schema.simulatorSettings.simulator, simulator));
        const addons = yield* connection
          .select()
          .from(schema.addons)
          .where(eq(schema.addons.simulator, simulator))
          .orderBy(schema.addons.name, schema.addons.folderName);
        const airports = yield* connection
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
      });
    }

    return {
      db,
      getInventory: simulator =>
        db
          .transaction(tx => getInventory(simulator, tx))
          .pipe(Effect.mapError(cause => new DatabaseError('read inventory', cause))),
      getLibrary: () =>
        db
          .transaction(tx =>
            Effect.forEach(simulators, simulator => getInventory(simulator, tx))
          )
          .pipe(Effect.mapError(cause => new DatabaseError('read library', cause))),
      saveCommunityPath: (simulator, communityPath) =>
        db
          .transaction(tx =>
            Effect.gen(function* () {
              yield* tx
                .insert(schema.simulatorSettings)
                .values({simulator, communityPath})
                .onConflictDoUpdate({
                  target: schema.simulatorSettings.simulator,
                  set: {communityPath},
                });
              return yield* getInventory(simulator, tx);
            })
          )
          .pipe(
            Effect.mapError(cause => new DatabaseError('save community path', cause))
          ),
      replaceInventory: (
        simulator,
        scannedPath,
        addons,
        airports = [],
        incompleteAirportFolders = []
      ) =>
        db
          .transaction(tx =>
            Effect.gen(function* () {
              const scannedAt = new Date().toISOString();
              const previousAirports = yield* tx
                .select()
                .from(schema.airports)
                .where(eq(schema.airports.simulator, simulator));
              yield* tx
                .delete(schema.addons)
                .where(eq(schema.addons.simulator, simulator));
              for (const addon of addons) {
                yield* tx.insert(schema.addons).values({...addon, simulator});
              }
              yield* tx
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
                yield* tx.insert(schema.airports).values({
                  ...airport,
                  simulator,
                  icaoCode: airport.icaoCode ?? previous?.icaoCode ?? null,
                  iataCode: airport.iataCode ?? previous?.iataCode ?? null,
                  name: previous?.name ?? airport.name,
                  elevationMeters:
                    airport.elevationMeters ?? previous?.elevationMeters ?? null,
                  latitude: airport.latitude ?? previous?.latitude ?? null,
                  longitude: airport.longitude ?? previous?.longitude ?? null,
                });
              }
              yield* tx
                .insert(schema.simulatorSettings)
                .values({simulator, scannedPath, scannedAt})
                .onConflictDoUpdate({
                  target: schema.simulatorSettings.simulator,
                  set: {scannedPath, scannedAt},
                });
              return yield* getInventory(simulator, tx);
            })
          )
          .pipe(Effect.mapError(cause => new DatabaseError('replace inventory', cause))),
      applyAirportEnrichment: updates =>
        db
          .transaction(tx =>
            Effect.gen(function* () {
              let enriched = 0;
              for (const {airport, metadata} of updates) {
                const changed = yield* tx
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
            })
          )
          .pipe(Effect.mapError(cause => new DatabaseError('enrich airports', cause))),
    } satisfies AddonDatabase;
  });
}

export interface AddonDatabase {
  readonly db: Effect.Success<ReturnType<typeof createDatabase>>;
  getInventory(simulator: SimulatorId): Effect.Effect<SimulatorInventory, DatabaseError>;
  getLibrary(): Effect.Effect<SimulatorInventory[], DatabaseError>;
  saveCommunityPath(
    simulator: SimulatorId,
    communityPath: string
  ): Effect.Effect<SimulatorInventory, DatabaseError>;
  replaceInventory(
    simulator: SimulatorId,
    scannedPath: string,
    addons: Addon[],
    airports?: Airport[],
    incompleteAirportFolders?: string[]
  ): Effect.Effect<SimulatorInventory, DatabaseError>;
  applyAirportEnrichment(updates: AirportUpdate[]): Effect.Effect<number, DatabaseError>;
}
