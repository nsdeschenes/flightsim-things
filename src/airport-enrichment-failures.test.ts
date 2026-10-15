import {afterEach, beforeEach, expect, spyOn, test} from 'bun:test';

import {Effect, Fiber, Redacted} from 'effect';
import {adjust, layer} from 'effect/testing/TestClock';

import openaip from './airport-enrichment-openaip.ts';
import fixtures from './airport-enrichment-test-fixtures.ts';

type PaginationCase = Readonly<{
  label: string;
  message: string;
  overrides: NonNullable<Parameters<typeof fixtures.page>[1]>;
}>;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
const lookup = {code: 'KAAA', field: 'icaoCode'} satisfies Parameters<
  typeof openaip.lookupAirport
>[0];
const key = Redacted.make(fixtures.key);
beforeEach(() => {
  fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected HTTP'));
});
afterEach(() => {
  fetchSpy.mockRestore();
});
async function lookupFailure(): Promise<string> {
  const error = await Effect.runPromise(
    openaip.lookupAirport(lookup, key).pipe(Effect.flip)
  );
  return error.message;
}
const invalidAirports: readonly Readonly<{airport: unknown; name: string}>[] = [
  {airport: {icaoCode: 'KAAA', name: 42}, name: 'nontext metadata'},
  {airport: {icaoCode: 'kaaa'}, name: 'invalid ICAO'},
  {airport: {iataCode: 'AB12', icaoCode: 'KAAA'}, name: 'invalid IATA'},
  {airport: {geometry: {coordinates: [181, 0], type: 'Point'}}, name: 'longitude bounds'},
  {airport: {geometry: {coordinates: [0, 91], type: 'Point'}}, name: 'latitude bounds'},
  {
    airport: {geometry: {coordinates: [0, 0, 0], type: 'Point'}},
    name: 'coordinate arity',
  },
  {airport: {elevation: {unit: 1, value: 100}}, name: 'elevation unit'},
  {
    airport: {elevation: {referenceDatum: 0, unit: 0, value: 100}},
    name: 'elevation datum',
  },
];
test.each([...invalidAirports])(
  'Zod rejects $name',
  async ({airport}: Readonly<{airport: unknown}>) => {
    fetchSpy.mockResolvedValueOnce(
      Response.json({...fixtures.page([]), items: [airport]})
    );
    expect(await lookupFailure()).toBe(
      'OpenAIP returned invalid airport data. No airports were updated.'
    );
  }
);
const invalidPagination: readonly PaginationCase[] = [
  {label: 'fractional page', message: 'invalid airport data', overrides: {page: 1.5}},
  {label: 'wrong page', message: 'inconsistent pagination', overrides: {page: 2}},
  {
    label: 'looping next page',
    message: 'inconsistent pagination',
    overrides: {nextPage: 1},
  },
  {
    label: 'missing final item',
    message: 'incomplete pagination',
    overrides: {totalCount: 3},
  },
];
test.each([...invalidPagination])(
  'rejects $label',
  async ({overrides, message}: PaginationCase) => {
    fetchSpy.mockResolvedValueOnce(
      Response.json(fixtures.page([{icaoCode: 'KAAA'}, {icaoCode: 'KBBB'}], overrides))
    );
    expect(await lookupFailure()).toBe(
      `OpenAIP returned ${message}. No airports were updated.`
    );
  }
);
const laterPagination: readonly PaginationCase[] = [
  {label: 'truncated', message: 'incomplete pagination', overrides: {}},
  {
    label: 'changed total',
    message: 'inconsistent pagination',
    overrides: {totalCount: 3, totalPages: 3},
  },
];
test.each([...laterPagination])(
  'rejects $label later pagination',
  async ({overrides, message}: PaginationCase) => {
    fetchSpy
      .mockResolvedValueOnce(
        Response.json(
          fixtures.page([{icaoCode: 'KAAA'}], {limit: 1, totalCount: 2, totalPages: 2})
        )
      )
      .mockResolvedValueOnce(
        Response.json(
          fixtures.page([], {
            limit: 1,
            page: 2,
            totalCount: 2,
            totalPages: 2,
            ...overrides,
          })
        )
      );
    expect(await lookupFailure()).toBe(
      `OpenAIP returned ${message}. No airports were updated.`
    );
  }
);
test.each([
  {
    message: 'OpenAIP rejected the API key. Run openaip-key set <key> with a valid key.',
    status: 401,
  },
  {
    message: 'OpenAIP rejected the API key. Run openaip-key set <key> with a valid key.',
    status: 403,
  },
  {message: 'OpenAIP airport request failed with HTTP 503.', status: 503},
  {message: 'OpenAIP returned invalid JSON. No airports were updated.', status: 200},
])('HTTP $status hides response contents', async ({status, message}) => {
  fetchSpy.mockResolvedValueOnce(new Response(fixtures.key, {status}));
  expect(await lookupFailure()).toBe(message);
});
test('network and redirect rejection hide sensitive request details', async () => {
  fetchSpy.mockRejectedValueOnce(new Error(`Redirect rejected: ${fixtures.key}`));
  expect(await lookupFailure()).toBe(
    'Could not request OpenAIP airports. Check your connection and retry.'
  );
  const [, options] = fetchSpy.mock.calls[0] ?? [];
  expect(options).toMatchObject({redirect: 'error'});
});
test('a stalled response body times out and aborts with virtual time', async () => {
  let aborted = false;
  const started = Promise.withResolvers<boolean>();
  async function fetchStalled(
    _input: unknown,
    options?: Readonly<{signal?: Readonly<AbortSignal> | undefined | null}>
  ): Promise<Response> {
    const signal = options && options.signal;
    if (!signal) {
      throw new Error('Missing abort signal');
    }
    const stream = new ReadableStream<Uint8Array>({
      start: (
        controller: Readonly<ReadableStreamDefaultController<Uint8Array>>
      ): void => {
        signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            controller.error(new Error(fixtures.key));
          },
          {once: true}
        );
        started.resolve(true);
      },
    });
    const response = await Promise.resolve(new Response(stream));
    return response;
  }
  fetchStalled.preconnect = globalThis.fetch.preconnect;
  fetchSpy.mockImplementationOnce(fetchStalled);
  const program = Effect.gen(function* timeout() {
    const fiber = yield* openaip
      .lookupAirport(lookup, key)
      .pipe(Effect.result, Effect.forkChild);
    yield* Effect.promise(async () => {
      await started.promise;
    });
    yield* adjust('30 seconds');
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(layer()));
  const result = await Effect.runPromise(program);
  expect(result).toMatchObject({
    _tag: 'Failure',
    failure: {message: 'OpenAIP airport request timed out. Retry the command.'},
  });
  expect(aborted).toBe(true);
});
