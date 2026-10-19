import {Console, Effect} from 'effect';
import {Prompt} from 'effect/cli';
import type {QuitError} from 'effect/Terminal';

import type clearTables from './commands/database-clear-targets.ts';

type ClearTarget = (typeof clearTables)[number]['name'] | 'all';
type ConfirmationRequest =
  | Readonly<{kind: 'Ordinary' | 'InvalidClear'}>
  | Readonly<{kind: 'DatabaseClear'; target: ClearTarget}>;
const consequences: Readonly<Record<ClearTarget, string>> = {
  aircraft:
    'This clears all saved aircraft. Saved liveries are kept, with their aircraft links removed. Saved packages, airports, and airlines are kept.',
  airlines:
    'This clears all saved airlines. Saved liveries are kept, with their airline links removed. Saved packages, aircraft, and airports are kept.',
  airports:
    'This clears all saved airports. Saved packages, aircraft, airlines, and liveries are kept.',
  all: 'This clears all saved packages, aircraft, airports, liveries, and airlines.',
  liveries:
    'This clears all saved liveries. Saved packages, aircraft, airports, and airlines are kept.',
  packages:
    'This clears all saved packages and their aircraft, airports, and liveries. Saved airlines are kept.',
};
const clearArgumentCount = 3;
const {Confirm: confirmPrompt} = Prompt;

function isClearTarget(target: string | undefined): target is ClearTarget {
  return typeof target === 'string' && Object.hasOwn(consequences, target);
}

function recognize(args: readonly string[]): ConfirmationRequest {
  const [group, command, target] = args;
  if (group !== 'database' || command !== 'clear') {
    return {kind: 'Ordinary'};
  }

  if (args.length !== clearArgumentCount || !isClearTarget(target)) {
    return {kind: 'InvalidClear'};
  }

  return {kind: 'DatabaseClear', target};
}

function confirm(
  args: readonly string[],
  surface: 'Tui' | 'Wizard'
): Effect.Effect<boolean, QuitError, Prompt.Environment> {
  return Effect.gen(function* confirmCollectedCommand() {
    const request = recognize(args);
    if (request.kind === 'InvalidClear') {
      return false;
    }

    let message = 'Run this command?';
    if (request.kind === 'DatabaseClear') {
      yield* Console.log(
        `${consequences[request.target]} Settings and addon files are preserved.`
      );
      message = 'Clear these saved records?';
    } else if (surface === 'Tui') {
      return true;
    }

    return yield* Prompt.run(confirmPrompt({initial: false, message}));
  });
}

const commandConfirmation = {confirm};

export default commandConfirmation;
