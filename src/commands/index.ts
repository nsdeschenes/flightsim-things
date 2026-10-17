import {Command} from 'effect/cli';

import ordinary from './ordinary.ts';
import makeTuiCommand from './tui.ts';

const command = ordinary.command.pipe(
  Command.withSubcommands([...ordinary.commands, makeTuiCommand(ordinary.command)])
);

export default command;
