import {readFile, realpath} from 'node:fs/promises';
import {isAbsolute, join, posix, relative, sep} from 'node:path';

import {Effect} from 'effect';

import {DOMParser} from '@xmldom/xmldom';

import type {Addon, Airport} from '@flightsim-things/contract';

import {fileSystem, validate} from './errors.js';

interface AirportDiscovery {
  airports: Airport[];
  complete: boolean;
  warnings: string[];
}

const packageAirport = /^(?:[a-z\d]+-)+airport-([a-z\d]{4})-[a-z\d]+(?:-[a-z\d]+)*$/i;
const airportServices = /(?:^|\/)airportservices\/([a-z\d]{3,8})\/services\.(xml|spb)$/i;

function observation(
  addon: Addon,
  sourceKey: string,
  icaoCode: string,
  iataCode: string | null = null,
  name: string | null = null
): Airport {
  return {
    simulator: addon.simulator,
    folderName: addon.folderName,
    sourceKey,
    icaoCode,
    iataCode,
    name,
    elevationMeters: null,
    latitude: null,
    longitude: null,
  };
}

function layoutPaths(value: unknown): string[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('content' in value) ||
    !Array.isArray(value.content)
  ) {
    throw new Error('layout.json requires a content array.');
  }
  return value.content.map((entry: unknown) => {
    const path =
      entry && typeof entry === 'object' && 'path' in entry ? entry.path : null;
    if (typeof path !== 'string' || !path || path.includes('\0')) {
      throw new Error('Layout entries require a relative file path.');
    }
    const normalized = path.replaceAll('\\', '/');
    if (
      posix.isAbsolute(normalized) ||
      /^[a-z]:/i.test(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new Error('Layout entries must stay inside their package.');
    }
    return posix.normalize(normalized);
  });
}

const readPackageFile = Effect.fn(function* (root: string, path: string) {
  const filename = yield* fileSystem(() => realpath(join(root, path)));
  yield* validate(() => {
    const contained = relative(root, filename);
    if (contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
      throw new Error('Airport metadata must stay inside its package.');
    }
  });
  return yield* fileSystem(() => readFile(filename));
});

function parseXml(bytes: Buffer, path: string): Document {
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'utf-16le';
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'utf-16be';
  }
  const source = new TextDecoder(encoding, {fatal: true}).decode(bytes);
  const errors: string[] = [];
  const document = new DOMParser({errorHandler: () => errors.push(path)}).parseFromString(
    source,
    'application/xml'
  );
  if (errors.length || !document.documentElement || document.doctype) {
    throw new Error(`Could not parse airport XML in ${path}.`);
  }
  return document;
}

function xmlAirports(addon: Addon, key: string, document: Document): Airport[] {
  const airports: Airport[] = [];
  const root = document.documentElement;
  if (root.tagName !== 'FSData') {
    return airports;
  }
  for (let child = root.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1 || child.nodeName !== 'Airport') {
      continue;
    }
    const element = child as Element;
    const ident = element.getAttribute('ident')?.trim();
    const iata = element.getAttribute('iata')?.trim() || null;
    if (!ident || !/^[a-z\d]{3,8}$/i.test(ident) || (iata && !/^[a-z]{3}$/i.test(iata))) {
      throw new Error(`Airport in ${key} requires valid airport codes.`);
    }
    const code = ident.toUpperCase();
    airports.push(
      observation(
        addon,
        `${key}#airport:${code}`,
        code,
        iata?.toUpperCase() ?? null,
        element.getAttribute('name')?.trim() || null
      )
    );
  }
  if (new Set(airports.map(airport => airport.sourceKey)).size !== airports.length) {
    throw new Error(`Duplicate airport ident in ${key}.`);
  }
  return airports;
}

export const discoverAirports = Effect.fn(function* (addon: Addon) {
  if (addon.contentType !== 'SCENERY') {
    return {airports: [], complete: true, warnings: []};
  }
  return yield* Effect.gen(function* () {
    const root = yield* fileSystem(() => realpath(addon.folderPath));
    const layout = yield* readPackageFile(root, 'layout.json').pipe(
      Effect.catch(error => {
        const cause = error._tag === 'FileSystemError' ? error.cause : undefined;
        if (
          cause &&
          typeof cause === 'object' &&
          'code' in cause &&
          cause.code === 'ENOENT'
        ) {
          return Effect.succeed(null);
        }
        return Effect.fail(error);
      })
    );
    if (layout === null) {
      return {
        airports: [],
        complete: false,
        warnings: [
          'Airport discovery needs layout.json. Previous airports were retained.',
        ],
      };
    }
    const paths = yield* validate(() =>
      layoutPaths(JSON.parse(layout.toString('utf8').replace(/^\uFEFF/, '')))
    );
    const airports: Airport[] = [];
    const selected = new Set<string>();
    for (const path of paths) {
      const key = path.toLowerCase();
      const service = airportServices.exec(key);
      if (!key.endsWith('.xml') && !service) {
        continue;
      }
      if (/^simobjects\/[^/]+\/[^/]+\/model(?:\.[^/]+)?\//.test(key)) {
        continue;
      }
      if (selected.has(key)) {
        yield* validate(() => {
          throw new Error('Duplicate airport metadata path in layout.json.');
        });
      }
      selected.add(key);
      const bytes = yield* readPackageFile(root, path);
      const document = key.endsWith('.xml')
        ? yield* validate(() => parseXml(bytes, path))
        : null;
      if (service && service[1] !== 'shared') {
        airports.push(observation(addon, key, service[1].toUpperCase()));
      } else if (document) {
        airports.push(...(yield* validate(() => xmlAirports(addon, key, document))));
      }
    }
    const hasCompiledScenery = paths.some(path => path.toLowerCase().endsWith('.bgl'));
    const inferred = packageAirport.exec(addon.folderName);
    if (!airports.length && hasCompiledScenery && inferred) {
      airports.push(
        observation(addon, '#package-name-airport', inferred[1].toUpperCase())
      );
    }
    return {
      airports,
      complete: true,
      warnings: hasCompiledScenery
        ? ['Compiled scenery is not decoded. Airport coverage may be incomplete.']
        : [],
    };
  }).pipe(
    Effect.catch(error =>
      Effect.succeed({
        airports: [],
        complete: false,
        warnings: [
          error instanceof Error
            ? `Airport discovery failed. ${error.message} Previous airports were retained.`
            : 'Airport discovery failed. Previous airports were retained.',
        ],
      } satisfies AirportDiscovery)
    )
  );
});
