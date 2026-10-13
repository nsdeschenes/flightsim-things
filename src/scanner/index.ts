import {Console, Effect} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';

import communityPath from '#community-path';

import type PackageSnapshot from './model.ts';
import packageReader from './package.ts';
import persistence from './persistence.ts';

type PackageRead = Awaited<ReturnType<typeof packageReader.read>>;
type ScanSummary = Readonly<{
  aircraft: number;
  airports: number;
  failedPackages: number;
  liveries: number;
  packages: number;
  warnings: number;
}>;
type DatabaseError = Effect.Error<ReturnType<typeof persistence.save>>;
type CommunityPathError = Effect.Error<ReturnType<typeof communityPath.get>>;
type BatchResult = Readonly<{paths: readonly string[]; finished: boolean}>;
const batchSize = 16;
const readConcurrency = 4;
const firstIndex = 0;
const nextIndex = 1;

class ScanError extends taggedError('ScanError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function toError(cause: unknown): ScanError {
  let message = String(cause);
  if (cause instanceof Error) {
    ({message} = cause);
  }
  return new ScanError({cause, message});
}

async function readBatch(
  iterator: Readonly<AsyncGenerator<string, void>>
): Promise<BatchResult> {
  const paths: string[] = [];
  while (paths.length < batchSize) {
    const entry = await iterator.next();
    if (entry.done === true) {
      return {finished: true, paths};
    }
    paths.push(entry.value);
  }
  return {finished: false, paths};
}

function reportReads(reads: readonly PackageRead[]): Effect.Effect<
  Readonly<{
    snapshots: readonly PackageSnapshot[];
    failedPackages: number;
    warnings: number;
  }>
> {
  return Effect.gen(function* reportPackages() {
    const snapshots: PackageSnapshot[] = [];
    const counts = {failedPackages: firstIndex, warnings: firstIndex};
    for (const read of reads) {
      if (read.status === 'failure') {
        counts.failedPackages += nextIndex;
        yield* Console.error(`Skipped ${read.sourcePath}: ${read.message}`);
      } else {
        snapshots.push(read.snapshot);
        counts.warnings += read.snapshot.warnings.length;
        yield* Effect.forEach(
          read.snapshot.warnings,
          warning =>
            Console.error(`Warning for ${read.snapshot.metadata.sourcePath}: ${warning}`),
          {discard: true}
        );
      }
    }
    return {...counts, snapshots};
  });
}

function summarize(
  snapshots: readonly PackageSnapshot[],
  prior: ScanSummary
): ScanSummary {
  const summary = {...prior};
  for (const snapshot of snapshots) {
    summary.aircraft += snapshot.aircraft.length;
    summary.airports += snapshot.airports.length;
    summary.liveries += snapshot.liveries.length;
    summary.packages += nextIndex;
  }
  return summary;
}

type WrittenRows = Effect.Success<ReturnType<typeof persistence.save>>;
const emptyRows: WrittenRows = {aircraft: [], liveries: []};

function importBatch(
  paths: readonly string[],
  prior: ScanSummary
): Effect.Effect<
  Readonly<{saved: WrittenRows; summary: ScanSummary}>,
  ScanError | DatabaseError
> {
  return Effect.gen(function* importPackages() {
    const reads = yield* Effect.forEach(
      paths,
      sourcePath =>
        Effect.tryPromise({
          catch: toError,
          try: async () => {
            const read = await packageReader.read(sourcePath);
            return read;
          },
        }),
      {concurrency: readConcurrency}
    );
    const result = yield* reportReads(reads);
    const summary = summarize(result.snapshots, {
      ...prior,
      failedPackages: prior.failedPackages + result.failedPackages,
      warnings: prior.warnings + result.warnings,
    });
    let saved = emptyRows;
    if (result.snapshots.length > firstIndex) {
      saved = yield* persistence.save(result.snapshots);
      yield* Console.log(`Saved ${summary.packages} packages so far.`);
    }
    return {saved, summary};
  });
}

function appendIds(
  target: Readonly<Pick<number[], 'push'>>,
  ids: readonly number[]
): void {
  for (const id of ids) {
    target.push(id);
  }
}

function scanBatches(
  iterator: Readonly<AsyncGenerator<string, void>>
): Effect.Effect<
  Readonly<{summary: ScanSummary; written: WrittenRows}>,
  ScanError | DatabaseError
> {
  return Effect.gen(function* importBatches() {
    let summary: ScanSummary = {
      aircraft: firstIndex,
      airports: firstIndex,
      failedPackages: firstIndex,
      liveries: firstIndex,
      packages: firstIndex,
      warnings: firstIndex,
    };
    const written = {aircraft: [] as number[], liveries: [] as number[]};
    let batch: BatchResult = {finished: false, paths: []};
    while (!batch.finished) {
      batch = yield* Effect.tryPromise({
        catch: toError,
        try: async () => {
          const next = await readBatch(iterator);
          return next;
        },
      });
      const imported = yield* importBatch(batch.paths, summary);
      ({summary} = imported);
      appendIds(written.aircraft, imported.saved.aircraft);
      appendIds(written.liveries, imported.saved.liveries);
    }
    return {summary, written};
  });
}

function scan(): Effect.Effect<
  ScanSummary,
  ScanError | DatabaseError | CommunityPathError
> {
  return Effect.gen(function* scanCommunity() {
    const directory = yield* communityPath.get();
    yield* communityPath.validate(directory);
    const iterator = packageReader.discover(directory);
    const result = yield* Effect.acquireUseRelease(
      Effect.succeed(iterator),
      scanBatches,
      () =>
        Effect.tryPromise({
          catch: toError,
          try: async () => {
            await iterator.return();
          },
        }).pipe(Effect.orDie)
    );
    yield* persistence.link(result.written);
    return result.summary;
  });
}

const scanner = {scan};
export default scanner;
