import {and, eq, exists, getColumns, sql} from 'drizzle-orm';
import {Console, Effect, Option} from 'effect';
import {Command, Flag} from 'effect/cli';

import database from '#database';
import schema from '#database-schema';

import formatTable from './terminal-table.ts';

type Aircraft = typeof schema.aircraft.$inferSelect &
  Pick<typeof schema.packages.$inferSelect, 'sourcePath'>;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type ListOptions = Readonly<{
  code: DeepReadonly<Option.Option<string>>;
  airline: DeepReadonly<Option.Option<string>>;
}>;

const columns = [
  {header: 'ID', key: 'id'},
  {header: 'ICAO type designator', key: 'icaoTypeDesignator'},
  {header: 'Manufacturer', key: 'manufacturer'},
  {header: 'Model', key: 'model'},
  {header: 'Name', key: 'name'},
  {header: 'Package ID', key: 'packageId'},
  {header: 'Source key', key: 'sourceKey'},
  {directory: (row: Readonly<Aircraft>): string => row.sourcePath, header: 'Directory'},
] as const;
const noAircraft = 0;

function findAircraft(
  aircraftCode: DeepReadonly<Option.Option<string>>,
  airlineCode: DeepReadonly<Option.Option<string>>
): Effect.Effect<Aircraft[], InstanceType<typeof database.Error>> {
  return database.use(db => {
    const typeFilter = aircraftCode.pipe(
      Option.map((value: string) =>
        eq(sql`upper(${schema.aircraft.icaoTypeDesignator})`, value)
      ),
      Option.getOrUndefined
    );
    const airlineFilter = airlineCode.pipe(
      Option.map((value: string) => {
        const airlineMatch = eq(sql`upper(${schema.airlines.icaoCode})`, value);
        const aircraftMatch = eq(schema.liveries.aircraftId, schema.aircraft.id);
        const linkedLiveries = db
          .select({id: schema.liveries.id})
          .from(schema.liveries)
          .innerJoin(schema.airlines, eq(schema.liveries.airlineId, schema.airlines.id))
          .where(and(aircraftMatch, airlineMatch));
        return exists(linkedLiveries);
      }),
      Option.getOrUndefined
    );
    return db
      .select({
        ...getColumns(schema.aircraft),
        sourcePath: schema.packages.sourcePath,
      })
      .from(schema.aircraft)
      .innerJoin(schema.packages, eq(schema.aircraft.packageId, schema.packages.id))
      .where(and(typeFilter, airlineFilter))
      .orderBy(
        schema.aircraft.icaoTypeDesignator,
        schema.aircraft.name,
        schema.aircraft.id
      )
      .all();
  });
}

const listCommand = Command.make(
  'list',
  {
    airline: Flag.String('airline').pipe(
      Flag.withDescription(
        'Match an exact airline ICAO code through a livery, ignoring case'
      ),
      Flag.optional
    ),
    code: Flag.String('code').pipe(
      Flag.withDescription('Match an exact aircraft ICAO type designator, ignoring case'),
      Flag.optional
    ),
  },
  ({code, airline}: ListOptions) =>
    Effect.gen(function* listAircraft() {
      const aircraftCode = Option.map((value: string) => value.trim().toUpperCase())(
        code
      );
      const airlineCode = Option.map((value: string) => value.trim().toUpperCase())(
        airline
      );
      const aircraft = yield* findAircraft(aircraftCode, airlineCode);
      if (aircraft.length === noAircraft) {
        if (Option.isSome(aircraftCode) || Option.isSome(airlineCode)) {
          return yield* Console.log('No installed aircraft match those filters.');
        }

        return yield* Console.log(
          'No installed aircraft found. Run scan to populate the list.'
        );
      }

      return yield* Console.log(formatTable(aircraft, columns));
    })
).pipe(Command.withDescription('List installed aircraft from the saved addon database'));

const aircraftCommand = Command.make('aircraft').pipe(
  Command.withDescription('Manage installed aircraft metadata'),
  Command.withSubcommands([listCommand])
);

export default aircraftCommand;
