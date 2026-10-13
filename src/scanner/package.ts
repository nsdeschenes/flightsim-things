import fs from 'node:fs/promises';
import path from 'node:path';

import {Option} from 'effect';

import configurations from './aircraft.ts';
import type PackageSnapshot from './model.ts';

type PackageMetadata = PackageSnapshot['metadata'];
type AircraftObservation = PackageSnapshot['aircraft'][number];
type AirportObservation = PackageSnapshot['airports'][number];
type LiveryObservation = PackageSnapshot['liveries'][number];
type PackageRead =
  | Readonly<{status: 'success'; snapshot: PackageSnapshot}>
  | Readonly<{status: 'failure'; sourcePath: string; message: string}>;
type Contents = Pick<PackageSnapshot, 'aircraft' | 'airports' | 'liveries'>;
type FileLocator = Readonly<{key: string; relative: string}>;
type Inventory = Readonly<{files: readonly FileLocator[]; warnings: readonly string[]}>;
const firstIndex = 0;
const missing = Option.getOrNull(Option.none());
const metadataFiles =
  /(?:^|\/)(?:aircraft|livery)\.cfg$|\.xml$|(?:^|\/)airportservices\/[^/]+\/services\.spb$/iu;
const airportServicePath =
  /(?:^|\/)airportservices\/(?<code>[a-z\d]{3,8})\/services\.(?:xml|spb)$/iu;
const airportCode = /^[a-z\d]{3,8}$/iu;
const iataCode = /^[a-z]{3}$/iu;
const drivePrefix = /^[a-z]:/iu;
const bom = /^\uFEFF/u;
const emptyContents: Contents = {aircraft: [], airports: [], liveries: []};

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return missing;
  }
  return value.trim();
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === missing || Array.isArray(value)) {
    throw new TypeError('Expected a JSON object');
  }
  return Object.fromEntries(Object.entries(value));
}

function vfsKey(value: string): string {
  return path.posix.normalize(value.replaceAll('\\', '/')).toLowerCase();
}

function relativeFile(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new TypeError('Layout entries require a relative file path');
  }
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized === '' ||
    path.posix.isAbsolute(normalized) ||
    drivePrefix.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe layout path: ${value}`);
  }
  return path.posix.normalize(normalized);
}

async function readFile(root: string, relative: string): Promise<Buffer> {
  const filename = await fs.realpath(path.join(root, relative));
  const contained = path.relative(root, filename);
  if (
    contained === '..' ||
    contained.startsWith(`..${path.sep}`) ||
    path.isAbsolute(contained)
  ) {
    throw new Error(`Metadata file escapes its package: ${relative}`);
  }
  return fs.readFile(filename);
}

async function json(
  root: string,
  relative: string
): Promise<Readonly<Record<string, unknown>>> {
  const contents = await readFile(root, relative);
  const parsed: unknown = JSON.parse(contents.toString('utf8').replace(bom, ''));
  return object(parsed);
}

function airportObservation(
  relative: string,
  airport: Readonly<{attributes: Readonly<Record<string, string>>}>
): AirportObservation {
  const ident = text(airport.attributes.ident);
  const iata = text(airport.attributes.iata);
  if (ident === missing || !airportCode.test(ident)) {
    throw new Error(`Airport in ${relative} requires an explicit valid ident`);
  }
  if (iata !== missing && !iataCode.test(iata)) {
    throw new Error(`Invalid explicit airport IATA code in ${relative}: ${iata}`);
  }
  let normalizedIata = iata;
  if (iata !== missing) {
    normalizedIata = iata.toUpperCase();
  }
  return {
    iataCode: normalizedIata,
    icaoCode: ident.toUpperCase(),
    name: text(airport.attributes.name),
    sourceKey: `${vfsKey(relative)}#airport:${ident.toUpperCase()}`,
  };
}

function readAirports(
  relative: string,
  contents: Readonly<Pick<Blob, keyof Blob>>
): readonly AirportObservation[] {
  const document = Bun.XML.parse(contents, {compact: false});
  const observations: AirportObservation[] = [];
  for (const child of document.children) {
    if (
      document.name === 'FSData' &&
      typeof child === 'object' &&
      'name' in child &&
      child.name === 'Airport'
    ) {
      observations.push(airportObservation(relative, child));
    }
  }
  if (
    new Set(observations.map(airport => airport.sourceKey)).size !== observations.length
  ) {
    throw new Error(`Duplicate airport ident in ${relative}`);
  }
  return observations;
}

