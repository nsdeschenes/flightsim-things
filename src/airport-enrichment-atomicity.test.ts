import {afterEach, beforeEach, expect, test} from 'bun:test';

import {eq} from 'drizzle-orm';
import {Effect, Option} from 'effect';

import airportEnrichment from '#airport-enrichment';
import schema from '#database-schema';

import fixtures from './airport-enrichment-test-fixtures.ts';

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
  fixture.fetch
    .mockResolvedValueOnce(
      Response.json(fixtures.page([{icaoCode: 'KAAA', name: 'New'}]))
    )
    .mockRejectedValueOnce(new Error(fixtures.key));
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
  fixture.fetch
    .mockResolvedValueOnce(
      Response.json(fixtures.page([{icaoCode: 'KAAA', name: 'New'}]))
    )
    .mockResolvedValueOnce(
      Response.json(fixtures.page([{icaoCode: 'KBBB', name: 'New'}]))
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
    async function fetchAfterMutation(): Promise<Response> {
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
      const response = await Promise.resolve(
        Response.json(fixtures.page([{icaoCode: 'KAAA', name: 'Remote'}]))
      );
      return response;
    }
    fetchAfterMutation.preconnect = globalThis.fetch.preconnect;
    fixture.fetch
      .mockImplementationOnce(fetchAfterMutation)
      .mockResolvedValueOnce(
        Response.json(
          fixtures.page([{elevation: {unit: 0, value: -2}, icaoCode: 'KBBB'}])
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
