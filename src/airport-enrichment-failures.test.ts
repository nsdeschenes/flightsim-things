import {afterEach, expect, test} from 'bun:test';

import fixtures from './airport-enrichment-test-fixtures.ts';

type Fixture = Awaited<ReturnType<typeof fixtures.createFixture>>;
type FailureCase = Readonly<{
  message: string;
  plan: Readonly<{body?: unknown; error?: string; raw?: string; status?: number}>;
}>;
const cliTimeout = 60_000;
const active: Fixture[] = [];
afterEach(async () => {
  for (const fixture of active) {
    await fixture.dispose();
  }
  active.length = 0;
});
async function create(saveKey = true): Promise<Fixture> {
  const fixture = await fixtures.createFixture(
    [
      {icaoCode: 'KAAA', name: 'Old'},
      {icaoCode: 'KBBB', name: 'Also old'},
    ],
    saveKey
  );
  active.push(fixture);
  return fixture;
}
const failureCases: readonly FailureCase[] = [
  {message: 'OpenAIP rejected the API key', plan: {raw: fixtures.key, status: 401}},
  {message: 'OpenAIP rejected the API key', plan: {raw: fixtures.key, status: 403}},
  {message: 'HTTP 503', plan: {raw: fixtures.key, status: 503}},
  {message: 'invalid JSON', plan: {raw: `{"secret":"${fixtures.key}",broken}`}},
  {message: 'Check your connection', plan: {error: fixtures.key}},
  {
    message: 'invalid airport data',
    plan: {body: fixtures.page([{icaoCode: 'KAAA', name: 42}])},
  },
  {
    message: 'invalid airport data',
    plan: {body: fixtures.page([{icaoCode: 'kaaa', name: fixtures.key}])},
  },
  {
    message: 'invalid airport data',
    plan: {body: fixtures.page([{iataCode: 'AB12', icaoCode: 'KAAA'}])},
  },
  {
    message: 'invalid airport data',
    plan: {
      body: fixtures.page([
        {geometry: {coordinates: [181, 0], type: 'Point'}, icaoCode: 'KAAA'},
      ]),
    },
  },
  {
    message: 'invalid airport data',
    plan: {
      body: fixtures.page([
        {geometry: {coordinates: [0, 91], type: 'Point'}, icaoCode: 'KAAA'},
      ]),
    },
  },
  {
    message: 'invalid airport data',
    plan: {
      body: fixtures.page([
        {geometry: {coordinates: [0, 0, 0], type: 'Point'}, icaoCode: 'KAAA'},
      ]),
    },
  },
  {
    message: 'invalid airport data',
    plan: {body: fixtures.page([{elevation: {unit: 1, value: 100}, icaoCode: 'KAAA'}])},
  },
  {
    message: 'invalid airport data',
    plan: {body: fixtures.page([{elevation: {unit: 0, value: '100'}, icaoCode: 'KAAA'}])},
  },
  {
    message: 'invalid airport data',
    plan: {
      body: fixtures.page([
        {elevation: {referenceDatum: 0, unit: 0, value: 100}, icaoCode: 'KAAA'},
      ]),
    },
  },
  {
    message: 'invalid airport data',
    plan: {body: fixtures.page([{icaoCode: 'KAAA'}], {page: 1.5})},
  },
  {
    message: 'inconsistent pagination',
    plan: {body: fixtures.page([{icaoCode: 'KAAA'}], {page: 2})},
  },
  {
    message: 'inconsistent pagination',
    plan: {body: fixtures.page([{icaoCode: 'KAAA'}], {nextPage: 1})},
  },
  {
    message: 'inconsistent pagination',
    plan: {
      body: fixtures.page([{icaoCode: 'KAAA'}], {
        limit: 1,
        nextPage: 3,
        totalCount: 3,
        totalPages: 3,
      }),
    },
  },
  {
    message: 'inconsistent pagination',
    plan: {body: fixtures.page([{icaoCode: 'KAAA'}], {totalCount: 0})},
  },
  {
    message: 'incomplete pagination',
    plan: {body: fixtures.page([{icaoCode: 'KAAA'}], {totalCount: 2})},
  },
];
test.each([...failureCases])(
  'request failure %# preserves every airport and hides provider data',
  async ({message, plan}: FailureCase) => {
    const fixture = await create();
    const before = fixture.query();
    const result = await fixture.enrich([{code: 'KAAA', ...plan}]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(message);
    expect(result.stderr).not.toContain(fixtures.key);
    expect(fixture.query()).toEqual(before);
  },
  cliTimeout
);
test.each([
  {overrides: {}},
  {overrides: {totalCount: 3, totalPages: 3}},
  {overrides: {limit: 2, totalPages: 1}},
  {overrides: {totalPages: 3}},
])(
  'truncated or changing later pages %# cannot commit an early match',
  async ({overrides}: Readonly<{overrides: Readonly<Record<string, unknown>>}>) => {
    const fixture = await create();
    const before = fixture.query();
    const result = await fixture.enrich([
      {
        body: fixtures.page([{icaoCode: 'KAAA', name: 'Early'}], {
          limit: 1,
          totalCount: 2,
          totalPages: 2,
        }),
        code: 'KAAA',
      },
      {
        body: fixtures.page([], {
          limit: 1,
          page: 2,
          totalCount: 2,
          totalPages: 2,
          ...overrides,
        }),
        code: 'KAAA',
        page: 2,
      },
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('pagination');
    expect(fixture.query()).toEqual(before);
    expect(await fixture.observed()).toEqual([
      {code: 'KAAA', page: 1},
      {code: 'KAAA', page: 2},
    ]);
  },
  cliTimeout
);
test(
  'a later failed lookup leaves earlier matched airports unchanged',
  async () => {
    const fixture = await create();
    const before = fixture.query();
    const result = await fixture.enrich([
      {body: fixtures.page([{icaoCode: 'KAAA', name: 'New'}]), code: 'KAAA'},
      {code: 'KBBB', error: fixtures.key},
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Check your connection');
    expect(result.stderr).not.toContain(fixtures.key);
    expect(fixture.query()).toEqual(before);
  },
  cliTimeout
);
test(
  'a failed database update rolls back the complete transaction without exposing its cause',
  async () => {
    const fixture = await create();
    const before = fixture.query();
    const result = await fixture.enrich([
      {body: fixtures.page([{icaoCode: 'KAAA', name: 'New'}]), code: 'KAAA'},
      {
        body: fixtures.page([{icaoCode: 'KBBB', name: 'New'}]),
        code: 'KBBB',
        mutation: `CREATE TRIGGER fail_update BEFORE UPDATE ON airports WHEN old.id = 2 BEGIN SELECT RAISE(ABORT, '${fixtures.key}'); END`,
      },
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Could not update the addon database');
    expect(result.stderr).not.toContain(fixtures.key);
    expect(fixture.query()).toEqual(before);
  },
  cliTimeout
);
test(
  'a usable installed code needs a saved API key before HTTP',
  async () => {
    const fixture = await create(false);
    const result = await fixture.enrich();
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No OpenAIP API key is saved');
    expect(await fixture.observed()).toEqual([]);
    expect(fixture.query()).toMatchObject([
      {icao_code: 'KAAA', name: 'Old'},
      {icao_code: 'KBBB', name: 'Also old'},
    ]);
  },
  cliTimeout
);
test(
  'a stalled response body times out, aborts HTTP, and leaves all airports unchanged',
  async () => {
    const fixture = await create();
    const before = fixture.query();
    const result = await fixture.enrich([
      {body: fixtures.page([{icaoCode: 'KAAA', name: 'New'}]), code: 'KAAA'},
      {code: 'KBBB', stallBody: true},
    ]);
    expect(result).toMatchObject({exitCode: 1, stdout: ''});
    expect(result.stderr).toContain('OpenAIP airport request timed out');
    expect(result.stderr).not.toContain(fixtures.key);
    expect(await fixture.aborted()).toBe('aborted');
    expect(fixture.query()).toEqual(before);
  },
  cliTimeout
);
