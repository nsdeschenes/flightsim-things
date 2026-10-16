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
type FindOptions = DeepReadonly<{
  dep: Option.Option<string>;
  arr: Option.Option<string>;
  aircraft: Option.Option<string>;
  airline: Option.Option<string>;
}>;
type FlightQuery = Parameters<typeof findFlight>[number];
type FlightResult = Effect.Success<ReturnType<typeof findFlight>>;
type Flight = FlightResult['flights'][number];
type Airport = Extract<FlightResult, {mode: 'inventory'}>['flights'][number]['departure'];
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
  aircraft,
  airline,
}: FindOptions): Effect.Effect<FlightQuery, FindFlightOptionsError> {
  const filters = {
    aircraft: Option.getOrUndefined(aircraft),
    airline: Option.getOrUndefined(airline),
  };
  if (Option.isSome(dep)) {
    return Effect.succeed({
      ...filters,
      airport: dep.value,
      destination: Option.getOrUndefined(arr),
      endpoint: 'departure',
      mode: 'endpoint',
    });
  }

  if (Option.isSome(arr)) {
    return Effect.succeed({
      ...filters,
      airport: arr.value,
      endpoint: 'destination',
      mode: 'endpoint',
    });
  }

  if (Option.isSome(aircraft) && Option.isSome(airline)) {
    return Effect.succeed({
      aircraft: aircraft.value,
      airline: airline.value,
      mode: 'inventory',
    });
  }

  return Effect.fail(
    new FindFlightOptionsError({
      message: 'Specify --dep, --arr, or both, or supply both --aircraft and --airline.',
    })
  );
}

function plain(value: string): string {
  return Bun.stripANSI(value).replaceAll(controlCharacters, ' ');
}

function describeRoute(result: FlightResult): string {
  if (result.mode === 'inventory') {
    return `between saved airports for ${result.query.aircraft} and ${result.query.airline}`;
  }

  const {fixed} = result;
  if (fixed.endpoint === 'departure' && typeof fixed.destination === 'string') {
    return `from ${fixed.airport} to ${fixed.destination}`;
  }

  return `${directions[fixed.endpoint].preposition} ${fixed.airport}`;
}

function flightRoute(flight: Flight): string {
  if ('counterpart' in flight) {
    return flight.counterpart.codes.join('/');
  }

  return `${flight.departure.codes.join('/')} to ${flight.destination.codes.join('/')}`;
}

function details(flights: FlightResult['flights']): Effect.Effect<void> {
  return Effect.gen(function* showDetails() {
    for (const flight of flights) {
      yield* Console.log(plain(`${flightRoute(flight)} - ${flight.reason}`));
      for (const source of flight.sources) {
        yield* Console.log(plain(`  ${source.title}: ${source.url}`));
      }
    }
  });
}

function airportLabel(airport: Airport): string {
  return `${airport.codes.join('/')} ${airport.name ?? ''}`.trim();
}

function liveryRow(flight: Flight): Readonly<{
  aircraft: string;
  airline: string;
  flight: string;
  livery: string;
}> {
  return {
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
    flight: flight.flightNumber ?? '',
    livery: flight.livery.name ?? String(flight.livery.id),
  };
}

function flightTable(result: FlightResult): string {
  const columns = [
    {header: 'Airline', key: 'airline'},
    {header: 'Aircraft', key: 'aircraft'},
    {header: 'Livery', key: 'livery'},
    {header: 'Flight', key: 'flight'},
  ] satisfies readonly Readonly<{
    header: string;
    key: keyof ReturnType<typeof liveryRow>;
  }>[];
  if (result.mode === 'inventory') {
    return formatTable(
      result.flights.map(flight => ({
        ...liveryRow(flight),
        departure: airportLabel(flight.departure),
        destination: airportLabel(flight.destination),
      })),
      [
        {header: 'Departure', key: 'departure'},
        {header: 'Destination', key: 'destination'},
        ...columns,
      ],
      false
    );
  }

  return formatTable(
    result.flights.map(flight => ({
      ...liveryRow(flight),
      counterpart: airportLabel(flight.counterpart),
    })),
    [{header: directions[result.fixed.endpoint].header, key: 'counterpart'}, ...columns],
    false
  );
}

const command = Command.make(
  'find-flight',
  {
    aircraft: Flag.String('aircraft').pipe(
      Flag.withDescription(
        'Aircraft ICAO type designator. Without --dep or --arr, also supply --airline.'
      ),
      Flag.optional
    ),
    airline: Flag.String('airline').pipe(
      Flag.withDescription(
        'Airline ICAO code. Without --dep or --arr, also supply --aircraft.'
      ),
      Flag.optional
    ),
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
      const result = yield* findFlight(query);
      const route = plain(describeRoute(result));
      if (result.flights.length === noFlights) {
        return yield* Console.log(
          `No supported potential flights found ${route} with your saved inventory.`
        );
      }

      yield* Console.log(
        `Potential flights ${route}. These are suggestions, not confirmed schedules.`
      );
      yield* Console.log(flightTable(result));
      return yield* details(result.flights);
    })
).pipe(
  Command.withDescription(
    'Research potential flights using saved aircraft, liveries, and airports'
  )
);

export default command;
