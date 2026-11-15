import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {Effect, Exit, Fiber, Scope} from 'effect';

import {expect, test} from 'vitest';

import type {Airport} from '@flightsim-things/contract';
import {openDatabase} from '@flightsim-things/db';

import {createAddonLibrary} from './addons.js';
import {enrichInstalledAirports, parseOpenAipKey} from './airport-enrichment.js';

type Request = NonNullable<Parameters<typeof enrichInstalledAirports>[3]>;

const key = 'private-openaip-test-key';

function page(items: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    items,
    page: 1,
    limit: 100,
    totalCount: items.length,
    totalPages: 1,
    ...overrides,
  };
}

function json(value: unknown) {
  return {ok: true, status: 200, json: async () => value};
}

function airport(code: string | null, sourceKey = code ?? 'iata'): Airport {
  return {
    simulator: 'msfs2020',
    folderName: 'scenery',
    sourceKey,
    icaoCode: code,
    iataCode: null,
    name: 'Original airport',
    elevationMeters: null,
    latitude: null,
    longitude: null,
  };
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-airports-'));
  const path = join(directory, 'airports.sqlite');
  const scope = Scope.makeUnsafe();
  const database = await Effect.runPromise(
    openDatabase(path).pipe(Effect.provideService(Scope.Scope, scope))
  );
  return {
    directory,
    path,
    database,
    async seed(airports: Airport[]) {
      await Effect.runPromise(
        database.replaceInventory(
          'msfs2020',
          '/Community',
          [
            {
              simulator: 'msfs2020',
              folderName: 'scenery',
              folderPath: '/Community/scenery',
              name: 'Scenery',
              version: null,
              creator: null,
              contentType: 'SCENERY',
              manifestJson: '{}',
            },
          ],
          airports
        )
      );
    },
    async dispose() {
      await Effect.runPromise(Scope.close(scope, Exit.void));
      await rm(directory, {recursive: true, force: true});
    },
  };
}

async function scenery(root: string, folder: string, files: Record<string, string>) {
  const directory = join(root, folder);
  await mkdir(directory, {recursive: true});
  await writeFile(
    join(directory, 'manifest.json'),
    JSON.stringify({title: folder, content_type: 'SCENERY'})
  );
  await writeFile(
    join(directory, 'layout.json'),
    JSON.stringify({content: Object.keys(files).map(path => ({path}))})
  );
  for (const [path, contents] of Object.entries(files)) {
    const target = join(directory, path);
    await mkdir(join(target, '..'), {recursive: true});
    await writeFile(target, contents);
  }
  return directory;
}

