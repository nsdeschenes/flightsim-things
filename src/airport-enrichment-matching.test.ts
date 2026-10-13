import {afterEach, expect, test} from 'bun:test';

import fixtures from './airport-enrichment-test-fixtures.ts';

const cliTimeout = 60_000;
const active: Awaited<ReturnType<typeof fixtures.createFixture>>[] = [];
afterEach(async () => {
  for (const fixture of active) {
    await fixture.dispose();
  }
  active.length = 0;
});
async function create(
  rows: Parameters<typeof fixtures.createFixture>[0],
  saveKey = true
): Promise<Awaited<ReturnType<typeof fixtures.createFixture>>> {
  const fixture = await fixtures.createFixture(rows, saveKey);
  active.push(fixture);
  return fixture;
}
function metadata(row: Readonly<Record<string, unknown>>): unknown {
  const {elevation_meters, iata_code, icao_code, latitude, longitude, name} = row;
  return {elevation_meters, iata_code, icao_code, latitude, longitude, name};
}
test(
  'identical provider IDs deduplicate across pages and zero values persist',
  async () => {
    const fixture = await create([
      {elevationMeters: 42, icaoCode: 'KAAA', latitude: 10, longitude: 20},
    ]);
    const item = {
      _id: 'same',
      elevation: {referenceDatum: 1, unit: 0, value: 0},
      geometry: {coordinates: [0, 0], type: 'Point'},
      icaoCode: 'KAAA',
    };
    expect(
      await fixture.enrich([
        {
          body: fixtures.page([item], {limit: 1, totalCount: 2, totalPages: 2}),
          code: 'KAAA',
        },
        {
          body: fixtures.page([item], {limit: 1, page: 2, totalCount: 2, totalPages: 2}),
          code: 'KAAA',
          page: 2,
        },
      ])
    ).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'Enriched 1 of 1 airports. 0 unmatched, 0 ambiguous, 0 skipped.\n',
    });
    expect(JSON.stringify(fixture.query().map(row => metadata(row)))).toBe(
      '[{"elevation_meters":0,"iata_code":null,"icao_code":"KAAA","latitude":0,"longitude":0,"name":null}]'
    );
  },
  cliTimeout
);
test.each([
  {
    items: [
      {iataCode: 'AAA', name: 'One'},
      {iataCode: 'AAA', name: 'One'},
    ],
  },
  {
    items: [
      {_id: 'same', iataCode: 'AAA', name: 'One'},
      {_id: 'same', iataCode: 'AAA', name: 'Two'},
    ],
  },
])(
  'unidentified or conflicting identities keep IATA matches ambiguous %#',
  async ({items}: Readonly<{items: readonly unknown[]}>) => {
    const fixture = await create([{iataCode: 'AAA', name: 'Retained'}]);
    expect(await fixture.enrich([{body: fixtures.page(items), code: 'AAA'}])).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'Enriched 0 of 1 airports. 0 unmatched, 1 ambiguous, 0 skipped.\n',
    });
    expect(JSON.stringify(fixture.query().map(row => metadata(row)))).toBe(
      '[{"elevation_meters":null,"iata_code":"AAA","icao_code":null,"latitude":null,"longitude":null,"name":"Retained"}]'
    );
  },
  cliTimeout
);
test(
  'empty airports fail before key lookup and skipped airports need no key or HTTP',
  async () => {
    const empty = await create([], false);
    const failed = await empty.enrich();
    expect(failed.exitCode).toBe(1);
    expect(failed.stderr).toContain('No installed airports were found. Run scan');
    expect(failed.stderr).not.toContain('No OpenAIP API key');
    expect(await empty.observed()).toEqual([]);
    const skipped = await create([{iataCode: 'AAA', icaoCode: 'invalid'}], false);
    expect(await skipped.enrich()).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'Enriched 0 of 1 airports. 0 unmatched, 0 ambiguous, 1 skipped.\n',
    });
    expect(await skipped.observed()).toEqual([]);
  },
  cliTimeout
);
test(
  'HTTP does not hold database locks and stale identities are skipped',
  async () => {
    const fixture = await create([
      {icaoCode: 'KAAA', name: 'Old'},
      {icaoCode: 'KBBB', name: 'Old'},
    ]);
    expect(
      await fixture.enrich([
        {
          body: fixtures.page([{icaoCode: 'KAAA', name: 'Remote'}]),
          code: 'KAAA',
          mutation:
            "UPDATE airports SET icao_code = 'KCCC', name = 'Concurrent' WHERE id = 1",
        },
        {
          body: fixtures.page([{elevation: {unit: 0, value: -2}, icaoCode: 'KBBB'}]),
          code: 'KBBB',
          mutation: "UPDATE airports SET name = 'Live' WHERE id = 2",
        },
      ])
    ).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'Enriched 1 of 2 airports. 0 unmatched, 0 ambiguous, 1 skipped.\n',
    });
    expect(JSON.stringify(fixture.query().map(row => metadata(row)))).toBe(
      '[{"elevation_meters":null,"iata_code":null,"icao_code":"KCCC","latitude":null,"longitude":null,"name":"Concurrent"},{"elevation_meters":-2,"iata_code":null,"icao_code":"KBBB","latitude":null,"longitude":null,"name":"Live"}]'
    );
  },
  cliTimeout
);
