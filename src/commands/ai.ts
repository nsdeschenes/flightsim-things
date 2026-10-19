import {Console, Effect} from 'effect';
import {Command, Flag} from 'effect/cli';
import {Literals as literalsFlag, Redacted as redactedFlag} from 'effect/cli/Flag';

import ai from '#ai';

type AiConfiguration = Effect.Success<ReturnType<typeof ai.get>>;

const getCommand = Command.make('get', {}, () =>
  ai
    .get()
    .pipe(
      Effect.flatMap((value: AiConfiguration) =>
        Console.log(
          `Provider: ${value.provider}\nModel: ${value.model}\nAPI key: <redacted>`
        )
      )
    )
).pipe(
  Command.withDescription('Show the saved provider and model with a masked API key')
);

const setCommand = Command.make(
  'set',
  {
    apiKey: redactedFlag('api-key').pipe(Flag.withDescription('Your provider API key')),
    model: Flag.String('model').pipe(Flag.withDescription('Your provider model ID')),
    provider: literalsFlag('provider', ai.providerIds).pipe(
      Flag.withDescription('AI provider')
    ),
  },
  (input: AiConfiguration) =>
    ai.set(input).pipe(Effect.andThen(Console.log('AI configuration saved.')))
).pipe(
  Command.withDescription('Save or replace the provider, model, and API key'),
  Command.withExamples([
    {
      command:
        'flightsim-things ai set --provider openai --model YOUR_MODEL_ID --api-key YOUR_API_KEY',
      description: 'Replace YOUR_MODEL_ID and YOUR_API_KEY with your provider values.',
    },
    {
      command: 'flightsim-things ai set --wizard',
      description: 'Prompt for all values without putting your API key in shell history.',
    },
  ])
);

const aiCommand = Command.make('ai').pipe(
  Command.withDescription('Manage AI provider configuration'),
  Command.withExamples([
    {
      command:
        'flightsim-things ai set --provider openai --model YOUR_MODEL_ID --api-key YOUR_API_KEY',
      description: 'Replace YOUR_MODEL_ID and YOUR_API_KEY. Set replaces all AI values.',
    },
    {
      command: 'flightsim-things ai set --wizard',
      description: 'Prompt for all values without putting your API key in shell history.',
    },
    {
      command: 'flightsim-things ai get',
      description: 'Show the saved provider and model with a masked key.',
    },
  ]),
  Command.withSubcommands([getCommand, setCommand])
);

export default aiCommand;