test('scans old scenery sources, groups paginated exact matches, and preserves enrichment across rescan and restart', async () => {
  const f = await fixture();
  try {
    const community = join(f.directory, 'Community');
    const explicit = await scenery(community, 'vendor-airport-kaaa-main', {
      'scenery/airports.xml':
        '<FSData><Airport ident="KAAA" name="Scanned name"/><Airport ident="KBBB" iata="BBB"/></FSData>',
      'AirportServices/KCCC/Services.spb': 'compiled services',
    });
    const fallback = await scenery(community, 'vendor-airport-kaaa-duplicate', {
      'scenery/airport.bgl': 'compiled',
    });
    await scenery(community, 'vendor-airport-kddd-uncompiled', {});
    const library = createAddonLibrary(f.database);
    await Effect.runPromise(library.saveCommunityPath('msfs2020', community));
    const scanned = await Effect.runPromise(library.scan('msfs2020'));
    expect(
      scanned.inventory.airports.map(row => [row.folderName, row.sourceKey, row.icaoCode])
    ).toEqual([
      ['vendor-airport-kaaa-duplicate', '#package-name-airport', 'KAAA'],
      ['vendor-airport-kaaa-main', 'airportservices/kccc/services.spb', 'KCCC'],
      ['vendor-airport-kaaa-main', 'scenery/airports.xml#airport:KAAA', 'KAAA'],
      ['vendor-airport-kaaa-main', 'scenery/airports.xml#airport:KBBB', 'KBBB'],
    ]);
    const requests: string[] = [];
    const request: Request = async (url, init) => {
      expect(init.headers).toEqual({'x-openaip-api-key': key});
      expect(init.redirect).toBe('error');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const code = url.searchParams.get('search');
      const requestedPage = Number(url.searchParams.get('page'));
      requests.push(`${code}:${requestedPage}`);
      if (code === 'KAAA') {
        return json(
          page(
            requestedPage === 1
              ? [{_id: 'fuzzy', icaoCode: 'KZZZ', name: 'Wrong airport'}]
              : [
                  {
                    _id: 'a',
                    icaoCode: 'KAAA',
                    iataCode: 'AAA',
                    name: ' Enriched airport ',
                    geometry: {type: 'Point', coordinates: [-73.75, 45.5]},
                    elevation: {unit: 0, referenceDatum: 1, value: 0},
                  },
                ],
            {
              page: requestedPage,
              limit: 1,
              totalCount: 2,
              totalPages: 2,
              ...(requestedPage === 1 ? {nextPage: 2} : {}),
            }
          )
        );
      }
      return json(page([{_id: code, icaoCode: code, name: `Enriched ${code}`}]));
    };
    const enriched = await Effect.runPromise(
      enrichInstalledAirports(f.database, 'msfs2020', key, request)
    );
    expect(enriched.summary).toEqual({
      airports: 4,
      enriched: 4,
      ambiguous: 0,
      unmatched: 0,
      skipped: 0,
    });
    expect(requests).toEqual(['KAAA:1', 'KAAA:2', 'KCCC:1', 'KBBB:1']);
    expect(enriched.inventory.airports[0]).toEqual({
      ...scanned.inventory.airports[0],
      name: 'Enriched airport',
      iataCode: 'AAA',
      latitude: 45.5,
      longitude: -73.75,
      elevationMeters: 0,
    });
    expect(JSON.stringify(enriched)).not.toContain(key);
    expect(
      (await Effect.runPromise(library.scan('msfs2020'))).inventory.airports
    ).toEqual(enriched.inventory.airports);
    expect(
      (
        await Effect.runPromise(
          enrichInstalledAirports(f.database, 'msfs2020', key, request)
        )
      ).inventory.airports
    ).toEqual(enriched.inventory.airports);

    await writeFile(
      join(fallback, 'layout.json'),
      JSON.stringify({content: [{path: 'explicit.xml'}]})
    );
    await writeFile(
      join(fallback, 'explicit.xml'),
      '<FSData><Airport ident="KAAA"/></FSData>'
    );
    const promoted = await Effect.runPromise(library.scan('msfs2020'));
    expect(promoted.inventory.airports[0]).toEqual({
      ...enriched.inventory.airports[0],
      sourceKey: 'explicit.xml#airport:KAAA',
    });
    await writeFile(join(explicit, 'scenery/airports.xml'), '<FSData><Airport');
    const incomplete = await Effect.runPromise(library.scan('msfs2020'));
    expect(incomplete.inventory.airports).toEqual(promoted.inventory.airports);
    expect(incomplete.warnings).toEqual([
      expect.objectContaining({
        folderName: 'vendor-airport-kaaa-main',
        message: expect.stringContaining('Previous airports were retained'),
      }),
    ]);
    await rm(explicit, {recursive: true});
    expect(
      (await Effect.runPromise(library.scan('msfs2020'))).inventory.airports
    ).toEqual([promoted.inventory.airports[0]]);
    const reopenedScope = Scope.makeUnsafe();
    const reopened = await Effect.runPromise(
      openDatabase(f.path).pipe(Effect.provideService(Scope.Scope, reopenedScope))
    );
    try {
      expect(
        (await Effect.runPromise(reopened.getInventory('msfs2020'))).airports
      ).toEqual([promoted.inventory.airports[0]]);
      expect(
        (await Effect.runPromise(reopened.getInventory('msfs2024'))).airports
      ).toEqual([]);
    } finally {
      await Effect.runPromise(Scope.close(reopenedScope, Exit.void));
    }
  } finally {
    await f.dispose();
  }
});

