import aiCommand from './ai.ts';
import communityPathCommand from './community-path.ts';
import databaseCommand from './database.ts';
import findFlightCommand from './find-flight.ts';
import inventory from './inventory.ts';
import openaipKeyCommand from './openaip-key.ts';
import scanCommand from './scan.ts';
import sentryCommand from './sentry.ts';

const commands = [
  aiCommand,
  inventory.commands.aircraft,
  inventory.commands.airlines,
  inventory.commands.airports,
  communityPathCommand,
  databaseCommand,
  findFlightCommand,
  inventory.commands.liveries,
  openaipKeyCommand,
  scanCommand,
  sentryCommand,
];

export default commands;
