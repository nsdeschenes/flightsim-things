import {Console, Effect, Redacted} from 'effect';
import {Argument, Command} from 'effect/cli';
import {Redacted as redactedArgument} from 'effect/cli/Argument';

import openaipKey from '#openaip-key';

const getCommand = Command.make('get', {}, () =>
  openaipKey
    .get()
    .pipe(
      Effect.flatMap((key: Readonly<Redacted.Redacted>) =>
        Console.log(Redacted.value(key))
      )
    )
).pipe(Command.withDescription('Print the saved OpenAIP API key'));
const setCommand = Command.make(
  'set',
  {key: redactedArgument('key').pipe(Argument.withDescription('Your OpenAIP API key'))},
  ({key}: Readonly<{key: Readonly<Redacted.Redacted>}>) =>
    openaipKey.set(key).pipe(Effect.andThen(Console.log('OpenAIP API key saved.')))
).pipe(
  Command.withDescription(
    'Save or replace the OpenAIP API key. Sign in at https://www.openaip.net/, open API clients, create a client, and copy its API key.'
  ),
  Command.withExamples([
    {
      command: 'flightsim-things openaip-key set YOUR_OPENAIP_API_KEY',
      description: 'Replace YOUR_OPENAIP_API_KEY with the key from your OpenAIP client.',
    },
  ])
);
const openaipKeyCommand = Command.make('openaip-key').pipe(
  Command.withDescription(
    'Manage the saved OpenAIP API key. Sign in at https://www.openaip.net/, open API clients, create a client, and copy its API key.'
  ),
  Command.withExamples([
    {
      command: 'flightsim-things openaip-key set YOUR_OPENAIP_API_KEY',
      description: 'Replace YOUR_OPENAIP_API_KEY with the key from your OpenAIP client.',
    },
  ]),
  Command.withSubcommands([getCommand, setCommand])
);

export default openaipKeyCommand;
