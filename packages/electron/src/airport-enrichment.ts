import {Effect} from 'effect';

import type {
  Airport,
  EnrichmentResult,
  EnrichmentSummary,
  SimulatorId,
} from '@flightsim-things/contract';
import type {AddonDatabase, AirportMetadata, AirportUpdate} from '@flightsim-things/db';

import {OpenAipError, validate} from './errors.js';

interface AirportCode {
  field: 'icaoCode' | 'iataCode';
  code: string;
}

interface ProviderAirport {
  id?: string;
  icaoCode?: string;
  iataCode?: string;
  name?: string;
  elevationMeters?: number;
  latitude?: number;
  longitude?: number;
}

interface AirportPage {
  items: ProviderAirport[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  nextPage?: number;
}

type LookupResult =
  | {kind: 'matched'; metadata: AirportMetadata}
  | {kind: 'unmatched'}
  | {kind: 'ambiguous'};

type OpenAipRequest = (
  url: URL,
  init: RequestInit
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

const icaoPattern = /^[A-Z]{4}$/;
const iataPattern = /^[A-Z]{3}$/;

export function parseOpenAipKey(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Array.from(value.trim()).some(
      character => character.charCodeAt(0) < 33 || character.charCodeAt(0) > 126
    )
  ) {
    throw new Error('Enter a valid OpenAIP API key.');
  }
  return value.trim();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OpenAIP returned invalid airport data. No airports were updated.');
  }
  return value as Record<string, unknown>;
}

function invalidData(): never {
  throw new Error('OpenAIP returned invalid airport data. No airports were updated.');
}

function optionalText(value: unknown, pattern?: RegExp): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || (pattern && !pattern.test(value))) {
    return invalidData();
  }
  return value;
}

function finiteNumber(value: unknown, min = -Infinity, max = Infinity): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    return invalidData();
  }
  return value;
}

function integer(value: unknown, min: number): number {
  const number = finiteNumber(value, min);
  if (!Number.isInteger(number)) {
    return invalidData();
  }
  return number;
}

function parseAirport(value: unknown): ProviderAirport {
  const airport = record(value);
  const parsed: ProviderAirport = {
    id: optionalText(airport._id),
    icaoCode: optionalText(airport.icaoCode, icaoPattern),
    iataCode: optionalText(airport.iataCode, iataPattern),
    name: optionalText(airport.name),
  };
  if (airport.geometry !== undefined) {
    const geometry = record(airport.geometry);
    if (
      geometry.type !== 'Point' ||
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length !== 2
    ) {
      return invalidData();
    }
    parsed.longitude = finiteNumber(geometry.coordinates[0], -180, 180);
    parsed.latitude = finiteNumber(geometry.coordinates[1], -90, 90);
  }
  if (airport.elevation !== undefined) {
    const elevation = record(airport.elevation);
    if (
      elevation.unit !== 0 ||
      (elevation.referenceDatum !== undefined && elevation.referenceDatum !== 1)
    ) {
      return invalidData();
    }
    parsed.elevationMeters = finiteNumber(elevation.value);
  }
  return parsed;
}

function parsePage(value: unknown): AirportPage {
  const page = record(value);
  if (!Array.isArray(page.items)) {
    return invalidData();
  }
  return {
    items: page.items.map(parseAirport),
    page: integer(page.page, 1),
    limit: integer(page.limit, 1),
    totalCount: integer(page.totalCount, 0),
    totalPages: integer(page.totalPages, 0),
    nextPage: page.nextPage === undefined ? undefined : integer(page.nextPage, 1),
  };
}

const requestPage = Effect.fn(function* (
  lookup: AirportCode,
  page: number,
  apiKey: string,
  request: OpenAipRequest
) {
  const url = new URL('https://api.core.openaip.net/api/airports');
  url.searchParams.set('search', lookup.code);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', '100');
  url.searchParams.set('fields', '_id,name,icaoCode,iataCode,geometry,elevation');
  const timeout = AbortSignal.timeout(30_000);
  const response = yield* Effect.tryPromise({
    try: signal =>
      request(url, {
        headers: {'x-openaip-api-key': apiKey},
        redirect: 'error',
        signal: AbortSignal.any([timeout, signal]),
      }),
    catch: () =>
      new OpenAipError({
        message: timeout.aborted
          ? 'OpenAIP airport request timed out. Retry enrichment.'
          : 'Could not request OpenAIP airports. Check your connection and retry.',
      }),
  });
  if (!response.ok) {
    return yield* Effect.fail(
      new OpenAipError({
        message:
          response.status === 401 || response.status === 403
            ? 'OpenAIP rejected the API key. Enter a valid key and retry.'
            : `OpenAIP airport request failed with HTTP ${response.status}.`,
      })
    );
  }
  const json = yield* Effect.tryPromise({
    try: () => response.json(),
    catch: () =>
      new OpenAipError({
        message: 'OpenAIP returned invalid JSON. No airports were updated.',
      }),
  });
  return yield* validate(() => parsePage(json)).pipe(
    Effect.mapError(error => new OpenAipError({message: error.message}))
  );
});

