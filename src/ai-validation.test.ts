import {afterEach, beforeEach, expect, spyOn, test} from 'bun:test';

import {Effect, Redacted} from 'effect';

import ai from '#ai';
import configuration from '#configuration';

let save: ReturnType<typeof spyOn<typeof configuration, 'set'>>;
let read: ReturnType<typeof spyOn<typeof configuration, 'get'>>;

beforeEach(() => {
  save = spyOn(configuration, 'set').mockReturnValue(Effect.void);
  read = spyOn(configuration, 'get');
});

afterEach(() => {
  save.mockRestore();
  read.mockRestore();
});

const fields: readonly ('model' | 'apiKey')[] = ['model', 'apiKey'];
const invalidTokens = [
  '',
  ' ',
  'private token',
  'private\ttoken',
  'private\ntoken',
  'private\u007Ftoken',
  'private\u0085token',
  'private-token\n',
];
const invalidInputs = fields.flatMap(field =>
  invalidTokens.map(value => ({field, value}))
);

test.each(invalidInputs)(
  '$field validation rejects invalid token %# before storage',
  async ({field, value}: Readonly<{field: 'model' | 'apiKey'; value: string}>) => {
    let model = 'opaque-model';
    let apiKey = Redacted.make('private-valid-key');
    if (field === 'model') {
      model = value;
    } else {
      apiKey = Redacted.make(value);
    }

    const error = await Effect.runPromise(
      ai.set({apiKey, model, provider: 'openai'}).pipe(Effect.flip)
    );
    expect(error.message).toContain('no whitespace or control characters');
    expect(JSON.stringify(error)).not.toContain('private');
    expect(save).not.toHaveBeenCalled();
  }
);

test.each([
  42,
  {},
  {apiKey: 'private-key', model: 'valid', provider: 'unknown'},
  {apiKey: 'private-key', model: '', provider: 'openai'},
  {apiKey: 'private-key', model: 'private model', provider: 'openai'},
  {apiKey: 'private key', model: 'valid', provider: 'openai'},
  {apiKey: 42, model: 'valid', provider: 'openai'},
])('saved AI configuration %# fails safely without a write', async (value: unknown) => {
  read.mockReturnValue(Effect.succeedSome(value));
  const error = await Effect.runPromise(ai.get().pipe(Effect.flip));
  expect(error.message).toContain('ai set --provider');
  expect(JSON.stringify(error)).not.toContain('private');
  expect(save).not.toHaveBeenCalled();
});
