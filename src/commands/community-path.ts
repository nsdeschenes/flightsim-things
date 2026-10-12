import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {Console, Effect} from 'effect';
import {Argument, Command} from 'effect/cli';
import {TaggedError as taggedError} from 'effect/Data';

type Configuration = Readonly<{communityPath: string}>;
type TemporaryFile = Readonly<
  Pick<Awaited<ReturnType<typeof fs.open>>, 'close' | 'writeFile'>
>;

class CommunityPathError extends taggedError('CommunityPathError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const configurationDirectory = path.join(os.homedir(), '.flightsim-things');
const configurationFile = path.join(configurationDirectory, 'config.json');
const privateFileMode = 0o600;

function toError(error: unknown): CommunityPathError {
  if (error instanceof CommunityPathError) {
    return error;
  }
  if (error instanceof Error) {
    return new CommunityPathError({cause: error, message: error.message});
  }
  return new CommunityPathError({
    cause: error,
    message: String(error),
  });
}

function readConfiguration(): Effect.Effect<string, CommunityPathError> {
  return Effect.tryPromise({
    catch: error => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return new CommunityPathError({
          cause: error,
          message: 'No Community directory is saved. Run community-path set <path>.',
        });
      }
      return toError(error);
    },
    try: async () => {
      const contents = await fs.readFile(configurationFile, 'utf8');
      return contents;
    },
  });
}

function parseConfiguration(contents: string): string {
  let configuration: unknown;
  try {
    configuration = JSON.parse(contents);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(
        `Invalid JSON in ${configurationFile}. Run community-path set <path> to replace it.`,
        {cause: error}
      );
    }
    throw error;
  }

  if (
    typeof configuration !== 'object' ||
    configuration === null ||
    !('communityPath' in configuration) ||
    typeof configuration.communityPath !== 'string' ||
    configuration.communityPath.includes('\0') ||
    !path.isAbsolute(configuration.communityPath)
  ) {
    throw new Error(
      `Invalid Community directory in ${configurationFile}. Run community-path set <path> to replace it.`
    );
  }

  return configuration.communityPath;
}

function resolveCommunityPath(input: string): string {
  if (input === '') {
    throw new Error(
      'The Community directory path is empty. Provide an existing directory.'
    );
  }

  let expandedPath = input;
  if (input === '~') {
    expandedPath = os.homedir();
  } else if (input.startsWith('~/') || input.startsWith(`~${path.sep}`)) {
    expandedPath = path.join(os.homedir(), input.slice('~/'.length));
  }
  return path.resolve(expandedPath);
}

function validateCommunityDirectory(
  communityPath: string
): Effect.Effect<void, CommunityPathError> {
  return Effect.gen(function* checkCommunityDirectory() {
    const directory = yield* Effect.tryPromise({
      catch: error => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          return new CommunityPathError({
            cause: error,
            message: `Community directory does not exist: ${communityPath}`,
          });
        }
        return toError(error);
      },
      try: async () => {
        const stats = await fs.stat(communityPath);
        return stats;
      },
    });
    if (!directory.isDirectory()) {
      return yield* new CommunityPathError({
        message: `Community path is not a directory: ${communityPath}`,
      });
    }
    return yield* Effect.void;
  });
}

function cleanupTemporaryFile(
  file: TemporaryFile,
  temporaryFile: string
): Effect.Effect<void> {
  return Effect.gen(function* removeTemporaryFile() {
    yield* Effect.ignore(
      Effect.tryPromise({
        catch: toError,
        try: async () => {
          await file.close();
        },
      })
    );
    yield* Effect.ignore(
      Effect.tryPromise({
        catch: toError,
        try: async () => {
          await fs.rm(temporaryFile, {force: true});
        },
      })
    );
  });
}

function writeConfig(config: Configuration): Effect.Effect<void, CommunityPathError> {
  return Effect.gen(function* saveConfiguration() {
    yield* Effect.tryPromise({
      catch: toError,
      try: async () => {
        await fs.mkdir(configurationDirectory, {recursive: true});
      },
    });
    const temporaryFile = yield* Effect.try({
      catch: toError,
      try: () => path.join(configurationDirectory, `config.${crypto.randomUUID()}.tmp`),
    });
    yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        catch: toError,
        try: async () => {
          const file = await fs.open(temporaryFile, 'wx', privateFileMode);
          return file;
        },
      }),
      (file: TemporaryFile) =>
        Effect.gen(function* persistConfiguration() {
          yield* Effect.tryPromise({
            catch: toError,
            try: async () => {
              await file.writeFile(`${JSON.stringify(config)}\n`, 'utf8');
            },
          });
          yield* Effect.tryPromise({
            catch: toError,
            try: async () => {
              await file.close();
            },
          });
          yield* Effect.tryPromise({
            catch: toError,
            try: async () => {
              await fs.rename(temporaryFile, configurationFile);
            },
          });
        }),
      (file: TemporaryFile, {_tag: exitTag}: Readonly<{_tag: string}>) => {
        if (exitTag === 'Failure') {
          return cleanupTemporaryFile(file, temporaryFile);
        }
        return Effect.void;
      }
    ).pipe(Effect.uninterruptible);
  });
}

function get(): Effect.Effect<string, CommunityPathError> {
  return Effect.gen(function* getCommunityPath() {
    const contents = yield* readConfiguration();
    return yield* Effect.try({
      catch: toError,
      try: () => parseConfiguration(contents),
    });
  });
}

function set(input: string): Effect.Effect<string, CommunityPathError> {
  return Effect.gen(function* setCommunityPath() {
    const communityPath = yield* Effect.try({
      catch: toError,
      try: () => resolveCommunityPath(input),
    });
    yield* validateCommunityDirectory(communityPath);
    yield* writeConfig({communityPath});
    return communityPath;
  });
}

function save({
  path: input,
}: Readonly<{path: string}>): Effect.Effect<void, CommunityPathError> {
  return set(input).pipe(Effect.flatMap(Console.log));
}

const pathArgument = {
  path: Argument.String('path').pipe(
    Argument.withDescription('An existing Community directory')
  ),
};
const saveDescription = 'Save or replace the MSFS 2024 Community directory';
const getCommand = Command.make('get', {}, () =>
  get().pipe(Effect.flatMap(Console.log))
).pipe(Command.withDescription('Print the saved Community directory'));
const setCommand = Command.make('set', pathArgument, save).pipe(
  Command.withDescription(saveDescription)
);
const updateCommand = Command.make('update', pathArgument, save).pipe(
  Command.withDescription(saveDescription)
);
const communityPathCommand = Command.make('community-path').pipe(
  Command.withDescription('Manage the saved MSFS 2024 Community directory'),
  Command.withSubcommands([getCommand, setCommand, updateCommand])
);

export default communityPathCommand;
