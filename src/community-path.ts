import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {Effect, Option} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';

import configuration from '#configuration';

class CommunityPathError extends taggedError('CommunityPathError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

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

function parseCommunityPath(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0') || !path.isAbsolute(value)) {
    throw new Error(
      'Invalid Community directory. Run community-path set <path> to replace it.'
    );
  }
  return value;
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

function get(): Effect.Effect<string, CommunityPathError> {
  return Effect.gen(function* getCommunityPath() {
    const saved = yield* configuration
      .get('communityPath')
      .pipe(Effect.mapError(toError));
    if (Option.isNone(saved)) {
      return yield* new CommunityPathError({
        message: 'No Community directory is saved. Run community-path set <path>.',
      });
    }
    return yield* Effect.try({
      catch: toError,
      try: () => parseCommunityPath(saved.value),
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
    yield* configuration
      .set('communityPath', communityPath)
      .pipe(Effect.mapError(toError));
    return communityPath;
  });
}

const communityPath = {get, set, validate: validateCommunityDirectory};

export default communityPath;
