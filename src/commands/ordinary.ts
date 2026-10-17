import {Command} from 'effect/cli';

import commands from './registry.ts';

const command = Command.make('flightsim-things').pipe(
  Command.withDescription('Flight simulator tools'),
  Command.withSubcommands(commands)
);

const ordinary = {command, commands};

export default ordinary;
