import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {Console, Effect, Option} from 'effect';
import {Prompt} from 'effect/cli';
import type {QuitError} from 'effect/Terminal';

import communityPath from '#community-path';

type Operation = 'set' | 'update';
type Prepared =
  | Readonly<{kind: 'Back'}>
  | Readonly<{
      kind: 'Args';
      args: readonly ['community-path', Operation, string];
    }>;
type BrowserStart =
  | Readonly<{kind: 'Available'; startingPath: string; default?: string}>
  | Readonly<{kind: 'Unavailable'}>;
type Source = 'browse' | 'manual' | 'back';
const {Select: select, String: stringPrompt, File: filePrompt} = Prompt;
const maxPerPage = 8;

function canReadDirectory(directory: string): Effect.Effect<boolean> {
  return Effect.tryPromise(async () => {
    const stats = await fs.stat(directory);
    if (!stats.isDirectory()) {
      return false;
    }

    await fs.readdir(directory);
    return true;
  }).pipe(Effect.orElseSucceed(() => false));
}

function savedBrowserStart(saved: string): Effect.Effect<Option.Option<BrowserStart>> {
  return Effect.gen(function* checkSavedDirectory() {
    const parent = path.dirname(saved);
    if ((yield* canReadDirectory(saved)) && (yield* canReadDirectory(parent))) {
      if (parent === saved) {
        return Option.some({kind: 'Available', startingPath: saved});
      }

      return Option.some({default: saved, kind: 'Available', startingPath: parent});
    }

    yield* Console.error(
      'The saved Community directory cannot be browsed. Choose a replacement.'
    );
    return Option.none();
  });
}

function browserStart(): Effect.Effect<BrowserStart> {
  return Effect.gen(function* findBrowserStart() {
    const saved = yield* communityPath.find().pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeedNone,
          onSome: savedBrowserStart,
        })
      ),
      Effect.catch(({message}: Readonly<{message: string}>) =>
        Console.error(message).pipe(Effect.as(Option.none<BrowserStart>()))
      )
    );
    if (Option.isSome(saved)) {
      return saved.value;
    }

    for (const directory of new Set([process.cwd(), os.homedir()])) {
      if (yield* canReadDirectory(directory)) {
        return {kind: 'Available', startingPath: directory};
      }
    }

    yield* Console.error('Could not open a starting directory. Enter a path instead.');
    return {kind: 'Unavailable'};
  });
}

function chooseSource(start: BrowserStart): Prompt.Prompt<Source> {
  const choices: {title: string; value: Source}[] = [];
  if (start.kind === 'Available') {
    choices.push({title: 'Browse directories', value: 'browse'});
  }

  choices.push({title: 'Enter a path', value: 'manual'}, {title: 'back', value: 'back'});
  return select({choices, message: 'Community directory'});
}

function browse(
  start: Extract<BrowserStart, {kind: 'Available'}>
): Effect.Effect<Option.Option<string>, QuitError, Prompt.Environment> {
  return Effect.gen(function* browseDirectories() {
    yield* Console.log(
      'For folders with subdirectories, press y to enter or n to select.'
    );
    // Prompt.File turns filesystem failures into defects. Keep cancellation typed.
    return yield* filePrompt({
      default: start.default,
      maxPerPage,
      message: 'Choose a Community directory',
      startingPath: start.startingPath,
      type: 'directory',
    }).pipe(
      Effect.asSome,
      Effect.catchDefect(() =>
        Console.error('Could not browse this directory. Enter a path or try again.').pipe(
          Effect.as(Option.none<string>())
        )
      )
    );
  });
}

function readPath(
  source: Exclude<Source, 'back'>,
  start: BrowserStart
): Effect.Effect<Option.Option<string>, QuitError, Prompt.Environment> {
  if (source === 'manual') {
    return stringPrompt({message: 'Path'}).pipe(Effect.asSome);
  }

  if (start.kind === 'Available') {
    return browse(start);
  }

  return Effect.succeedNone;
}

function prepare(
  operation: Operation
): Effect.Effect<Prepared, QuitError, Prompt.Environment> {
  return Effect.gen(function* prepareCommunityDirectory() {
    const start = yield* browserStart();
    while (true) {
      const source = yield* chooseSource(start);
      if (source === 'back') {
        return {kind: 'Back'};
      }

      const selected = yield* readPath(source, start);
      if (Option.isSome(selected)) {
        return {args: ['community-path', operation, selected.value], kind: 'Args'};
      }
    }
  });
}

const communityDirectory = {prepare};

export default communityDirectory;
