import {Console} from 'effect';
import {Command} from 'effect/cli';

import commands from './registry.ts';

const hello = Command.make('hello', {}, () => Console.log('Hello via Bun!')).pipe(
  Command.withDescription('Print a greeting')
);
const command = Command.make('flightsim-things').pipe(
  Command.withDescription('Flight simulator tools'),
  Command.withSubcommands([...commands, hello])
);

export default command;
