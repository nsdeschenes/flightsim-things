import {Command} from 'effect/cli';

import commands from './registry.ts';

const command = Command.make('flightsim-things').pipe(
  Command.withDescription('Flight simulator tools'),
  Command.withExamples([
    {
      command: 'flightsim-things community-path set "C:/Flight Simulator/Community"',
      description:
        'Start setup with your existing Community directory in place of the quoted path. Replace flightsim-things with your executable, such as ./filename on Unix or .\\filename.exe on Windows.',
    },
    {
      command: 'flightsim-things scan',
      description: 'Scan the saved directory. AI and Sentry configuration are optional.',
    },
    {
      command: 'flightsim-things find-flight --help',
      description: 'See flight search modes and saved inventory requirements.',
    },
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
