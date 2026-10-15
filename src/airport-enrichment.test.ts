import {afterEach, beforeEach, expect, test} from 'bun:test';

import {Effect, Option} from 'effect';
import {http, HttpResponse} from 'msw';

import airportEnrichment from '#airport-enrichment';

import fixtures from './airport-enrichment-test-fixtures.ts';
import testHttp from './test-http.ts';

type TestRequest = (typeof testHttp.requests)[number];

const missing = Option.getOrNull(Option.none());
const metadata = {
  elevationMeters: -35.5,
  iataCode: 'AAA',
  latitude: -33.946111,
  longitude: 151.177222,
  name: 'Actual',
  packageId: 1,
};
let fixture: ReturnType<typeof fixtures.createFixture>;
beforeEach(() => {
  fixture = fixtures.createFixture();
});
afterEach(() => {
  fixture.dispose();
});
test('normalized ICAO groups ignore fuzzy matches, preserve identity and rerun', async () => {
  fixture.seed([{icaoCode: ' kaaa ', name: 'Old'}, {icaoCode: 'KAAA'}]);
  const response = fixtures.page([
    {icaoCode: 'KBBB', name: 'Fuzzy'},
    {
      _id: 'exact',
      elevation: {unit: 0, value: -35.5},
      geometry: {coordinates: [151.177222, -33.946111], type: 'Point'},
      iataCode: 'AAA',
      icaoCode: 'KAAA',
      name: ' Actual ',
    },
  ]);
  testHttp.server.use(
    http.get('https://api.core.openaip.net/api/airports', () =>
      HttpResponse.json(response)
    )
  );
  expect(await Effect.runPromise(airportEnrichment.enrich())).toEqual({
    airports: 2,
    ambiguous: 0,
    enriched: 2,
    skipped: 0,
    unmatched: 0,
  });
  const expected = [
    {...metadata, icaoCode: ' kaaa ', id: 1, sourceKey: 'airport-0'},
    {...metadata, icaoCode: 'KAAA', id: 2, sourceKey: 'airport-1'},
  ];
  expect(fixture.rows()).toEqual(expected);
  expect(await Effect.runPromise(airportEnrichment.enrich())).toEqual({
    airports: 2,
    ambiguous: 0,
    enriched: 2,
    skipped: 0,
    unmatched: 0,
  });
  expect(fixture.rows()).toEqual(expected);
  expect(testHttp.requests).toHaveLength(2);
});
function mockMixedLookups(): void {
  const responses = new Map([
    ['AAA', fixtures.page([{iataCode: 'AAA', icaoCode: 'KAAA', name: '   '}])],
    ['KCCC', fixtures.page([{icaoCode: 'KCCC'}])],
    ['KDDD', fixtures.page([], {totalPages: 0})],
    ['KEEE', fixtures.page([{icaoCode: 'KEEE'}, {icaoCode: 'KEEE'}])],
  ]);
  testHttp.server.use(
    http.get(
      'https://api.core.openaip.net/api/airports',
      ({request}: Readonly<{request: TestRequest}>) => {
        const search = new URL(request.url).searchParams.get('search');
        const response = responses.get(search ?? '');
        if (!response) {
          throw new Error(`Unexpected airport search ${search}`);
        }

        return HttpResponse.json(response);
      }
    )
  );
}

test('IATA fallback preserves optional metadata and summary counts are disjoint', async () => {
  fixture.seed([
    {
      elevationMeters: 42,
      iataCode: ' aaa ',
      latitude: 10,
      longitude: 20,
      name: 'Retained',
    },
    {iataCode: 'BBB', icaoCode: 'malformed'},
    {name: 'No code'},
    {icaoCode: 'KCCC'},
    {icaoCode: 'KDDD'},
    {icaoCode: 'KEEE', name: 'Ambiguous'},
  ]);
  mockMixedLookups();
  expect(await Effect.runPromise(airportEnrichment.enrich())).toEqual({
    airports: 6,
    ambiguous: 1,
    enriched: 1,
    skipped: 3,
    unmatched: 1,
  });
  expect(fixture.rows()).toMatchObject([
    {
      elevationMeters: 42,
      iataCode: ' aaa ',
      icaoCode: 'KAAA',
      latitude: 10,
      longitude: 20,
      name: 'Retained',
    },
    {iataCode: 'BBB', icaoCode: 'malformed'},
    {name: 'No code'},
    {icaoCode: 'KCCC', name: missing},
    {icaoCode: 'KDDD', name: missing},
    {icaoCode: 'KEEE', name: 'Ambiguous'},
  ]);
  expect(testHttp.requests).toHaveLength(4);
});
test('empty installed airports fail before configuration or HTTP', async () => {
  const error = await Effect.runPromise(airportEnrichment.enrich().pipe(Effect.flip));
  expect(error.message).toBe(
    'No installed airports were found. Run scan before airports enrich.'
  );
  expect(fixture.configuration).not.toHaveBeenCalled();
  expect(testHttp.requests).toEqual([]);
});
test('unusable codes skip configuration and HTTP', async () => {
  fixture.seed([
    {iataCode: 'AAA', icaoCode: 'invalid'},
    {iataCode: '12', icaoCode: ' '},
  ]);
  expect(await Effect.runPromise(airportEnrichment.enrich())).toEqual({
    airports: 2,
    ambiguous: 0,
    enriched: 0,
    skipped: 2,
    unmatched: 0,
  });
  expect(fixture.configuration).not.toHaveBeenCalled();
  expect(testHttp.requests).toEqual([]);
});
test('usable codes propagate missing saved keys before HTTP', async () => {
  fixture.seed([{icaoCode: 'KAAA'}]);
  fixture.configuration.mockReturnValue(Effect.succeedNone);
  const error = await Effect.runPromise(airportEnrichment.enrich().pipe(Effect.flip));
  expect(error.message).toContain('No OpenAIP API key is saved');
  expect(testHttp.requests).toEqual([]);
});
