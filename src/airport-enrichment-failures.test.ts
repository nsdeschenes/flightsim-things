import {expect, test} from 'bun:test';

import {Effect, Fiber, Redacted} from 'effect';
import {adjust, layer} from 'effect/testing/TestClock';
import {http, HttpResponse} from 'msw';

import openaip from './airport-enrichment-openaip.ts';
import fixtures from './airport-enrichment-test-fixtures.ts';
import testHttp from './test-http.ts';

type TestRequest = (typeof testHttp.requests)[number];

type PaginationCase = Readonly<{
  label: string;
  message: string;
  overrides: NonNullable<Parameters<typeof fixtures.page>[1]>;
}>;
const lookup = {code: 'KAAA', field: 'icaoCode'} satisfies Parameters<
  typeof openaip.lookupAirport
>[0];
const key = Redacted.make(fixtures.key);
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
    testHttp.server.use(
      http.get('https://api.core.openaip.net/api/airports', () =>
        HttpResponse.json({...fixtures.page([]), items: [airport]})
      )
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
    testHttp.server.use(
      http.get('https://api.core.openaip.net/api/airports', () =>
        HttpResponse.json(
          fixtures.page([{icaoCode: 'KAAA'}, {icaoCode: 'KBBB'}], overrides)
        )
      )
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
    testHttp.server.use(
      http.get(
        'https://api.core.openaip.net/api/airports',
        ({request}: Readonly<{request: TestRequest}>) => {
          if (new URL(request.url).searchParams.get('page') === '1') {
            return HttpResponse.json(
              fixtures.page([{icaoCode: 'KAAA'}], {
                limit: 1,
                totalCount: 2,
                totalPages: 2,
              })
            );
          }

          return HttpResponse.json(
            fixtures.page([], {
              limit: 1,
              page: 2,
              totalCount: 2,
              totalPages: 2,
              ...overrides,
            })
          );
        }
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
  testHttp.server.use(
    http.get('https://api.core.openaip.net/api/airports', () =>
      HttpResponse.text(fixtures.key, {status})
    )
  );
  expect(await lookupFailure()).toBe(message);
});
test('network rejection hides sensitive request details', async () => {
  testHttp.server.use(
    http.get('https://api.core.openaip.net/api/airports', () => HttpResponse.error())
  );
  expect(await lookupFailure()).toBe(
    'Could not request OpenAIP airports. Check your connection and retry.'
  );
});
test('redirect rejection never forwards the API key to the destination', async () => {
  const destinationRequests: TestRequest[] = [];
  testHttp.server.use(
    http.get(
      'https://api.core.openaip.net/api/airports',
      () =>
        new HttpResponse(fixtures.key, {
          headers: {Location: 'https://redirect.example/airports'},
          status: 302,
        })
    ),
    http.get(
      'https://redirect.example/airports',
      ({request}: Readonly<{request: TestRequest}>) => {
        destinationRequests.push(request);
        return HttpResponse.json(fixtures.page([]));
      }
    )
  );
  expect(await lookupFailure()).toBe(
    'Could not request OpenAIP airports. Check your connection and retry.'
  );
  expect(testHttp.requests).toHaveLength(1);
  expect(testHttp.requests.map((request: TestRequest) => request.redirect)).toEqual([
    'error',
  ]);
  expect(destinationRequests).toEqual([]);
});
test('a stalled response body times out and aborts with virtual time', async () => {
  let aborted = false;
  const started = Promise.withResolvers<boolean>();
  testHttp.server.use(
    http.get(
      'https://api.core.openaip.net/api/airports',
      ({request}: Readonly<{request: TestRequest}>) => {
        const stream = new ReadableStream<Uint8Array>({
          pull: (): void => {
            started.resolve(true);
          },
          start: (
            controller: Readonly<ReadableStreamDefaultController<Uint8Array>>
          ): void => {
            request.signal.addEventListener(
              'abort',
              () => {
                aborted = true;
                controller.error(new Error(fixtures.key));
              },
              {once: true}
            );
          },
        });
        return new HttpResponse(stream);
      }
    )
  );
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
