import {eq, getColumns, or, sql} from 'drizzle-orm';
import {Console, Effect, Option} from 'effect';
import {Command, Flag} from 'effect/cli';

import airportEnrichment from '#airport-enrichment';
import database from '#database';
import schema from '#database-schema';

import type SavedList from './saved-list.ts';
import formatTable from './terminal-table.ts';

type Airport = typeof schema.airports.$inferSelect &
  Pick<typeof schema.packages.$inferSelect, 'sourcePath'>;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type ListOptions = Readonly<{
  code: DeepReadonly<Option.Option<string>>;
}>;

const columns = [
  {header: 'ID', key: 'id'},
  {header: 'ICAO code', key: 'icaoCode'},
  {header: 'IATA code', key: 'iataCode'},
  {header: 'Name', key: 'name'},
  {header: 'Latitude', key: 'latitude'},
  {header: 'Longitude', key: 'longitude'},
  {header: 'Elevation meters', key: 'elevationMeters'},
  {header: 'Package ID', key: 'packageId'},
  {header: 'Source key', key: 'sourceKey'},
  {directory: (row: Readonly<Airport>): string => row.sourcePath, header: 'Directory'},
] as const;
const noAirports = 0;

const emptyAirportsMessage =
  'No installed airports found. Run scan to populate the list.';

function findAirports(
  airportCode: DeepReadonly<Option.Option<string>>
): Effect.Effect<Airport[], InstanceType<typeof database.Error>> {
  return database.use(db =>
    db
      .select({
        ...getColumns(schema.airports),
        sourcePath: schema.packages.sourcePath,
      })
      .from(schema.airports)
      .innerJoin(schema.packages, eq(schema.airports.packageId, schema.packages.id))
      .where(
        airportCode.pipe(
          Option.map((value: string) =>
            or(
              eq(sql`upper(${schema.airports.icaoCode})`, value),
              eq(sql`upper(${schema.airports.iataCode})`, value)
            )
          ),
          Option.getOrUndefined
        )
      )
      .orderBy(schema.airports.icaoCode, schema.airports.name, schema.airports.id)
      .all()
  );
}

const savedList: Effect.Effect<
  SavedList,
  InstanceType<typeof database.Error>
> = findAirports(Option.none<string>()).pipe(
  Effect.map((rows: readonly Readonly<Airport>[]) => ({
    choices: rows.map(row => ({
      description: `${row.sourceKey} | ${row.sourcePath}`,
      title: `[ID ${row.id}] ${[row.name, row.icaoCode, row.iataCode].filter(Boolean).join(' | ')}`,
      value: () => formatTable([row], columns),
    })),
    emptyMessage: emptyAirportsMessage,
    message: 'Choose an airport',
  }))
);

const listCommand = Command.make(
  'list',
  {
    code: Flag.String('code').pipe(
      Flag.withDescription('Match an exact ICAO or IATA code, ignoring case'),
      Flag.optional
    ),
  },
  ({code}: ListOptions) =>
    Effect.gen(function* listAirports() {
      const airportCode = Option.map((value: string) => value.trim().toUpperCase())(code);
      const airports = yield* findAirports(airportCode);
      if (airports.length === noAirports) {
        if (Option.isSome(airportCode)) {
          return yield* Console.log('No installed airports match that code.');
        }

        return yield* Console.log(emptyAirportsMessage);
      }

      return yield* Console.log(formatTable(airports, columns));
    })
).pipe(Command.withDescription('List installed airports from the saved addon database'));

const enrichCommand = Command.make('enrich', {}, () =>
  Effect.gen(function* enrichAirports() {
    const summary = yield* airportEnrichment.enrich();
    yield* Console.log(
      `Enriched ${summary.enriched} of ${summary.airports} airports. ${summary.unmatched} unmatched, ${summary.ambiguous} ambiguous, ${summary.skipped} skipped.`
    );
  })
).pipe(Command.withDescription('Enrich installed airport metadata from OpenAIP'));

const airportsCommand = Command.make('airports').pipe(
  Command.withDescription('Manage installed airport metadata'),
  Command.withSubcommands([listCommand, enrichCommand])
);

const airports = {command: airportsCommand, savedList};

export default airports;
