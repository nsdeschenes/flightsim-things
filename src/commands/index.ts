import {Console} from 'effect';
import {Command} from 'effect/cli';

import aiCommand from './ai.ts';
import aircraftCommand from './aircraft.ts';
import airportsCommand from './airports.ts';
import communityPathCommand from './community-path.ts';
import openaipKeyCommand from './openaip-key.ts';
import scanCommand from './scan.ts';
import sentryCommand from './sentry.ts';

const hello = Command.make('hello', {}, () => Console.log('Hello via Bun!')).pipe(
  Command.withDescription('Print a greeting')
);
const command = Command.make('flightsim-things').pipe(
  Command.withDescription('Flight simulator tools'),
  Command.withSubcommands([
    aiCommand,
    aircraftCommand,
    airportsCommand,
    communityPathCommand,
    hello,
    openaipKeyCommand,
    scanCommand,
    sentryCommand,
  ])
);

export default command;
