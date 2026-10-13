import {Console, Effect} from 'effect';
import {Argument, Command} from 'effect/cli';

import communityPath from '#community-path';

function save({
  path: input,
}: Readonly<{path: string}>): Effect.Effect<
  void,
  Effect.Error<ReturnType<typeof communityPath.set>>
> {
  return communityPath.set(input).pipe(Effect.flatMap(Console.log));
}

const pathArgument = {
  path: Argument.String('path').pipe(
    Argument.withDescription('An existing Community directory')
  ),
};
const saveDescription = 'Save or replace the MSFS 2024 Community directory';
const getCommand = Command.make('get', {}, () =>
  communityPath.get().pipe(Effect.flatMap(Console.log))
).pipe(Command.withDescription('Print the saved Community directory'));
const setCommand = Command.make('set', pathArgument, save).pipe(
  Command.withDescription(saveDescription)
);
const updateCommand = Command.make('update', pathArgument, save).pipe(
  Command.withDescription(saveDescription)
);
const communityPathCommand = Command.make('community-path').pipe(
  Command.withDescription('Manage the saved MSFS 2024 Community directory'),
  Command.withSubcommands([getCommand, setCommand, updateCommand])
);

export default communityPathCommand;
