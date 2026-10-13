import {and, eq, isNull} from 'drizzle-orm';
import {Effect, Option} from 'effect';

import database from '#database';
import schema from '#database-schema';
import openaipKey from '#openaip-key';

import openaip from './airport-enrichment-openaip.ts';

type AirportCode = Parameters<typeof openaip.lookupAirport>[typeof firstIndex];
type LookupResult = Effect.Success<ReturnType<typeof openaip.lookupAirport>>;
type AirportMetadata = Extract<LookupResult, {kind: 'matched'}>['metadata'];

type InstalledAirport = Readonly<
  Pick<
    typeof schema.airports.$inferSelect,
    'id' | 'packageId' | 'sourceKey' | 'icaoCode' | 'iataCode'
  >
>;
type LookupGroup = Readonly<{lookup: AirportCode; rows: readonly InstalledAirport[]}>;
type CompletedLookup = Readonly<{group: LookupGroup; result: LookupResult}>;
type Summary = Readonly<{
  airports: number;
  enriched: number;
  unmatched: number;
  ambiguous: number;
  skipped: number;
}>;
type EnrichmentError = ReturnType<typeof openaip.failure>;
type QueryDatabase = Parameters<
  Parameters<typeof database.use>[typeof firstIndex]
>[typeof firstIndex];
type Transaction = Readonly<
  Pick<
    Parameters<
      Parameters<QueryDatabase['transaction']>[typeof firstIndex]
    >[typeof firstIndex],
    'update'
  >
>;
type MutableSummary = {-readonly [Key in keyof Summary]: Summary[Key]};
const firstIndex = 0;
const noRows = 0;
const rowIncrement = 1;
const missing = Option.getOrNull(Option.none());

function normalizedCode(code: string | null): string {
  if (code === null) {
    return '';
  }
  return code.trim().toUpperCase();
}
function lookupFor(row: InstalledAirport): AirportCode | null {
  const icao = normalizedCode(row.icaoCode);
  const iata = normalizedCode(row.iataCode);
  if (icao !== '') {
    if (openaip.icaoPattern.test(icao)) {
      return {code: icao, field: 'icaoCode'};
    }
  } else if (openaip.iataPattern.test(iata)) {
    return {code: iata, field: 'iataCode'};
  }
  return missing;
}
function addRow(
  groups: Readonly<
    Pick<Map<string, {lookup: AirportCode; rows: InstalledAirport[]}>, 'get' | 'set'>
  >,
  lookup: AirportCode,
  row: InstalledAirport
): void {
  const groupKey = `${lookup.field}:${lookup.code}`;
  const existing = groups.get(groupKey);
  if (existing) {
    existing.rows.push(row);
  } else {
    groups.set(groupKey, {lookup, rows: [row]});
  }
}
function groupRows(
  rows: readonly InstalledAirport[]
): Readonly<{groups: readonly LookupGroup[]; skipped: number}> {
  const groups = new Map<string, {lookup: AirportCode; rows: InstalledAirport[]}>();
  let skipped = noRows;
  for (const row of rows) {
    const lookup = lookupFor(row);
    if (lookup === null) {
      skipped += rowIncrement;
    } else {
      addRow(groups, lookup, row);
    }
  }
  return {groups: [...groups.values()], skipped};
}
function originalCode(
  field: 'icaoCode' | 'iataCode',
  value: string | null
): ReturnType<typeof eq> {
  if (value === null) {
    return isNull(schema.airports[field]);
  }
  return eq(schema.airports[field], value);
}
function updateRow(
  tx: Transaction,
  row: InstalledAirport,
  metadata: AirportMetadata
): number {
  return tx
    .update(schema.airports)
    .set(metadata)
    .where(
      and(
        eq(schema.airports.id, row.id),
        eq(schema.airports.packageId, row.packageId),
        eq(schema.airports.sourceKey, row.sourceKey),
        originalCode('icaoCode', row.icaoCode),
        originalCode('iataCode', row.iataCode)
      )
    )
    .run().changes;
}
function applyLookup(
  tx: Transaction,
  completed: CompletedLookup,
  summary: MutableSummary
): void {
  const {group, result} = completed;
  if (result.kind !== 'matched') {
    summary[result.kind] += group.rows.length;
  } else if (Object.keys(result.metadata).length === noRows) {
    summary.skipped += group.rows.length;
  } else {
    for (const row of group.rows) {
      const changed = updateRow(tx, row, result.metadata);
      summary.enriched += changed;
      summary.skipped += rowIncrement - changed;
    }
  }
}
function applyMatches(
  lookups: readonly CompletedLookup[],
  summary: Summary
): Effect.Effect<Summary, EnrichmentError> {
  return database
    .use(db =>
      db.transaction(
        (tx: Transaction) => {
          const updated = {...summary};
          for (const lookup of lookups) {
            applyLookup(tx, lookup, updated);
          }
          return updated;
        },
        {behavior: 'immediate'}
      )
    )
    .pipe(
      Effect.mapError(() =>
        openaip.failure('Could not update the addon database. Retry the command.')
      )
    );
}
function installedRows(): Effect.Effect<readonly InstalledAirport[], EnrichmentError> {
  return database
    .use(db =>
      db
        .select({
          iataCode: schema.airports.iataCode,
          icaoCode: schema.airports.icaoCode,
          id: schema.airports.id,
          packageId: schema.airports.packageId,
          sourceKey: schema.airports.sourceKey,
        })
        .from(schema.airports)
        .all()
    )
    .pipe(
      Effect.mapError(() =>
        openaip.failure('Could not read the addon database. Retry the command.')
      )
    );
}
function enrich(): Effect.Effect<Summary, EnrichmentError> {
  return Effect.gen(function* enrichInstalledAirports() {
    const rows = yield* installedRows();
    if (rows.length === noRows) {
      return yield* openaip.failure(
        'No installed airports were found. Run scan before airports enrich.'
      );
    }
    const {groups, skipped} = groupRows(rows);
    const summary = {
      airports: rows.length,
      ambiguous: noRows,
      enriched: noRows,
      skipped,
      unmatched: noRows,
    };
    if (groups.length === noRows) {
      return summary;
    }
    const key = yield* openaipKey
      .get()
      .pipe(
        Effect.mapError((error: Readonly<{message: string}>) =>
          openaip.failure(error.message)
        )
      );
    const lookups = yield* Effect.forEach((group: LookupGroup) =>
      openaip
        .lookupAirport(group.lookup, key)
        .pipe(Effect.map(result => ({group, result})))
    )(groups);
    return yield* applyMatches(lookups, summary);
  });
}
const airportEnrichment = {enrich};
export default airportEnrichment;
