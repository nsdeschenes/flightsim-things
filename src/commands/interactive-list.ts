import {Effect} from 'effect';
import type {Prompt} from 'effect/cli';
import {AutoComplete as autoComplete} from 'effect/cli/Prompt';
import type {QuitError} from 'effect/Terminal';

import type SavedList from './saved-list.ts';

type PreparedListing = Readonly<{
  kind: 'Listing';
  args: readonly string[];
  output: string;
}>;
const noChoices = 0;
const controlCharacters = /\p{Cc}/gu;

function sanitizeTerminalText(value: string): string {
  return Bun.stripANSI(value).replaceAll(controlCharacters, ' ');
}

function prepareSavedList(
  args: readonly string[],
  list: SavedList
): Effect.Effect<PreparedListing, QuitError, Prompt.Environment> {
  return Effect.gen(function* selectSavedRecord() {
    if (list.choices.length === noChoices) {
      return {args, kind: 'Listing', output: list.emptyMessage} as const;
    }

    const render = yield* autoComplete({
      choices: list.choices.map(choice => ({
        ...choice,
        description: sanitizeTerminalText(choice.description ?? ''),
        title: sanitizeTerminalText(choice.title),
      })),
      message: list.message,
    });
    return {args, kind: 'Listing', output: render()} as const;
  });
}

const interactiveList = {prepare: prepareSavedList};

export default interactiveList;
