import {and, eq, exists, sql} from 'drizzle-orm';
import {Console, Effect, Option} from 'effect';
import {Command, Flag} from 'effect/cli';

import database from '#database';
import schema from '#database-schema';

import formatTable from './terminal-table.ts';

type Airline = typeof schema.airlines.$inferSelect;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type ListOptions = Readonly<{
  code: DeepReadonly<Option.Option<string>>;
  aircraft: DeepReadonly<Option.Option<string>>;
}>;

const columns = [
  {header: 'ID', key: 'id'},
  {header: 'ICAO code', key: 'icaoCode'},
  {header: 'IATA code', key: 'iataCode'},
  {header: 'Name', key: 'name'},
] as const;
const noAirlines = 0;

function findAirlines(
  airlineCode: DeepReadonly<Option.Option<string>>,
  aircraftCode: DeepReadonly<Option.Option<string>>
): Effect.Effect<Airline[], InstanceType<typeof database.Error>> {
  return database.use(db => {
    const airlineFilter = airlineCode.pipe(
      Option.map((value: string) => eq(sql`upper(${schema.airlines.icaoCode})`, value)),
      Option.getOrUndefined
    );
    const aircraftFilter = aircraftCode.pipe(
      Option.map((value: string) => {
        const aircraftMatch = eq(
          sql`upper(${schema.aircraft.icaoTypeDesignator})`,
          value
        );
        const airlineMatch = eq(schema.liveries.airlineId, schema.airlines.id);
        const linkedLiveries = db
          .select({id: schema.liveries.id})
          .from(schema.liveries)
          .innerJoin(schema.aircraft, eq(schema.liveries.aircraftId, schema.aircraft.id))
          .where(and(airlineMatch, aircraftMatch));
        return exists(linkedLiveries);
      }),
      Option.getOrUndefined
    );
    return db
      .select()
      .from(schema.airlines)
      .where(and(airlineFilter, aircraftFilter))
      .orderBy(schema.airlines.icaoCode, schema.airlines.name, schema.airlines.id)
      .all();
  });
}

const listCommand = Command.make(
  'list',
  {
    aircraft: Flag.String('aircraft').pipe(
      Flag.withDescription(
        'Match an exact aircraft ICAO type designator through a livery, ignoring case'
      ),
      Flag.optional
    ),
    code: Flag.String('code').pipe(
      Flag.withDescription('Match an exact airline ICAO code, ignoring case'),
      Flag.optional
    ),
  },
  ({code, aircraft}: ListOptions) =>
    Effect.gen(function* listAirlines() {
      const airlineCode = Option.map((value: string) => value.trim().toUpperCase())(code);
      const aircraftCode = Option.map((value: string) => value.trim().toUpperCase())(
        aircraft
      );
      const airlines = yield* findAirlines(airlineCode, aircraftCode);
      if (airlines.length === noAirlines) {
        if (Option.isSome(airlineCode) || Option.isSome(aircraftCode)) {
          return yield* Console.log('No saved airlines match those filters.');
        }

        return yield* Console.log(
          'No saved airlines found. Run scan to populate the list.'
        );
      }

      return yield* Console.log(formatTable(airlines, columns, false));
    })
).pipe(Command.withDescription('List airlines from the saved addon database'));

const airlinesCommand = Command.make('airlines').pipe(
  Command.withDescription('Manage saved airline metadata'),
  Command.withSubcommands([listCommand])
);

export default airlinesCommand;
