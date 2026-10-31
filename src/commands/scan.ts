import {Console, Effect, ErrorReporter} from 'effect';
import {Command, Flag} from 'effect/cli';
import {TaggedError as taggedError} from 'effect/Data';

import scanner from '#scanner';

class ScanIncompleteError extends taggedError('ScanIncompleteError')<{
  readonly message: string;
}> {
  public override readonly [ErrorReporter.ignore] = true;
}
const noFailures = 0;

const scanCommand = Command.make(
  'scan',
  {
    verbose: Flag.Boolean('verbose').pipe(
      Flag.withDefault(false),
      Flag.withDescription('Show every warning and skipped XML file')
    ),
  },
  ({verbose}) =>
    Effect.gen(function* scanCommunity() {
      const summary = yield* scanner.scan({verbose});
      yield* Console.log(
        `Scanned ${summary.packages} packages, ${summary.aircraft} aircraft, ${summary.airports} airports, and ${summary.liveries} liveries. ${summary.failedPackages} packages failed. ${summary.warnings} warnings.`
      );
      if (summary.compiledSceneryPackages > noFailures) {
        yield* Console.log(
          `Airport coverage may be incomplete in ${summary.compiledSceneryPackages} packages with compiled scenery. BGL content is not decoded, even when XML, AirportServices, or package-name fallback discovers airports.`
        );
      }

      if (summary.skippedXmlFiles > noFailures) {
        yield* Console.log(
          `Skipped ${summary.skippedXmlFiles} unrelated XML files in imported packages. Run scan --verbose to show file paths.`
        );
      }

      if (summary.failedPackages > noFailures) {
        return yield* new ScanIncompleteError({
          message: `${summary.failedPackages} packages could not be scanned. Fix the reported metadata and run scan again.`,
        });
      }

      return yield* Effect.void;
    })
).pipe(
  Command.withDescription('Scan the saved Community directory into the addon database'),
  Command.withExamples([
    {
      command: 'flightsim-things scan',
      description: 'Scan after saving an existing directory with community-path set.',
    },
    {
      command: 'flightsim-things scan --verbose',
      description:
        'Scan the saved directory and show every warning and skipped XML file.',
    },
  ])
);

export default scanCommand;
