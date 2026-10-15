import {Effect, Option, Redacted} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';

import configuration from '#configuration';

const invalidKeyCharacters = /[\s\p{Cc}]/u;

class OpenAipKeyError extends taggedError('OpenAipKeyError')<{
  readonly message: string;
}> {}

function configurationError(): OpenAipKeyError {
  return new OpenAipKeyError({
    message:
      'Could not access CLI configuration. Check directory permissions and ensure config.json contains a JSON object. Repair the file before trying again; existing settings have been preserved.',
  });
}

function validate(value: unknown): Effect.Effect<Redacted.Redacted, OpenAipKeyError> {
  if (typeof value !== 'string' || value === '' || invalidKeyCharacters.test(value)) {
    return Effect.fail(
      new OpenAipKeyError({
        message:
          'The OpenAIP API key must be nonempty and contain no whitespace or control characters. Run openaip-key set <key> with the key you copied.',
      })
    );
  }

  return Effect.succeed(Redacted.make(value));
}

function get(): Effect.Effect<Redacted.Redacted, OpenAipKeyError> {
  return Effect.gen(function* getOpenAipKey() {
    const saved = yield* configuration
      .get('openaipApiKey')
      .pipe(Effect.mapError(configurationError));
    if (Option.isNone(saved)) {
      return yield* new OpenAipKeyError({
        message:
          'No OpenAIP API key is saved. Sign in at https://www.openaip.net/, open API clients, create a client, and copy its API key. Run openaip-key set <key> to save it.',
      });
    }

    return yield* validate(saved.value);
  });
}

function set(input: Readonly<Redacted.Redacted>): Effect.Effect<void, OpenAipKeyError> {
  return Effect.gen(function* setOpenAipKey() {
    const key = yield* validate(Redacted.value(input));
    yield* configuration
      .set('openaipApiKey', Redacted.value(key))
      .pipe(Effect.mapError(configurationError));
  });
}

const openaipKey = {get, set};

export default openaipKey;
