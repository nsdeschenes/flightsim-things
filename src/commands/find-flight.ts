import {Console, Effect} from 'effect';
import {Argument, Command} from 'effect/cli';

import findFlight from '#find-flight';

import formatTable from './terminal-table.ts';

const noFlights = 0;
const controlCharacters = /\p{Cc}/gu;

function plain(value: string): string {
  return Bun.stripANSI(value).replaceAll(controlCharacters, ' ');
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
    airport: Argument.String('airport').pipe(
      Argument.withDescription('Departure ICAO or IATA code')
    ),
  },
  ({airport}: Readonly<{airport: string}>) =>
    Effect.gen(function* showPotentialFlights() {
      const result = yield* findFlight({airport, endpoint: 'departure'});
      if (result.flights.length === noFlights) {
        return yield* Console.log(
          `No supported potential flights found from ${result.fixed.airport} with your saved inventory.`
        );
      }

      yield* Console.log(
        `Potential flights from ${result.fixed.airport}. These are suggestions, not confirmed schedules.`
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
            destination:
              `${flight.counterpart.codes.join('/')} ${flight.counterpart.name ?? ''}`.trim(),
            flight: flight.flightNumber ?? '',
            livery: flight.livery.name ?? String(flight.livery.id),
          })),
          [
            {header: 'Destination', key: 'destination'},
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
    'Research potential flights using saved aircraft, liveries, and destination airports'
  )
);

export default command;
