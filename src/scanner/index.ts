import path from 'node:path';

import {logger} from '@sentry/effect/server';
import {Console, Effect} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';

import communityPath from '#community-path';

import type PackageSnapshot from './model.ts';
import packageReader from './package.ts';
import persistence from './persistence.ts';
import safeXmlMessage from './xml-message.ts';

type PackageRead = Awaited<ReturnType<typeof packageReader.read>>;
type ScanSummary = Readonly<{
  aircraft: number;
  airports: number;
  compiledSceneryPackages: number;
  failedPackages: number;
  liveries: number;
  packages: number;
  skippedXmlFiles: number;
  warnings: number;
}>;
type DatabaseError = Effect.Error<ReturnType<typeof persistence.save>>;
type CommunityPathError = Effect.Error<ReturnType<typeof communityPath.get>>;
type BatchResult = Readonly<{paths: readonly string[]; finished: boolean}>;
type ScanDiagnostic = Readonly<{
  'diagnostic.message': string;
  'package.name': string;
}>;
const batchSize = 16;
const readConcurrency = 4;
const firstIndex = 0;
const nextIndex = 1;
const warningDetailLimit = 5;

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

function warningDetails(
  warnings: readonly string[],
  priorWarnings: number,
  verbose: boolean
): readonly string[] {
  if (verbose) {
    return warnings;
  }

  return warnings.slice(
    firstIndex,
    Math.max(firstIndex, warningDetailLimit - priorWarnings)
  );
}

function reportDiagnostic(
  sourcePath: string,
  message: string,
  level: 'warn' | 'error'
): Effect.Effect<void> {
  return Effect.sync(() => {
    const packageName = path.basename(sourcePath);
    const diagnostic: ScanDiagnostic = {
      'diagnostic.message': message,
      'package.name': packageName,
    };
    if (level === 'warn') {
      logger.warn('Package scan warning', diagnostic);
    } else {
      logger.error('Package scan failed', diagnostic);
    }
  });
}

function reportMetadataDiagnostics(
  snapshot: PackageSnapshot,
  priorWarnings: number,
  verbose: boolean
): Effect.Effect<void> {
  return Effect.gen(function* reportPackageDiagnostics() {
    yield* Effect.forEach(
      snapshot.warnings,
      warning =>
        reportDiagnostic(snapshot.metadata.sourcePath, safeXmlMessage(warning), 'warn'),
      {discard: true}
    );
    yield* Effect.forEach(
      warningDetails(snapshot.warnings, priorWarnings, verbose),
      warning =>
        Console.error(
          `Warning for ${path.basename(snapshot.metadata.sourcePath)}: ${warning}`
        ),
      {discard: true}
    );
    if (verbose) {
      yield* Effect.forEach(
        snapshot.skippedXmlFiles,
        file =>
          Console.error(
            `Skipped unrelated XML for ${path.basename(snapshot.metadata.sourcePath)}: ${file}`
          ),
        {discard: true}
      );
    }
  });
}

function reportReads(
  reads: readonly PackageRead[],
  priorWarnings: number,
  verbose: boolean
): Effect.Effect<
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
        yield* reportDiagnostic(read.sourcePath, read.diagnosticMessage, 'error').pipe(
          Effect.andThen(() =>
            Console.error(`Skipped ${path.basename(read.sourcePath)}: ${read.message}`)
          )
        );
      } else {
        snapshots.push(read.snapshot);
        yield* reportMetadataDiagnostics(
          read.snapshot,
          priorWarnings + counts.warnings,
          verbose
        );
        counts.warnings += read.snapshot.warnings.length;
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
    summary.skippedXmlFiles += snapshot.skippedXmlFiles.length;
    if (snapshot.hasCompiledScenery) {
      summary.compiledSceneryPackages += nextIndex;
    }
  }

  return summary;
}

type WrittenRows = Effect.Success<ReturnType<typeof persistence.save>>;
const emptyRows: WrittenRows = {aircraft: [], liveries: []};

function importBatch(
  paths: readonly string[],
  prior: ScanSummary,
  verbose: boolean
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
    const result = yield* reportReads(reads, prior.warnings, verbose);
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
  iterator: Readonly<AsyncGenerator<string, void>>,
  verbose: boolean
): Effect.Effect<
  Readonly<{summary: ScanSummary; written: WrittenRows}>,
  ScanError | DatabaseError
> {
  return Effect.gen(function* importBatches() {
    let summary: ScanSummary = {
      aircraft: firstIndex,
      airports: firstIndex,
      compiledSceneryPackages: firstIndex,
      failedPackages: firstIndex,
      liveries: firstIndex,
      packages: firstIndex,
      skippedXmlFiles: firstIndex,
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
      const imported = yield* importBatch(batch.paths, summary, verbose);
      ({summary} = imported);
      appendIds(written.aircraft, imported.saved.aircraft);
      appendIds(written.liveries, imported.saved.liveries);
    }

    return {summary, written};
  });
}

function scan(
  options: Readonly<{verbose?: boolean}> = {}
): Effect.Effect<ScanSummary, ScanError | DatabaseError | CommunityPathError> {
  return Effect.gen(function* scanCommunity() {
    const verbose = options.verbose ?? false;
    const directory = yield* communityPath.get();
    yield* communityPath.validate(directory);
    const iterator = packageReader.discover(directory);
    const result = yield* Effect.acquireUseRelease(
      Effect.succeed(iterator),
      (batches: Readonly<AsyncGenerator<string, void>>) => scanBatches(batches, verbose),
      () =>
        Effect.tryPromise({
          catch: toError,
          try: async () => {
            await iterator.return();
          },
        }).pipe(Effect.orDie)
    );
    yield* persistence.link(result.written);
    if (!verbose && result.summary.warnings > warningDetailLimit) {
      yield* Console.error(
        `${result.summary.warnings - warningDetailLimit} additional warnings omitted. Run scan --verbose to show every warning.`
      );
    }

    return result.summary;
  });
}

const scanner = {scan};
export default scanner;
