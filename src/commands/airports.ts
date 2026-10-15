import {Console, Effect} from 'effect';
import {Command} from 'effect/cli';

import airportEnrichment from '#airport-enrichment';

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
  Command.withSubcommands([enrichCommand])
);

export default airportsCommand;
