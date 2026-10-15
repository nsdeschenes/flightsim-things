import {Effect, Option, Redacted} from 'effect';
import {TaggedError as taggedError} from 'effect/Data';
import {z} from 'zod';

type AirportCode = Readonly<{field: 'icaoCode' | 'iataCode'; code: string}>;
type AirportMetadata = Readonly<{
  elevationMeters?: number;
  iataCode?: string;
  icaoCode?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
}>;
type LookupResult =
  | Readonly<{kind: 'matched'; metadata: AirportMetadata}>
  | Readonly<{kind: 'unmatched'}>
  | Readonly<{kind: 'ambiguous'}>;
class AirportEnrichmentError extends taggedError('AirportEnrichmentError')<{
  readonly message: string;
}> {}
const noItems = 0;
const firstPage = 1;
const pageIncrement = 1;
const pageLimit = 100;
const uniqueMatchCount = 1;
const maxLongitude = 180;
const maxLatitude = 90;
const metersUnit = 0;
const meanSeaLevelDatum = 1;
const unauthorizedStatus = 401;
const forbiddenStatus = 403;
const requestTimeout = '30 seconds';
const icaoPattern = /^[A-Z]{4}$/u;
const iataPattern = /^[A-Z]{3}$/u;
const longitudeSchema = z.number().min(-maxLongitude).max(maxLongitude);
const latitudeSchema = z.number().min(-maxLatitude).max(maxLatitude);
const geometrySchema = z
  .object({
    coordinates: z.tuple([longitudeSchema, latitudeSchema]).readonly(),
    type: z.literal('Point'),
  })
  .readonly();
const elevationSchema = z
  .object({
    referenceDatum: z.literal(meanSeaLevelDatum).optional(),
    unit: z.literal(metersUnit),
    value: z.number(),
  })
  .readonly();
const airportSchema = z
  .object({
    _id: z.string().optional(),
    elevation: elevationSchema.optional(),
    geometry: geometrySchema.optional(),
    iataCode: z.string().regex(iataPattern).optional(),
    icaoCode: z.string().regex(icaoPattern).optional(),
    name: z.string().optional(),
  })
  .readonly();
