import {Console} from 'effect';
import {Command} from 'effect/cli';

import commands from './registry.ts';

const hello = Command.make('hello', {}, () => Console.log('Hello via Bun!')).pipe(
  Command.withDescription('Print a greeting')
);
const ordinaryCommands = [...commands, hello];
const command = Command.make('flightsim-things').pipe(
  Command.withDescription('Flight simulator tools'),
  Command.withSubcommands(ordinaryCommands)
);

const ordinary = {command, commands: ordinaryCommands};

export default ordinary;
