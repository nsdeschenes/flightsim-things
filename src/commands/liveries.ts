import {and, eq, getColumns, sql} from 'drizzle-orm';
import {Console, Effect, Option} from 'effect';
import {Command, Flag} from 'effect/cli';

import database from '#database';
import schema from '#database-schema';

import type SavedList from './saved-list.ts';
import formatTable from './terminal-table.ts';

type Livery = typeof schema.liveries.$inferSelect &
  Pick<typeof schema.packages.$inferSelect, 'sourcePath'> &
  Readonly<{
    aircraftName: string | null;
    aircraftCode: string | null;
    airlineName: string | null;
    airlineCode: string | null;
    airlineIataCode: string | null;
  }>;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type ListOptions = Readonly<{
  aircraft: DeepReadonly<Option.Option<string>>;
  airline: DeepReadonly<Option.Option<string>>;
}>;

const columns = [
  {header: 'ID', key: 'id'},
  {header: 'Name', key: 'name'},
  {header: 'Registration', key: 'registration'},
  {header: 'Aircraft ID', key: 'aircraftId'},
  {header: 'Aircraft ICAO', key: 'aircraftCode'},
  {header: 'Aircraft name', key: 'aircraftName'},
  {header: 'Airline ID', key: 'airlineId'},
  {header: 'Airline ICAO', key: 'airlineCode'},
  {header: 'Airline IATA', key: 'airlineIataCode'},
  {header: 'Airline name', key: 'airlineName'},
  {header: 'Target aircraft key', key: 'targetAircraftKey'},
  {header: 'Package ID', key: 'packageId'},
  {header: 'Source key', key: 'sourceKey'},
  {directory: (row: Readonly<Livery>): string => row.sourcePath, header: 'Directory'},
] as const;
const noLiveries = 0;
const emptyLiveriesMessage =
  'No installed liveries found. Run scan to populate the list.';

function findLiveries(
  aircraftCode: DeepReadonly<Option.Option<string>>,
  airlineCode: DeepReadonly<Option.Option<string>>
): Effect.Effect<Livery[], InstanceType<typeof database.Error>> {
  return database.use(db => {
    const aircraftFilter = aircraftCode.pipe(
      Option.map((value: string) =>
        eq(sql`upper(${schema.aircraft.icaoTypeDesignator})`, value)
      ),
      Option.getOrUndefined
    );
    const airlineFilter = airlineCode.pipe(
      Option.map((value: string) => eq(sql`upper(${schema.airlines.icaoCode})`, value)),
      Option.getOrUndefined
    );
    return db
      .select({
        ...getColumns(schema.liveries),
        aircraftCode: schema.aircraft.icaoTypeDesignator,
        aircraftName: schema.aircraft.name,
        airlineCode: schema.airlines.icaoCode,
        airlineIataCode: schema.airlines.iataCode,
        airlineName: schema.airlines.name,
        sourcePath: schema.packages.sourcePath,
      })
      .from(schema.liveries)
      .innerJoin(schema.packages, eq(schema.liveries.packageId, schema.packages.id))
      .leftJoin(schema.aircraft, eq(schema.liveries.aircraftId, schema.aircraft.id))
      .leftJoin(schema.airlines, eq(schema.liveries.airlineId, schema.airlines.id))
      .where(and(aircraftFilter, airlineFilter))
      .orderBy(schema.liveries.name, schema.liveries.registration, schema.liveries.id)
      .all();
  });
}

const savedList: Effect.Effect<
  SavedList,
  InstanceType<typeof database.Error>
> = findLiveries(Option.none<string>(), Option.none<string>()).pipe(
  Effect.map((rows: readonly Readonly<Livery>[]) => ({
    choices: rows.map(row => ({
      description: `${row.sourceKey} | ${row.sourcePath}`,
      title: `[ID ${row.id}] ${[
        row.name,
        row.registration,
        row.aircraftName,
        row.aircraftCode,
        row.airlineName,
        row.airlineCode,
        row.airlineIataCode,
      ]
        .filter(Boolean)
        .join(' | ')}`,
      value: () => formatTable([row], columns),
    })),
    emptyMessage: emptyLiveriesMessage,
    message: 'Choose a livery',
  }))
);

const listCommand = Command.make(
  'list',
  {
    aircraft: Flag.String('aircraft').pipe(
      Flag.withDescription('Match an exact aircraft ICAO type designator, ignoring case'),
      Flag.optional
    ),
    airline: Flag.String('airline').pipe(
      Flag.withDescription('Match an exact airline ICAO code, ignoring case'),
      Flag.optional
    ),
  },
  ({aircraft, airline}: ListOptions) =>
    Effect.gen(function* listLiveries() {
      const aircraftCode = Option.map((value: string) => value.trim().toUpperCase())(
        aircraft
      );
      const airlineCode = Option.map((value: string) => value.trim().toUpperCase())(
        airline
      );
      const liveries = yield* findLiveries(aircraftCode, airlineCode);
      if (liveries.length === noLiveries) {
        if (Option.isSome(aircraftCode) || Option.isSome(airlineCode)) {
          return yield* Console.log('No installed liveries match those filters.');
        }

        return yield* Console.log(emptyLiveriesMessage);
      }

      return yield* Console.log(formatTable(liveries, columns));
    })
).pipe(Command.withDescription('List installed liveries from the saved addon database'));

const liveriesCommand = Command.make('liveries').pipe(
  Command.withDescription('Manage installed livery metadata'),
  Command.withSubcommands([listCommand])
);

const liveries = {command: liveriesCommand, savedList};

export default liveries;
