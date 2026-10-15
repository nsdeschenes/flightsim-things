import {expect, test} from 'bun:test';

import {Effect, Redacted} from 'effect';
import {http, HttpResponse} from 'msw';

import openaip from './airport-enrichment-openaip.ts';
import fixtures from './airport-enrichment-test-fixtures.ts';
import testHttp from './test-http.ts';

type TestRequest = (typeof testHttp.requests)[number];

type ProviderAirport = Parameters<typeof fixtures.page>[0][number];
const key = Redacted.make(fixtures.key);
const lookup = {code: 'KAAA', field: 'icaoCode'} satisfies Parameters<
  typeof openaip.lookupAirport
>[0];
test('later exact match ignores fuzzy results and uses authenticated safe requests', async () => {
  testHttp.server.use(
    http.get(
      'https://api.core.openaip.net/api/airports',
      ({request}: Readonly<{request: TestRequest}>) => {
        const page = new URL(request.url).searchParams.get('page');
        if (page === '1') {
          return HttpResponse.json(
            fixtures.page([{icaoCode: 'KBBB'}], {
              limit: 1,
              nextPage: 2,
              totalCount: 2,
              totalPages: 2,
            })
          );
        }

        if (page === '2') {
          return HttpResponse.json(
            fixtures.page([{icaoCode: 'KAAA', name: ' Later '}], {
              limit: 1,
              page: 2,
              totalCount: 2,
              totalPages: 2,
            })
          );
        }

        throw new Error('Unexpected page');
      }
    )
  );
  expect(await Effect.runPromise(openaip.lookupAirport(lookup, key))).toEqual({
    kind: 'matched',
    metadata: {name: 'Later'},
  });
  expect(testHttp.requests).toHaveLength(2);
  const [request, laterRequest] = testHttp.requests;
  expect(request && request.url).toEqual(
    'https://api.core.openaip.net/api/airports?search=KAAA&page=1&limit=100&fields=_id%2Cname%2CicaoCode%2CiataCode%2Cgeometry%2Celevation'
  );
  expect(request && request.headers.get('x-openaip-api-key')).toBe(fixtures.key);
  expect(request && request.redirect).toBe('error');
  expect(laterRequest && laterRequest.url).toEqual(
    'https://api.core.openaip.net/api/airports?search=KAAA&page=2&limit=100&fields=_id%2Cname%2CicaoCode%2CiataCode%2Cgeometry%2Celevation'
  );
});
test.each([
  {name: 'later distinct match', second: {_id: 'other', icaoCode: 'KAAA', name: 'One'}},
  {
    name: 'conflicting provider identity',
    second: {_id: 'same', icaoCode: 'KAAA', name: 'Two'},
  },
  {name: 'unidentified match', second: {icaoCode: 'KAAA', name: 'One'}},
])(
  'a $name remains ambiguous after every page',
  async ({second}: Readonly<{second: ProviderAirport}>) => {
    testHttp.server.use(
      http.get(
        'https://api.core.openaip.net/api/airports',
        ({request}: Readonly<{request: TestRequest}>) => {
          const page = new URL(request.url).searchParams.get('page');
          if (page === '1') {
            return HttpResponse.json(
              fixtures.page([{_id: 'same', icaoCode: 'KAAA', name: 'One'}], {
                limit: 1,
                totalCount: 2,
                totalPages: 2,
              })
            );
          }

          if (page === '2') {
            return HttpResponse.json(
              fixtures.page([second], {limit: 1, page: 2, totalCount: 2, totalPages: 2})
            );
          }

          throw new Error('Unexpected page');
        }
      )
    );
    expect(await Effect.runPromise(openaip.lookupAirport(lookup, key))).toEqual({
      kind: 'ambiguous',
    });
  }
);
test('repeated provider identities deduplicate and zero metadata remains writable', async () => {
  const item: ProviderAirport = {
    _id: 'same',
    elevation: {referenceDatum: 1, unit: 0, value: 0},
    geometry: {coordinates: [0, 0], type: 'Point'},
    icaoCode: 'KAAA',
  };
  testHttp.server.use(
    http.get(
      'https://api.core.openaip.net/api/airports',
      ({request}: Readonly<{request: TestRequest}>) => {
        const page = new URL(request.url).searchParams.get('page');
        if (page === '1') {
          return HttpResponse.json(
            fixtures.page([item], {limit: 1, totalCount: 2, totalPages: 2})
          );
        }

        if (page === '2') {
          return HttpResponse.json(
            fixtures.page([item], {limit: 1, page: 2, totalCount: 2, totalPages: 2})
          );
        }

        throw new Error('Unexpected page');
      }
    )
  );
  expect(await Effect.runPromise(openaip.lookupAirport(lookup, key))).toEqual({
    kind: 'matched',
    metadata: {elevationMeters: 0, latitude: 0, longitude: 0},
  });
});
test('IATA lookup requires an exact code and fills only the alternate code', async () => {
  testHttp.server.use(
    http.get('https://api.core.openaip.net/api/airports', () =>
      HttpResponse.json(
        fixtures.page([
          {iataCode: 'AAB', icaoCode: 'KBBB', name: 'Fuzzy'},
          {iataCode: 'AAA', icaoCode: 'KAAA'},
        ])
      )
    )
  );
  expect(
    await Effect.runPromise(openaip.lookupAirport({code: 'AAA', field: 'iataCode'}, key))
  ).toEqual({
    kind: 'matched',
    metadata: {icaoCode: 'KAAA'},
  });
});
