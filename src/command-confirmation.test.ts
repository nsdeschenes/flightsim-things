import {expect, test} from 'bun:test';

import {BunServices} from '@effect/platform-bun';
import {Effect} from 'effect';

import commandConfirmation from './command-confirmation.ts';

test.each(
  [
    ['database', 'clear'],
    ['database', 'clear', 'unknown'],
    ['database', 'clear', 'all', 'aircraft'],
    ['database', 'clear', 'all', '--help'],
  ].map((args: readonly string[]) => ({args}))
)(
  'malformed clear arguments $args stop before prompting',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    for (const surface of ['Tui', 'Wizard'] as const) {
      const result = await Effect.runPromise(
        commandConfirmation.confirm(args, surface).pipe(Effect.provide(BunServices.layer))
      );
      expect(result).toBe(false);
    }
  }
);

test('ordinary TUI commands need no confirmation', async () => {
  const result = await Effect.runPromise(
    commandConfirmation
      .confirm(['airlines', 'list'], 'Tui')
      .pipe(Effect.provide(BunServices.layer))
  );
  expect(result).toBe(true);
});
