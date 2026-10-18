import {Command} from 'effect/cli';

import commands from './registry.ts';

const command = Command.make('flightsim-things').pipe(
  Command.withDescription('Flight simulator tools'),
  Command.withExamples([
    {
      command: 'flightsim-things --wizard',
      description: 'Collect inputs and confirm one command',
    },
    {
      command: 'flightsim-things ai set --wizard',
      description: 'Prompt for AI configuration',
    },
  ]),
  Command.withSubcommands(commands)
);

const ordinary = {command, commands};

export default ordinary;
