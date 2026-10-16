import {createAnthropic} from '@ai-sdk/anthropic';
import {createGoogle} from '@ai-sdk/google';
import {createOpenAI} from '@ai-sdk/openai';
import type {LanguageModel} from 'ai';
import {Effect, Option, Record, Redacted, Schema} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';
import {
  Literals as literals,
  RedactedFromValue as redactedFromValue,
  Struct as struct,
} from 'effect/Schema';

import configuration from '#configuration';

const providers = {
  anthropic: (modelId: string, apiKey: string): LanguageModel =>
    createAnthropic({apiKey})(modelId),
  google: (modelId: string, apiKey: string): LanguageModel =>
    createGoogle({apiKey})(modelId),
  openai: (modelId: string, apiKey: string): LanguageModel =>
    createOpenAI({apiKey})(modelId),
};
const providerIds = Record.keys(providers);
const invalidCharacters = /[\s\p{Cc}]/u;
const token = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.makeFilter(value => !invalidCharacters.test(value))
);
const storedConfiguration = struct({
  apiKey: redactedFromValue(token),
  model: token,
  provider: literals(providerIds),
});

type DeepReadonly<Value> = Value extends object
  ? Value extends (...args: readonly never[]) => unknown
    ? Value
    : {readonly [Key in keyof Value]: DeepReadonly<Value[Key]>}
  : Value;
type AiConfiguration = DeepReadonly<typeof storedConfiguration.Type>;

class AiConfigurationError extends taggedError('AiConfigurationError')<{
  readonly message: string;
}> {}

function configurationError(): AiConfigurationError {
  return new AiConfigurationError({
    message:
      'Could not access CLI configuration. Check directory permissions and ensure config.json contains a JSON object. Repair the file before trying again; existing settings have been preserved.',
  });
}

function validationError(): AiConfigurationError {
  return new AiConfigurationError({
    message:
      'AI configuration requires a supported provider and a nonempty model and API key with no whitespace or control characters. Run ai set --provider <provider> --model <model> --api-key <key>.',
  });
}

function get(): Effect.Effect<AiConfiguration, AiConfigurationError> {
  return Effect.gen(function* getAiConfiguration() {
    const saved = yield* configuration
      .get('ai')
      .pipe(Effect.mapError(configurationError));
    if (Option.isNone(saved)) {
      return yield* new AiConfigurationError({
        message:
          'No AI configuration is saved. Run ai set --provider <provider> --model <model> --api-key <key>.',
      });
    }

    return yield* Schema.decodeUnknownEffect(storedConfiguration)(saved.value).pipe(
      Effect.mapError(validationError)
    );
  });
}

function set(input: AiConfiguration): Effect.Effect<void, AiConfigurationError> {
  return Effect.gen(function* setAiConfiguration() {
    const value = yield* Schema.decodeEffect(Schema.toType(storedConfiguration))(
      input
    ).pipe(Effect.mapError(validationError));
    yield* configuration
      .set('ai', {
        apiKey: Redacted.value(value.apiKey),
        model: value.model,
        provider: value.provider,
      })
      .pipe(Effect.mapError(configurationError));
  });
}

function model(): Effect.Effect<LanguageModel, AiConfigurationError> {
  return Effect.gen(function* getAiModel() {
    const value = yield* get();
    return yield* Effect.try({
      catch: () =>
        new AiConfigurationError({
          message:
            'Could not create the AI model. Run ai set with your provider settings.',
        }),
      try: () => providers[value.provider](value.model, Redacted.value(value.apiKey)),
    });
  });
}

const ai = {get, model, providerIds, set};

export default ai;
