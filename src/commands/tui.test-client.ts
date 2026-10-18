import {BunRuntime, BunServices} from '@effect/platform-bun';
import {Console, Effect} from 'effect';
import {Command} from 'effect/cli';

import makeTuiCommand from './tui.ts';

const wait = Command.make('wait', {}, () =>
  Console.log('Command is running.').pipe(Effect.andThen(Effect.never))
);
const root = Command.make('flightsim-things').pipe(Command.withSubcommands([wait]));
const command = makeTuiCommand(root, '1.0.0');

const program = Command.runWith(command, {version: '1.0.0'})([]).pipe(
  Effect.provide(BunServices.layer)
);

BunRuntime.runMain(program);