const pageSchema = z
  .object({
    items: z.array(airportSchema).readonly(),
    limit: z.number().int().positive(),
    nextPage: z.number().int().positive().optional(),
    page: z.number().int().positive(),
    totalCount: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .readonly();
type Airport = z.infer<typeof airportSchema>;
type AirportPage = z.infer<typeof pageSchema>;
type Pagination = Readonly<Pick<AirportPage, 'limit' | 'totalCount' | 'totalPages'>>;
type LookupState = Readonly<{
  conflictingIdentity: boolean;
  expected: Pagination | null;
  page: number;
  received: number;
}>;
const missing = Option.getOrNull(Option.none());
type Candidates = Readonly<{
  identified: Readonly<Pick<Map<string, AirportMetadata>, 'get' | 'set'>>;
  matches: readonly AirportMetadata[] & Pick<AirportMetadata[], 'push'>;
}>;
function failure(message: string): AirportEnrichmentError {
  return new AirportEnrichmentError({message});
}
function textMetadata(airport: Airport, lookup: AirportCode): AirportMetadata {
  const metadata: {-readonly [Key in keyof AirportMetadata]: AirportMetadata[Key]} = {};
  if (lookup.field === 'icaoCode' && typeof airport.iataCode === 'string') {
    metadata.iataCode = airport.iataCode;
  }
  if (lookup.field === 'iataCode' && typeof airport.icaoCode === 'string') {
    metadata.icaoCode = airport.icaoCode;
  }
  if (typeof airport.name === 'string' && airport.name.trim() !== '') {
    metadata.name = airport.name.trim();
  }
  return metadata;
}
function metadataFor(airport: Airport, lookup: AirportCode): AirportMetadata {
  const metadata: {-readonly [Key in keyof AirportMetadata]: AirportMetadata[Key]} =
    textMetadata(airport, lookup);
  if (airport.elevation) {
    metadata.elevationMeters = airport.elevation.value;
  }
  if (airport.geometry) {
    const [longitude, latitude] = airport.geometry.coordinates;
    metadata.latitude = latitude;
    metadata.longitude = longitude;
  }
  return metadata;
}
function parseAirportPage(json: unknown): AirportPage {
  const parsed = pageSchema.safeParse(json);
  if (!parsed.success) {
    throw failure('OpenAIP returned invalid airport data. No airports were updated.');
  }
  return parsed.data;
}
function requestError(error: unknown): AirportEnrichmentError {
  if (error instanceof AirportEnrichmentError) {
    return error;
  }
  return failure('Could not request OpenAIP airports. Check your connection and retry.');
}
async function validateResponse(
  response: Readonly<Pick<Response, 'ok' | 'status' | 'json'>>
): Promise<AirportPage> {
  if (!response.ok) {
    if (response.status === unauthorizedStatus || response.status === forbiddenStatus) {
      throw failure(
        'OpenAIP rejected the API key. Run openaip-key set <key> with a valid key.'
      );
    }
    throw failure(`OpenAIP airport request failed with HTTP ${response.status}.`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw failure('OpenAIP returned invalid JSON. No airports were updated.');
  }
  return parseAirportPage(json);
}
function requestPage(
  lookup: AirportCode,
  page: number,
  key: Readonly<Redacted.Redacted>
): Effect.Effect<AirportPage, AirportEnrichmentError> {
  const url = new URL('https://api.core.openaip.net/api/airports');
  url.searchParams.set('search', lookup.code);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(pageLimit));
  url.searchParams.set('fields', '_id,name,icaoCode,iataCode,geometry,elevation');
  return Effect.tryPromise({
    catch: requestError,
    try: async (signal: Readonly<AbortSignal>) => {
      const response = await fetch(url, {
        headers: {'x-openaip-api-key': Redacted.value(key)},
        redirect: 'error',
        signal,
      });
      const parsed = await validateResponse(response);
      return parsed;
    },
  }).pipe(
    Effect.timeoutOrElse({
      duration: requestTimeout,
      orElse: () =>
        Effect.fail(failure('OpenAIP airport request timed out. Retry the command.')),
    })
  );
}
function validatePagination(
  response: AirportPage,
  page: number,
  expected: Pagination | null
): void {
  const empty = response.totalCount === noItems;
  if (
    response.page !== page ||
    response.items.length > response.limit ||
    (expected &&
      (response.totalPages !== expected.totalPages ||
        response.totalCount !== expected.totalCount ||
        response.limit !== expected.limit)) ||
    (empty && (response.items.length !== noItems || response.totalPages > firstPage)) ||
    (!empty &&
      (response.totalPages !== Math.ceil(response.totalCount / response.limit) ||
        page > response.totalPages)) ||
    (typeof response.nextPage === 'number' &&
      (response.nextPage !== page + pageIncrement ||
        response.nextPage > response.totalPages))
  ) {
    throw failure('OpenAIP returned inconsistent pagination. No airports were updated.');
  }
}
function addCandidate(
  candidates: Candidates,
  airport: Airport,
  lookup: AirportCode
): boolean {
  const metadata = metadataFor(airport, lookup);
  const {_id: providerId} = airport;
  if (typeof providerId === 'string' && providerId !== '') {
    const previous = candidates.identified.get(providerId);
    if (previous) {
      return JSON.stringify(previous) !== JSON.stringify(metadata);
    }
    candidates.identified.set(providerId, metadata);
  }
  candidates.matches.push(metadata);
  return false;
}
function addPage(
  candidates: Candidates,
  response: AirportPage,
  lookup: AirportCode
): boolean {
  let conflictingIdentity = false;
  for (const airport of response.items) {
    if (
      airport[lookup.field] === lookup.code &&
      addCandidate(candidates, airport, lookup)
    ) {
      conflictingIdentity = true;
    }
  }
  return conflictingIdentity;
}
function selectMatch(candidates: Candidates, conflictingIdentity: boolean): LookupResult {
  if (conflictingIdentity || candidates.matches.length > uniqueMatchCount) {
    return {kind: 'ambiguous'};
  }
  const [metadata] = candidates.matches;
  if (metadata) {
    return {kind: 'matched', metadata};
  }
  return {kind: 'unmatched'};
}
function collectPage(
  state: LookupState,
  response: AirportPage,
  search: Readonly<{candidates: Candidates; lookup: AirportCode}>
): LookupState {
  validatePagination(response, state.page, state.expected);
  const received = state.received + response.items.length;
  if (state.page >= response.totalPages && received !== response.totalCount) {
    throw failure('OpenAIP returned incomplete pagination. No airports were updated.');
  }
  return {
    conflictingIdentity:
      addPage(search.candidates, response, search.lookup) || state.conflictingIdentity,
    expected: response,
    page: state.page + pageIncrement,
    received,
  };
}
function lookupAirport(
  lookup: AirportCode,
  key: Readonly<Redacted.Redacted>
): Effect.Effect<LookupResult, AirportEnrichmentError> {
  return Effect.gen(function* lookupOpenAipAirport() {
    let state: LookupState = {
      conflictingIdentity: false,
      expected: missing,
      page: firstPage,
      received: noItems,
    };
    const candidates: Candidates = {
      identified: new Map<string, AirportMetadata>(),
      matches: [],
    };
    while (true) {
      const response = yield* requestPage(lookup, state.page, key);
      const previous = state;
      const next = yield* Effect.try({
        catch: requestError,
        try: () => collectPage(previous, response, {candidates, lookup}),
      });
      state = next;
      if (state.page > response.totalPages) {
        return selectMatch(candidates, state.conflictingIdentity);
      }
    }
  });
}
const openaip = {failure, iataPattern, icaoPattern, lookupAirport};
export default openaip;