function addMetadataFile(
  files: Readonly<Pick<Map<string, string>, 'has' | 'set'>>,
  key: string,
  relative: string
): void {
  if (files.has(key)) {
    throw new Error(`Duplicate metadata path in layout.json: ${relative}`);
  }
  files.set(key, relative);
}

function inventory(layout: Readonly<Record<string, unknown>>): Inventory {
  if (!Array.isArray(layout.content)) {
    throw new TypeError('layout.json requires a content array');
  }
  const selected = {files: new Map<string, string>(), warnings: [] as string[]};
  for (const entry of layout.content) {
    const relative = relativeFile(object(entry).path);
    if (vfsKey(relative).endsWith('.bgl') && selected.warnings.length === firstIndex) {
      selected.warnings.push(
        'Compiled scenery metadata is not decoded; airport records require explicit XML or AirportServices metadata.'
      );
    }
    if (metadataFiles.test(vfsKey(relative))) {
      addMetadataFile(selected.files, vfsKey(relative), relative);
    }
  }
  return {
    files: Array.from(
      selected.files.entries(),
      ([key, relative]: readonly [string, string]) => ({key, relative})
    ),
    warnings: selected.warnings,
  };
}

function readScenery(key: string, contents: Readonly<Pick<Blob, keyof Blob>>): Contents {
  const service = airportServicePath.exec(key);
  const groups = service && service.groups;
  if (groups && typeof groups.code === 'string' && groups.code !== 'shared') {
    if (key.endsWith('.xml')) {
      Bun.XML.parse(contents);
    }
    return {
      aircraft: [],
      airports: [
        {
          iataCode: missing,
          icaoCode: groups.code.toUpperCase(),
          name: missing,
          sourceKey: key,
        },
      ],
      liveries: [],
    };
  }
  if (key.endsWith('.xml')) {
    return {aircraft: [], airports: readAirports(key, contents), liveries: []};
  }
  return emptyContents;
}

async function readMetadata(root: string, locator: FileLocator): Promise<Contents> {
  const bytes = await readFile(root, locator.relative);
  if (locator.key.endsWith('aircraft.cfg')) {
    return configurations.aircraft(locator.relative, bytes.toString('utf8'));
  }
  if (locator.key.endsWith('livery.cfg')) {
    return configurations.livery(locator.relative, bytes.toString('utf8'));
  }
  return readScenery(locator.key, new Blob([bytes]));
}

async function readContents(
  root: string,
  files: readonly FileLocator[]
): Promise<Contents> {
  const contents: {
    aircraft: AircraftObservation[];
    airports: AirportObservation[];
    liveries: LiveryObservation[];
  } = {aircraft: [], airports: [], liveries: []};
  for (const locator of files) {
    const rows = await readMetadata(root, locator);
    for (const row of rows.aircraft) {
      contents.aircraft.push(row);
    }
    for (const row of rows.airports) {
      contents.airports.push(row);
    }
    for (const row of rows.liveries) {
      contents.liveries.push(row);
    }
  }
  return contents;
}

function metadata(
  sourcePath: string,
  manifest: Readonly<Record<string, unknown>>
): PackageMetadata {
  return {
    contentType: text(manifest.content_type),
    creator: text(manifest.creator),
    manufacturer: text(manifest.manufacturer),
    minimumGameVersion: text(manifest.minimum_game_version),
    sourcePath,
    title: text(manifest.title),
    version: text(manifest.package_version),
  };
}

async function snapshot(sourcePath: string): Promise<PackageSnapshot> {
  const root = await fs.realpath(sourcePath);
  const [manifest, layout] = await Promise.all([
    json(root, 'manifest.json'),
    json(root, 'layout.json'),
  ]);
  const {files, warnings} = inventory(layout);
  const contents = await readContents(root, files);
  return {...contents, metadata: metadata(sourcePath, manifest), warnings};
}

async function readPackage(sourcePath: string): Promise<PackageRead> {
  try {
    return {snapshot: await snapshot(sourcePath), status: 'success'};
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) {
      ({message} = error);
    }
    return {message, sourcePath, status: 'failure'};
  }
}

async function hasManifest(sourcePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(sourcePath, 'manifest.json'));
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    return true;
  }
}

async function* discoverPackages(communityPath: string): AsyncGenerator<string, void> {
  const directory = await fs.opendir(communityPath);
  for await (const entry of directory) {
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      const sourcePath = path.join(communityPath, entry.name);
      if (await hasManifest(sourcePath)) {
        yield sourcePath;
      }
    }
  }
}

const packageReader = {discover: discoverPackages, read: readPackage};
export default packageReader;
