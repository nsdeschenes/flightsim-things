import {createAnthropic} from '@ai-sdk/anthropic';
import {createGoogle} from '@ai-sdk/google';
import {createOpenAI} from '@ai-sdk/openai';
import type {LanguageModel, ToolSet} from 'ai';
import {Effect, Option, Record, Redacted, Schema} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';
import {
  Literals as literals,
  RedactedFromValue as redactedFromValue,
  Struct as struct,
} from 'effect/Schema';

import configuration from '#configuration';

type ProviderClient = Readonly<{model: LanguageModel; tools: ToolSet}>;
type SearchSource = Readonly<{id: string; title: string; url: string}>;
type SearchResult = Readonly<{text: string; sources: readonly SearchSource[]}>;

const providers = {
  anthropic: (modelId: string, apiKey: string): ProviderClient => {
    const client = createAnthropic({apiKey});
    return {
      model: client(modelId),
      tools: {web_search: client.tools.webSearch_20250305({maxUses: 5})},
    };
  },
  google: (modelId: string, apiKey: string): ProviderClient => {
    const client = createGoogle({apiKey});
    return {
      model: client(modelId),
      tools: {google_search: client.tools.googleSearch({})},
    };
  },
  openai: (modelId: string, apiKey: string): ProviderClient => {
    const client = createOpenAI({apiKey});
    return {
      model: client(modelId),
      tools: {web_search: client.tools.webSearch({externalWebAccess: true})},
    };
  },
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
      try: () =>
        providers[value.provider](value.model, Redacted.value(value.apiKey)).model,
    });
  });
}

const AiSearchError = taggedError('AiSearchError')<{readonly message: string}>;

function searchError(): InstanceType<typeof AiSearchError> {
  return new AiSearchError({
    message:
      'Could not research flights with cited web sources. Check your connection and AI credentials, and run ai set with a model that supports provider web search.',
  });
}

const webUrl = /^https?:\/\//iu;
const noSources = 0;

function searchSources(
  sources: readonly Readonly<{
    sourceType: string;
    id: string;
    url?: string;
    title?: string;
  }>[]
): readonly SearchSource[] {
  const urls = new Set<string>();
  return sources.flatMap(source => {
    if (
      source.sourceType !== 'url' ||
      typeof source.url !== 'string' ||
      !webUrl.test(source.url) ||
      !URL.canParse(source.url) ||
      urls.has(source.url)
    ) {
      return [];
    }

    urls.add(source.url);
    return [{id: source.id, title: source.title ?? source.url, url: source.url}];
  });
}

function search(
  prompt: string
): Effect.Effect<
  SearchResult,
  AiConfigurationError | InstanceType<typeof AiSearchError>
> {
  return Effect.gen(function* searchWeb() {
    const value = yield* get();
    return yield* Effect.tryPromise({
      catch: searchError,
      try: async (signal: Readonly<AbortSignal>) => {
        const {generateText} = await import('ai');
        const client = providers[value.provider](
          value.model,
          Redacted.value(value.apiKey)
        );
        const result = await generateText({
          ...client,
          abortSignal: signal,
          maxRetries: 0,
          prompt,
          timeout: 60_000,
        });
        const sources = searchSources(result.sources);

        if (!result.text.trim() || sources.length === noSources) {
          throw searchError();
        }

        return {sources, text: result.text};
      },
    });
  });
}

const ai = {get, model, providerIds, search, set};

export default ai;
