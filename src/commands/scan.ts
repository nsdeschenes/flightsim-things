import {Console, Effect} from 'effect';
import {Command} from 'effect/cli';
import {TaggedError as taggedError} from 'effect/Data';

import scanner from '#scanner';

class ScanIncompleteError extends taggedError('ScanIncompleteError')<{
  readonly message: string;
}> {}
const noFailures = 0;

const scanCommand = Command.make('scan', {}, () =>
  Effect.gen(function* scanCommunity() {
    const summary = yield* scanner.scan();
    yield* Console.log(
      `Scanned ${summary.packages} packages, ${summary.aircraft} aircraft, ${summary.airports} airports, and ${summary.liveries} liveries. ${summary.failedPackages} packages failed. ${summary.warnings} warnings.`
    );
    if (summary.failedPackages > noFailures) {
      return yield* new ScanIncompleteError({
        message: `${summary.failedPackages} packages could not be scanned. Fix the reported metadata and run scan again.`,
      });
    }

    return yield* Effect.void;
  })
).pipe(
  Command.withDescription('Scan the saved Community directory into the addon database')
);

export default scanCommand;