test('distinguishes ambiguity, fuzzy-only responses, skipped codes, and IATA-only lookups', async () => {
  const f = await fixture();
  try {
    await f.seed([
      airport('KAAA'),
      airport('KBBB'),
      airport('KCCC'),
      airport('KDDD'),
      {...airport(null), iataCode: 'EEE'},
      airport('BAD1'),
    ]);
    const result = await Effect.runPromise(
      enrichInstalledAirports(f.database, 'msfs2020', key, async url => {
        switch (url.searchParams.get('search')) {
          case 'KAAA':
            return json(
              page([
                {_id: 'a', icaoCode: 'KAAA', name: 'A'},
                {_id: 'b', icaoCode: 'KAAA', name: 'B'},
              ])
            );
          case 'KBBB':
            return json(
              page([
                {_id: 'same', icaoCode: 'KBBB', name: 'B'},
                {_id: 'same', icaoCode: 'KBBB', name: 'Conflict'},
              ])
            );
          case 'KCCC':
            return json(page([{icaoCode: 'KZZZ', name: 'Fuzzy match'}]));
          case 'KDDD':
            return json(page([{icaoCode: 'KDDD'}]));
          case 'EEE':
            return json(
              page([{iataCode: 'EEE', icaoCode: 'KEEE', name: 'IATA airport'}])
            );
          default:
            throw new Error('Unexpected lookup');
        }
      })
    );
    expect(result.summary).toEqual({
      airports: 6,
      enriched: 1,
      ambiguous: 2,
      unmatched: 1,
      skipped: 2,
    });
    expect(result.inventory.airports.find(row => row.sourceKey === 'iata')).toEqual({
      ...airport(null),
      iataCode: 'EEE',
      icaoCode: 'KEEE',
      name: 'IATA airport',
    });
    expect(
      result.inventory.airports
        .filter(row => row.sourceKey !== 'iata')
        .every(row => row.name === 'Original airport')
    ).toBe(true);
  } finally {
    await f.dispose();
  }
});

test('deduplicates identical provider IDs across pages and preserves omitted metadata', async () => {
  const f = await fixture();
  try {
    await f.seed([
      {
        ...airport('KAAA'),
        latitude: 42,
        longitude: -70,
        elevationMeters: 12,
        iataCode: 'AAA',
      },
    ]);
    const result = await Effect.runPromise(
      enrichInstalledAirports(f.database, 'msfs2020', key, async url =>
        json(
          page([{_id: 'same', icaoCode: 'KAAA', name: 'Updated'}], {
            page: Number(url.searchParams.get('page')),
            limit: 1,
            totalCount: 2,
            totalPages: 2,
          })
        )
      )
    );
    expect(result.summary).toEqual({
      airports: 1,
      enriched: 1,
      ambiguous: 0,
      unmatched: 0,
      skipped: 0,
    });
    expect(result.inventory.airports).toEqual([
      {
        ...airport('KAAA'),
        name: 'Updated',
        latitude: 42,
        longitude: -70,
        elevationMeters: 12,
        iataCode: 'AAA',
      },
    ]);
  } finally {
    await f.dispose();
  }
});

test.each([
  {
    name: 'HTTP authentication',
    request: async () => ({ok: false, status: 401, json: async () => ({secret: key})}),
    message: 'OpenAIP rejected the API key',
  },
  {
    name: 'HTTP server error',
    request: async () => ({ok: false, status: 500, json: async () => ({secret: key})}),
    message: 'HTTP 500',
  },
  {
    name: 'transport failure',
    request: async () => {
      throw new Error(key);
    },
    message: 'Could not request OpenAIP airports',
  },
  {
    name: 'invalid JSON',
    request: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error(key);
      },
    }),
    message: 'invalid JSON',
  },
  {
    name: 'invalid coordinates',
    request: async () =>
      json(page([{icaoCode: 'KBBB', geometry: {type: 'Point', coordinates: [12, 91]}}])),
    message: 'invalid airport data',
  },
  {
    name: 'invalid elevation units',
    request: async () =>
      json(page([{icaoCode: 'KBBB', elevation: {unit: 1, value: 100}}])),
    message: 'invalid airport data',
  },
  {
    name: 'wrong page',
    request: async () => json(page([{icaoCode: 'KBBB'}], {page: 2})),
    message: 'inconsistent pagination',
  },
  {
    name: 'incomplete page',
    request: async () => json(page([], {totalCount: 1})),
    message: 'incomplete pagination',
  },
  {
    name: 'looping next page',
    request: async () => json(page([{icaoCode: 'KBBB'}], {nextPage: 1})),
    message: 'inconsistent pagination',
  },
])(
  'does not write partial enrichment or reveal credentials after $name',
  async ({request, message}) => {
    const f = await fixture();
    try {
      const original = [airport('KAAA'), airport('KBBB')];
      await f.seed(original);
      const attempt = Effect.runPromise(
        enrichInstalledAirports(f.database, 'msfs2020', key, async url =>
          url.searchParams.get('search') === 'KAAA'
            ? json(page([{icaoCode: 'KAAA', name: 'Must not be saved'}]))
            : request()
        )
      );
      await expect(attempt).rejects.toThrow(message);
      await expect(attempt).rejects.not.toThrow(key);
      expect(
        (await Effect.runPromise(f.database.getInventory('msfs2020'))).airports
      ).toEqual(original);
    } finally {
      await f.dispose();
    }
  }
);

