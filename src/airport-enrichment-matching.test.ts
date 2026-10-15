import {afterEach, beforeEach, expect, spyOn, test} from 'bun:test';

import {Effect, Redacted} from 'effect';

import openaip from './airport-enrichment-openaip.ts';
import fixtures from './airport-enrichment-test-fixtures.ts';

type ProviderAirport = Parameters<typeof fixtures.page>[0][number];
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;
const key = Redacted.make(fixtures.key);
const lookup = {code: 'KAAA', field: 'icaoCode'} satisfies Parameters<
  typeof openaip.lookupAirport
>[0];
beforeEach(() => {
  fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected HTTP'));
});
afterEach(() => {
  fetchSpy.mockRestore();
});
test('later exact match ignores fuzzy results and uses authenticated safe requests', async () => {
  fetchSpy
    .mockResolvedValueOnce(
      Response.json(
        fixtures.page([{icaoCode: 'KBBB'}], {
          limit: 1,
          nextPage: 2,
          totalCount: 2,
          totalPages: 2,
        })
      )
    )
    .mockResolvedValueOnce(
      Response.json(
        fixtures.page([{icaoCode: 'KAAA', name: ' Later '}], {
          limit: 1,
          page: 2,
          totalCount: 2,
          totalPages: 2,
        })
      )
    );
  expect(await Effect.runPromise(openaip.lookupAirport(lookup, key))).toEqual({
    kind: 'matched',
    metadata: {name: 'Later'},
  });
  expect(fetchSpy).toHaveBeenCalledTimes(2);
  const [input, options] = fetchSpy.mock.calls[0] ?? [];
  expect(input).toEqual(
    new URL(
      'https://api.core.openaip.net/api/airports?search=KAAA&page=1&limit=100&fields=_id%2Cname%2CicaoCode%2CiataCode%2Cgeometry%2Celevation'
    )
  );
  expect(options).toMatchObject({
    headers: {'x-openaip-api-key': fixtures.key},
    redirect: 'error',
  });
  const [laterInput] = fetchSpy.mock.calls[1] ?? [];
  expect(laterInput).toEqual(
    new URL(
      'https://api.core.openaip.net/api/airports?search=KAAA&page=2&limit=100&fields=_id%2Cname%2CicaoCode%2CiataCode%2Cgeometry%2Celevation'
    )
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
    fetchSpy
      .mockResolvedValueOnce(
        Response.json(
          fixtures.page([{_id: 'same', icaoCode: 'KAAA', name: 'One'}], {
            limit: 1,
            totalCount: 2,
            totalPages: 2,
          })
        )
      )
      .mockResolvedValueOnce(
        Response.json(
          fixtures.page([second], {limit: 1, page: 2, totalCount: 2, totalPages: 2})
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
  fetchSpy
    .mockResolvedValueOnce(
      Response.json(fixtures.page([item], {limit: 1, totalCount: 2, totalPages: 2}))
    )
    .mockResolvedValueOnce(
      Response.json(
        fixtures.page([item], {limit: 1, page: 2, totalCount: 2, totalPages: 2})
      )
    );
  expect(await Effect.runPromise(openaip.lookupAirport(lookup, key))).toEqual({
    kind: 'matched',
    metadata: {elevationMeters: 0, latitude: 0, longitude: 0},
  });
});
test('IATA lookup requires an exact code and fills only the alternate code', async () => {
  fetchSpy.mockResolvedValueOnce(
    Response.json(
      fixtures.page([
        {iataCode: 'AAB', icaoCode: 'KBBB', name: 'Fuzzy'},
        {iataCode: 'AAA', icaoCode: 'KAAA'},
      ])
    )
  );
  expect(
    await Effect.runPromise(openaip.lookupAirport({code: 'AAA', field: 'iataCode'}, key))
  ).toEqual({
    kind: 'matched',
    metadata: {icaoCode: 'KAAA'},
  });
});
