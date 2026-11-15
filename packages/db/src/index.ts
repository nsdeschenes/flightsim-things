import {fileURLToPath} from 'node:url';

import {connect} from '@tursodatabase/database';
import {and, defineRelations, eq, isNull} from 'drizzle-orm';
import {drizzle} from 'drizzle-orm/tursodatabase/database';
import {migrate} from 'drizzle-orm/tursodatabase/migrator';
import {Effect, Semaphore} from 'effect';
import type {Scope} from 'effect';

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

function native<A>(operation: string, work: () => PromiseLike<A>) {
  // Turso cannot cancel in-flight queries. Wait before rollback or connection cleanup.
  return Effect.uninterruptible(
    Effect.tryPromise({
      try: () => Promise.resolve(work()),
      catch: cause => new DatabaseError(operation, cause),
    })
  );
}

function createDatabase(client: Awaited<ReturnType<typeof connect>>) {
  return drizzle({client, relations: defineRelations(schema)});
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
    const client = yield* Effect.acquireRelease(
      native('connect', () => connect(path)),
      client => Effect.sync(() => client.close())
    );
    const db = createDatabase(client);
    yield* native('migrate', () =>
      migrate(db, {
        migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
      })
    );
    const exclusive = Semaphore.withPermit(yield* Semaphore.make(1));

    function transaction<A>(body: Effect.Effect<A, DatabaseError>) {
      return Effect.uninterruptibleMask(restore =>
        Effect.gen(function* () {
          yield* native('begin transaction', () => db.run('BEGIN'));
          const result = yield* restore(body).pipe(
            Effect.catchCause(cause =>
              native('rollback transaction', () => db.run('ROLLBACK')).pipe(
                Effect.flatMap(() => Effect.failCause(cause))
              )
            )
          );
          yield* native('commit transaction', () => db.run('COMMIT')).pipe(
            Effect.catchCause(cause =>
              native('rollback transaction', () => db.run('ROLLBACK')).pipe(
                Effect.flatMap(() => Effect.failCause(cause))
              )
            )
          );
          return result;
        })
      );
    }

    function getInventory(
      simulator: SimulatorId
    ): Effect.Effect<SimulatorInventory, DatabaseError> {
      return Effect.gen(function* () {
        const [settings] = yield* native('read settings', () =>
          db
            .select()
            .from(schema.simulatorSettings)
            .where(eq(schema.simulatorSettings.simulator, simulator))
        );
        const addons = yield* native('read addons', () =>
          db
            .select()
            .from(schema.addons)
            .where(eq(schema.addons.simulator, simulator))
            .orderBy(schema.addons.name, schema.addons.folderName)
        );
        const airports = yield* native('read airports', () =>
          db
            .select()
            .from(schema.airports)
            .where(eq(schema.airports.simulator, simulator))
            .orderBy(schema.airports.folderName, schema.airports.sourceKey)
        );
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
      getInventory: simulator => exclusive(getInventory(simulator)),
      getLibrary: () => exclusive(Effect.forEach(simulators, getInventory)),
      saveCommunityPath: (simulator, communityPath) =>
        exclusive(
          Effect.gen(function* () {
            yield* native('save community path', () =>
              db
                .insert(schema.simulatorSettings)
                .values({simulator, communityPath})
                .onConflictDoUpdate({
                  target: schema.simulatorSettings.simulator,
                  set: {communityPath},
                })
            );
            return yield* getInventory(simulator);
          })
        ),
      replaceInventory: (
        simulator,
        scannedPath,
        addons,
        airports = [],
        incompleteAirportFolders = []
      ) =>
        exclusive(
          Effect.gen(function* () {
            const scannedAt = new Date().toISOString();
            yield* transaction(
              Effect.gen(function* () {
                const previousAirports = yield* native('read previous airports', () =>
                  db
                    .select()
                    .from(schema.airports)
                    .where(eq(schema.airports.simulator, simulator))
                );
                yield* native('delete addons', () =>
                  db.delete(schema.addons).where(eq(schema.addons.simulator, simulator))
                );
                for (const addon of addons) {
                  yield* native('insert addon', () =>
                    db.insert(schema.addons).values({...addon, simulator})
                  );
                }
                yield* native('delete airports', () =>
                  db
                    .delete(schema.airports)
                    .where(eq(schema.airports.simulator, simulator))
                );
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
                        (row.icaoCode === airport.icaoCode ||
                          airport.icaoCode === null)) ||
                        (row.sourceKey === '#package-name-airport' &&
                          row.icaoCode === airport.icaoCode))
                  );
                  yield* native('insert airport', () =>
                    db.insert(schema.airports).values({
                      ...airport,
                      simulator,
                      icaoCode: airport.icaoCode ?? previous?.icaoCode ?? null,
                      iataCode: airport.iataCode ?? previous?.iataCode ?? null,
                      name: previous?.name ?? airport.name,
                      elevationMeters:
                        airport.elevationMeters ?? previous?.elevationMeters ?? null,
                      latitude: airport.latitude ?? previous?.latitude ?? null,
                      longitude: airport.longitude ?? previous?.longitude ?? null,
                    })
                  );
                }
                yield* native('save scan settings', () =>
                  db
                    .insert(schema.simulatorSettings)
                    .values({simulator, scannedPath, scannedAt})
                    .onConflictDoUpdate({
                      target: schema.simulatorSettings.simulator,
                      set: {scannedPath, scannedAt},
                    })
                );
              })
            );
            return yield* getInventory(simulator);
          })
        ),
      applyAirportEnrichment: updates =>
        exclusive(
          transaction(
            Effect.gen(function* () {
              let enriched = 0;
              for (const {airport, metadata} of updates) {
                const changed = yield* native('enrich airport', () =>
                  db
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
                    .returning({sourceKey: schema.airports.sourceKey})
                );
                enriched += changed.length;
              }
              return enriched;
            })
          )
        ),
    } satisfies AddonDatabase;
  });
}

export interface AddonDatabase {
  readonly db: ReturnType<typeof createDatabase>;
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
