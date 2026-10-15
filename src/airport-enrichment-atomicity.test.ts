import {afterEach, beforeEach, expect, test} from 'bun:test';

import {eq} from 'drizzle-orm';
import {Effect, Option} from 'effect';
import {http, HttpResponse} from 'msw';

import airportEnrichment from '#airport-enrichment';
import schema from '#database-schema';

import fixtures from './airport-enrichment-test-fixtures.ts';
import testHttp from './test-http.ts';

type TestRequest = (typeof testHttp.requests)[number];

const missing = Option.getOrNull(Option.none());
let fixture: ReturnType<typeof fixtures.createFixture>;
beforeEach(() => {
  fixture = fixtures.createFixture();
  fixture.seed([
    {icaoCode: 'KAAA', name: 'Old'},
    {icaoCode: 'KBBB', name: 'Also old'},
  ]);
});
afterEach(() => {
  fixture.dispose();
});
test('a later failed lookup leaves earlier matched airports unchanged', async () => {
  const before = fixture.rows();
  testHttp.server.use(
    http.get(
      'https://api.core.openaip.net/api/airports',
      ({request}: Readonly<{request: TestRequest}>) => {
        const search = new URL(request.url).searchParams.get('search');
        if (search === 'KAAA') {
          return HttpResponse.json(fixtures.page([{icaoCode: 'KAAA', name: 'New'}]));
        }

        return HttpResponse.error();
      }
    )
  );
  const error = await Effect.runPromise(airportEnrichment.enrich().pipe(Effect.flip));
  expect(error.message).toBe(
    'Could not request OpenAIP airports. Check your connection and retry.'
  );
  expect(fixture.rows()).toEqual(before);
});
test('a rejected later SQL update rolls back the transaction and hides its cause', async () => {
  const before = fixture.rows();
  fixture.client.run(
    `CREATE TRIGGER fail_update BEFORE UPDATE ON airports WHEN old.id = 2 BEGIN SELECT RAISE(ABORT, '${fixtures.key}'); END`
  );
  testHttp.server.use(
    http.get(
      'https://api.core.openaip.net/api/airports',
      ({request}: Readonly<{request: TestRequest}>) => {
        const search = new URL(request.url).searchParams.get('search');
        return HttpResponse.json(fixtures.page([{icaoCode: search ?? '', name: 'New'}]));
      }
    )
  );
  const error = await Effect.runPromise(airportEnrichment.enrich().pipe(Effect.flip));
  expect(error.message).toBe('Could not update the addon database. Retry the command.');
  expect(fixture.rows()).toEqual(before);
});
test.each([
  {changes: {icaoCode: 'KCCC'}, name: 'ICAO'},
  {changes: {iataCode: 'CCC'}, name: 'IATA'},
  {changes: {sourceKey: 'changed'}, name: 'source key'},
  {changes: {id: 10}, name: 'ID'},
  {changes: {packageId: 2}, name: 'package'},
])(
  'a stale $name skips that row while concurrent metadata survives',
  async ({
    changes,
  }: Readonly<{changes: Partial<typeof schema.airports.$inferInsert>}>) => {
    fixture.db.insert(schema.packages).values({sourcePath: '/Community/other'}).run();
    function respondAfterMutation(): Response {
      fixture.db
        .update(schema.airports)
        .set({...changes, name: 'Concurrent'})
        .where(eq(schema.airports.id, 1))
        .run();
      fixture.db
        .update(schema.airports)
        .set({name: 'Live'})
        .where(eq(schema.airports.id, 2))
        .run();
      return HttpResponse.json(fixtures.page([{icaoCode: 'KAAA', name: 'Remote'}]));
    }

    testHttp.server.use(
      http.get(
        'https://api.core.openaip.net/api/airports',
        ({request}: Readonly<{request: TestRequest}>) => {
          if (new URL(request.url).searchParams.get('search') === 'KAAA') {
            return respondAfterMutation();
          }

          return HttpResponse.json(
            fixtures.page([{elevation: {unit: 0, value: -2}, icaoCode: 'KBBB'}])
          );
        }
      )
    );
    expect(await Effect.runPromise(airportEnrichment.enrich())).toEqual({
      airports: 2,
      ambiguous: 0,
      enriched: 1,
      skipped: 1,
      unmatched: 0,
    });
    expect(fixture.rows().find(row => row.sourceKey === 'airport-1')).toMatchObject({
      elevationMeters: -2,
      icaoCode: 'KBBB',
      name: 'Live',
    });
    expect(fixture.rows().find(row => row.name === 'Concurrent')).toMatchObject({
      ...changes,
      elevationMeters: missing,
      name: 'Concurrent',
    });
  }
);
