import {Command} from 'effect/cli';

import {version} from '#package';

import ordinary from './ordinary.ts';
import makeTuiCommand from './tui.ts';

const command = ordinary.command.pipe(
  Command.withSubcommands([
    ...ordinary.commands,
    makeTuiCommand(ordinary.command, version),
  ])
);

export default command;