function validatePagination(
  response: AirportPage,
  page: number,
  expected: AirportPage | undefined
) {
  const empty = response.totalCount === 0;
  if (
    response.page !== page ||
    response.items.length > response.limit ||
    (expected &&
      (response.limit !== expected.limit ||
        response.totalCount !== expected.totalCount ||
        response.totalPages !== expected.totalPages)) ||
    (empty && (response.items.length !== 0 || response.totalPages > 1)) ||
    (!empty &&
      (response.totalPages !== Math.ceil(response.totalCount / response.limit) ||
        page > response.totalPages)) ||
    (response.nextPage !== undefined &&
      (response.nextPage !== page + 1 || response.nextPage > response.totalPages))
  ) {
    throw new Error(
      'OpenAIP returned inconsistent pagination. No airports were updated.'
    );
  }
}

function metadataFor(airport: ProviderAirport, lookup: AirportCode): AirportMetadata {
  const metadata: AirportMetadata = {};
  if (lookup.field === 'icaoCode' && airport.iataCode !== undefined) {
    metadata.iataCode = airport.iataCode;
  }
  if (lookup.field === 'iataCode' && airport.icaoCode !== undefined) {
    metadata.icaoCode = airport.icaoCode;
  }
  if (airport.name?.trim()) {
    metadata.name = airport.name.trim();
  }
  if (airport.elevationMeters !== undefined) {
    metadata.elevationMeters = airport.elevationMeters;
  }
  if (airport.latitude !== undefined && airport.longitude !== undefined) {
    metadata.latitude = airport.latitude;
    metadata.longitude = airport.longitude;
  }
  return metadata;
}

const lookupAirport = Effect.fn(function* (
  lookup: AirportCode,
  apiKey: string,
  request: OpenAipRequest
) {
  const identified = new Map<string, AirportMetadata>();
  const matches: AirportMetadata[] = [];
  let conflictingIdentity = false;
  let received = 0;
  let expected: AirportPage | undefined;
  for (let page = 1; ; page += 1) {
    const response = yield* requestPage(lookup, page, apiKey, request);
    yield* validate(() => validatePagination(response, page, expected)).pipe(
      Effect.mapError(error => new OpenAipError({message: error.message}))
    );
    received += response.items.length;
    for (const airport of response.items) {
      if (airport[lookup.field] !== lookup.code) {
        continue;
      }
      const metadata = metadataFor(airport, lookup);
      if (airport.id) {
        const previous = identified.get(airport.id);
        if (previous) {
          conflictingIdentity ||= JSON.stringify(previous) !== JSON.stringify(metadata);
          continue;
        }
        identified.set(airport.id, metadata);
      }
      matches.push(metadata);
    }
    if (page >= response.totalPages) {
      if (received !== response.totalCount) {
        return yield* Effect.fail(
          new OpenAipError({
            message: 'OpenAIP returned incomplete pagination. No airports were updated.',
          })
        );
      }
      if (conflictingIdentity || matches.length > 1) {
        return {kind: 'ambiguous'} satisfies LookupResult;
      }
      return (
        matches[0] ? {kind: 'matched', metadata: matches[0]} : {kind: 'unmatched'}
      ) satisfies LookupResult;
    }
    expected = response;
  }
});

function lookupFor(airport: Airport): AirportCode | null {
  const icao = airport.icaoCode?.trim().toUpperCase() ?? '';
  const iata = airport.iataCode?.trim().toUpperCase() ?? '';
  if (icao && icaoPattern.test(icao)) {
    return {field: 'icaoCode', code: icao};
  }
  if (!icao && iataPattern.test(iata)) {
    return {field: 'iataCode', code: iata};
  }
  return null;
}

export const enrichInstalledAirports = Effect.fn(function* (
  database: AddonDatabase,
  simulator: SimulatorId,
  key: unknown,
  request: OpenAipRequest = fetch
) {
  const apiKey = yield* validate(() => parseOpenAipKey(key));
  const inventory = yield* database.getInventory(simulator);
  if (!inventory.airports.length) {
    return yield* Effect.fail(
      new OpenAipError({
        message:
          'No installed airports were found. Scan scenery addons before enrichment.',
      })
    );
  }
  const summary: EnrichmentSummary = {
    airports: inventory.airports.length,
    enriched: 0,
    unmatched: 0,
    ambiguous: 0,
    skipped: 0,
  };
  const groups = new Map<string, {lookup: AirportCode; airports: Airport[]}>();
  for (const airport of inventory.airports) {
    const lookup = lookupFor(airport);
    if (!lookup) {
      summary.skipped += 1;
      continue;
    }
    const groupKey = `${lookup.field}:${lookup.code}`;
    const group = groups.get(groupKey);
    if (group) {
      group.airports.push(airport);
    } else {
      groups.set(groupKey, {lookup, airports: [airport]});
    }
  }
  const updates: AirportUpdate[] = [];
  for (const group of groups.values()) {
    const result = yield* lookupAirport(group.lookup, apiKey, request);
    if (result.kind !== 'matched') {
      summary[result.kind] += group.airports.length;
    } else if (!Object.keys(result.metadata).length) {
      summary.skipped += group.airports.length;
    } else {
      updates.push(
        ...group.airports.map(airport => ({airport, metadata: result.metadata}))
      );
    }
  }
  if (updates.length) {
    summary.enriched = yield* database.applyAirportEnrichment(updates).pipe(
      Effect.mapError(
        () =>
          new OpenAipError({
            message: 'Could not update the addon database. Retry enrichment.',
          })
      )
    );
    summary.skipped += updates.length - summary.enriched;
  }
  return {
    inventory: yield* database.getInventory(simulator),
    summary,
  } satisfies EnrichmentResult;
});
