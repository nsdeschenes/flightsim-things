import {Data, Effect} from 'effect';

export class FileSystemError extends Data.TaggedError('FileSystemError')<{
  message: string;
  cause: unknown;
}> {}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  message: string;
}> {}

export class OpenAipError extends Data.TaggedError('OpenAipError')<{
  message: string;
}> {}

export class KeyStoreError extends Data.TaggedError('KeyStoreError')<{
  message: string;
}> {}

export const fileSystem = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: cause =>
      new FileSystemError({
        message:
          cause instanceof Error ? cause.message : 'Could not read package metadata.',
        cause,
      }),
  }).pipe(Effect.uninterruptible);

export const validate = <A>(run: () => A) =>
  Effect.try({
    try: run,
    catch: error =>
      new ValidationError({
        message: error instanceof Error ? error.message : 'Invalid input.',
      }),
  });
