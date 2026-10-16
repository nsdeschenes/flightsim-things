import {Console, Data, Effect, Option} from 'effect';
import {Command, Flag} from 'effect/cli';

import findFlight from '#find-flight';

import formatTable from './terminal-table.ts';

const noFlights = 0;
const controlCharacters = /\p{Cc}/gu;
type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type FindOptions = DeepReadonly<{dep: Option.Option<string>; arr: Option.Option<string>}>;
type FlightQuery = Effect.Success<ReturnType<typeof findFlight>>['fixed'];
const directions = {
  departure: {header: 'Destination', preposition: 'from'},
  destination: {header: 'Departure', preposition: 'to'},
};

const {TaggedError: taggedError} = Data;

class FindFlightOptionsError extends taggedError('FindFlightOptionsError')<{
  readonly message: string;
}> {}

function parseQuery({
  dep,
  arr,
}: FindOptions): Effect.Effect<FlightQuery, FindFlightOptionsError> {
  if (Option.isSome(dep) && Option.isSome(arr)) {
    return Effect.succeed({
      airport: dep.value,
      destination: arr.value,
      endpoint: 'departure',
    });
  }

  if (Option.isSome(dep)) {
    return Effect.succeed({airport: dep.value, endpoint: 'departure'});
  }

  if (Option.isSome(arr)) {
    return Effect.succeed({airport: arr.value, endpoint: 'destination'});
  }

  return Effect.fail(
    new FindFlightOptionsError({message: 'Specify --dep, --arr, or both.'})
  );
}

function plain(value: string): string {
  return Bun.stripANSI(value).replaceAll(controlCharacters, ' ');
}

function describeRoute(fixed: FlightQuery): string {
  if (fixed.endpoint === 'departure' && typeof fixed.destination === 'string') {
    return `from ${fixed.airport} to ${fixed.destination}`;
  }

  return `${directions[fixed.endpoint].preposition} ${fixed.airport}`;
}

function details(
  flights: Effect.Success<ReturnType<typeof findFlight>>['flights']
): Effect.Effect<void> {
  return Effect.gen(function* showDetails() {
    for (const flight of flights) {
      yield* Console.log(
        plain(`${flight.counterpart.codes.join('/')} - ${flight.reason}`)
      );
      for (const source of flight.sources) {
        yield* Console.log(plain(`  ${source.title}: ${source.url}`));
      }
    }
  });
}

const command = Command.make(
  'find-flight',
  {
    arr: Flag.String('arr').pipe(
      Flag.withDescription(
        'Destination ICAO or IATA code. Specify --dep, --arr, or both.'
      ),
      Flag.optional
    ),
    dep: Flag.String('dep').pipe(
      Flag.withDescription('Departure ICAO or IATA code. Specify --dep, --arr, or both.'),
      Flag.optional
    ),
  },
  (options: FindOptions) =>
    Effect.gen(function* showPotentialFlights() {
      const query = yield* parseQuery(options);
      const direction = directions[query.endpoint];
      const result = yield* findFlight(query);
      const route = describeRoute(result.fixed);
      if (result.flights.length === noFlights) {
        return yield* Console.log(
          `No supported potential flights found ${route} with your saved inventory.`
        );
      }

      yield* Console.log(
        `Potential flights ${route}. These are suggestions, not confirmed schedules.`
      );
      yield* Console.log(
        formatTable(
          result.flights.map(flight => ({
            aircraft:
              flight.livery.aircraft.name ??
              flight.livery.aircraft.model ??
              flight.livery.aircraft.icaoTypeDesignator ??
              '',
            airline:
              flight.livery.airline.name ??
              flight.livery.airline.icaoCode ??
              flight.livery.airline.iataCode ??
              '',
            counterpart:
              `${flight.counterpart.codes.join('/')} ${flight.counterpart.name ?? ''}`.trim(),
            flight: flight.flightNumber ?? '',
            livery: flight.livery.name ?? String(flight.livery.id),
          })),
          [
            {header: direction.header, key: 'counterpart'},
            {header: 'Airline', key: 'airline'},
            {header: 'Aircraft', key: 'aircraft'},
            {header: 'Livery', key: 'livery'},
            {header: 'Flight', key: 'flight'},
          ],
          false
        )
      );
      return yield* details(result.flights);
    })
).pipe(
  Command.withDescription(
    'Research potential flights using saved aircraft, liveries, and airports'
  )
);

export default command;