test('rolls back a failed database update and skips rows whose identity changed during lookup', async () => {
  const f = await fixture();
  try {
    const original = [airport('KAAA'), airport('KBBB')];
    await f.seed(original);
    await Effect.runPromise(
      f.database.db.run(
        `CREATE TRIGGER fail_enrichment BEFORE UPDATE ON airports WHEN NEW.icaoCode = 'KBBB' BEGIN SELECT RAISE(ABORT, 'test failure'); END`
      )
    );
    const request: Request = async url =>
      json(page([{icaoCode: url.searchParams.get('search'), name: 'Updated'}]));
    await expect(
      Effect.runPromise(enrichInstalledAirports(f.database, 'msfs2020', key, request))
    ).rejects.toThrow('Could not update the addon database');
    expect(
      (await Effect.runPromise(f.database.getInventory('msfs2020'))).airports
    ).toEqual(original);
    await Effect.runPromise(f.database.db.run(`DROP TRIGGER fail_enrichment`));
    const result = await Effect.runPromise(
      enrichInstalledAirports(f.database, 'msfs2020', key, async (url, init) => {
        if (url.searchParams.get('search') === 'KBBB') {
          await Effect.runPromise(
            f.database.db.run(
              `UPDATE airports SET icaoCode = 'KCCC' WHERE sourceKey = 'KAAA'`
            )
          );
        }
        return request(url, init);
      })
    );
    expect(result.summary).toEqual({
      airports: 2,
      enriched: 1,
      ambiguous: 0,
      unmatched: 0,
      skipped: 1,
    });
    expect(result.inventory.airports).toEqual([
      {...original[0], icaoCode: 'KCCC'},
      {...original[1], name: 'Updated'},
    ]);
  } finally {
    await f.dispose();
  }
});

test('rejects missing and malformed keys without echoing them', async () => {
  expect(parseOpenAipKey(` ${key} `)).toBe(key);
  for (const value of [undefined, null, '', '  ', `${key}\nheader`, `${key}\0`]) {
    expect(() => parseOpenAipKey(value)).toThrow('Enter a valid OpenAIP API key.');
  }
  const f = await fixture();
  try {
    await expect(
      Effect.runPromise(createAddonLibrary(f.database).enrichAirports('msfs2020', key))
    ).rejects.toThrow('No installed airports were found');
  } finally {
    await f.dispose();
  }
});

test('interrupting enrichment aborts its HTTP request and preserves installed metadata', async () => {
  const f = await fixture();
  try {
    const original = [airport('KAAA')];
    await f.seed(original);
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const requested = new Promise<void>(resolve => {
      started = resolve;
    });
    const enrichment = Effect.runFork(
      enrichInstalledAirports(
        f.database,
        'msfs2020',
        key,
        (_url, init) =>
          new Promise((_resolve, reject) => {
            signal = init.signal ?? undefined;
            signal?.addEventListener(
              'abort',
              () => reject(new Error('Request aborted')),
              {once: true}
            );
            started();
          })
      )
    );
    await requested;
    await Effect.runPromise(Fiber.interrupt(enrichment));
    expect(signal?.aborted).toBe(true);
    expect(
      (await Effect.runPromise(f.database.getInventory('msfs2020'))).airports
    ).toEqual(original);
  } finally {
    await f.dispose();
  }
});
