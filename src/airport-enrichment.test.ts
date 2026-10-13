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
function identityFor(row: Readonly<Record<string, unknown>>): unknown {
  const {id, package_id, source_key} = row;
  return {id, package_id, source_key};
}
test(
  'exact ICAO ignores fuzzy results, groups installed codes, preserves identity and reruns',
  async () => {
    const fixture = await create([{icaoCode: ' kaaa ', name: 'Old'}, {icaoCode: 'KAAA'}]);
    const plans = [
      {
        body: fixtures.page([
          {icaoCode: 'KBBB', name: 'Fuzzy'},
          {
            _id: 'exact',
            elevation: {unit: 0, value: -35.5},
            geometry: {coordinates: [151.177222, -33.946111], type: 'Point'},
            iataCode: 'AAA',
            icaoCode: 'KAAA',
            ignored: {invalid: true},
            name: 'Actual',
          },
        ]),
        code: 'KAAA',
      },
    ];
    const identity = fixture.query().map(row => identityFor(row));
    expect(await fixture.enrich(plans)).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'Enriched 2 of 2 airports. 0 unmatched, 0 ambiguous, 0 skipped.\n',
    });
    expect(JSON.stringify(fixture.query().map(row => metadata(row)))).toBe(
      '[{"elevation_meters":-35.5,"iata_code":"AAA","icao_code":" kaaa ","latitude":-33.946111,"longitude":151.177222,"name":"Actual"},{"elevation_meters":-35.5,"iata_code":"AAA","icao_code":"KAAA","latitude":-33.946111,"longitude":151.177222,"name":"Actual"}]'
    );
    expect(await fixture.observed()).toEqual([{code: 'KAAA', page: 1}]);
    expect(await fixture.enrich(plans)).toMatchObject({exitCode: 0});
    expect(fixture.query().map(row => identityFor(row))).toEqual(identity);
  },
  cliTimeout
);
const paginationRequests = [
  {
    body: fixtures.page([{icaoCode: 'KCCC'}], {
      limit: 1,
      nextPage: 2,
      totalCount: 2,
      totalPages: 2,
    }),
    code: 'KAAA',
  },
  {
    body: fixtures.page([{icaoCode: 'KAAA', name: 'Later'}], {
      limit: 1,
      page: 2,
      totalCount: 2,
      totalPages: 2,
    }),
    code: 'KAAA',
    page: 2,
  },
  {
    body: fixtures.page([{_id: 'first', icaoCode: 'KBBB', name: 'First'}], {
      limit: 1,
      totalCount: 2,
      totalPages: 2,
    }),
    code: 'KBBB',
  },
  {
    body: fixtures.page([{_id: 'second', icaoCode: 'KBBB', name: 'Second'}], {
      limit: 1,
      page: 2,
      totalCount: 2,
      totalPages: 2,
    }),
    code: 'KBBB',
    page: 2,
  },
];
test(
  'later exact matches and later ambiguity require every page',
  async () => {
    const fixture = await create([
      {icaoCode: 'KAAA'},
      {icaoCode: 'KBBB', name: 'Retained'},
    ]);
    const result = await fixture.enrich(paginationRequests);
    expect(result).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'Enriched 1 of 2 airports. 0 unmatched, 1 ambiguous, 0 skipped.\n',
    });
    expect(JSON.stringify(fixture.query().map(row => metadata(row)))).toBe(
      '[{"elevation_meters":null,"iata_code":null,"icao_code":"KAAA","latitude":null,"longitude":null,"name":"Later"},{"elevation_meters":null,"iata_code":null,"icao_code":"KBBB","latitude":null,"longitude":null,"name":"Retained"}]'
    );
    expect(await fixture.observed()).toEqual([
      {code: 'KAAA', page: 1},
      {code: 'KAAA', page: 2},
      {code: 'KBBB', page: 1},
      {code: 'KBBB', page: 2},
    ]);
  },
  cliTimeout
);
test(
  'IATA fallback fills ICAO, preserves optional values, and counts disjoint skip reasons',
  async () => {
    const fixture = await create([
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
    ]);
    expect(
      await fixture.enrich([
        {
          body: fixtures.page([{iataCode: 'AAA', icaoCode: 'KAAA', name: '   '}]),
          code: 'AAA',
        },
        {body: fixtures.page([{icaoCode: 'KCCC'}]), code: 'KCCC'},
        {body: fixtures.page([], {totalPages: 0}), code: 'KDDD'},
      ])
    ).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: 'Enriched 1 of 5 airports. 1 unmatched, 0 ambiguous, 3 skipped.\n',
    });
    expect(JSON.stringify(fixture.query().map(row => metadata(row)))).toBe(
      '[{"elevation_meters":42,"iata_code":" aaa ","icao_code":"KAAA","latitude":10,"longitude":20,"name":"Retained"},{"elevation_meters":null,"iata_code":"BBB","icao_code":"malformed","latitude":null,"longitude":null,"name":null},{"elevation_meters":null,"iata_code":null,"icao_code":null,"latitude":null,"longitude":null,"name":"No code"},{"elevation_meters":null,"iata_code":null,"icao_code":"KCCC","latitude":null,"longitude":null,"name":null},{"elevation_meters":null,"iata_code":null,"icao_code":"KDDD","latitude":null,"longitude":null,"name":null}]'
    );
  },
  cliTimeout
);
