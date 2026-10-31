import fs from 'node:fs/promises';
import path from 'node:path';

import {Option} from 'effect';

import configurations from './aircraft.ts';
import airportFallback from './airport-fallback.ts';
import ConfigurationLineError from './configuration-line-error.ts';
import contentPolicy from './content-policy.ts';
import type PackageSnapshot from './model.ts';
import readScenery from './scenery.ts';
import safeXmlMessage from './xml-message.ts';

type ContentPolicy = ReturnType<typeof contentPolicy>;
type PackageMetadata = PackageSnapshot['metadata'];
type AircraftObservation = PackageSnapshot['aircraft'][number];
type AirportObservation = PackageSnapshot['airports'][number];
type LiveryObservation = PackageSnapshot['liveries'][number];
type PackageRead =
  | Readonly<{status: 'success'; snapshot: PackageSnapshot}>
  | Readonly<{
      status: 'failure';
      sourcePath: string;
      message: string;
      diagnosticMessage: string;
    }>;
type Contents = Pick<PackageSnapshot, 'aircraft' | 'airports' | 'liveries' | 'warnings'>;
type FileLocator = Readonly<{
  key: string;
  relative: string;
  role: 'configuration' | 'discovery' | 'model';
}>;
type Inventory = Readonly<{
  files: readonly FileLocator[];
  hasCompiledScenery: boolean;
}>;
const firstIndex = 0;
const missing = Option.getOrNull(Option.none());
const configurationFiles = /(?:^|\/)(?:aircraft|livery)\.cfg$/iu;
const sceneryFiles = /\.xml$|(?:^|\/)airportservices\/[^/]+\/services\.spb$/iu;
const simObjectModel = /^simobjects\/[^/]+\/[^/]+\/model(?:\.[^/]+)?\/.*\.xml$/u;
const airportServices = /(?:^|\/)airportservices\//u;
const modelLod = /_lod\d+$/u;
const drivePrefix = /^[a-z]:/iu;
const bom = /^\uFEFF/u;
const systemCode = /^[A-Z][A-Z\d_]+$/u;
const validationReasons = [
  'Expected a JSON object',
  'Layout entries require a relative file path',
  'Unsafe layout path',
  'Metadata file escapes its package',
  'Duplicate metadata path in layout.json',
  'layout.json requires a content array',
  'Aircraft configuration requires GENERAL, LIVERY, or FLTSIM sections',
  'Invalid virtual aircraft container',
  'Duplicate FLTSIM section',
];

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function diagnosticReason(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    systemCode.test(error.code)
  ) {
    return error.code;
  }

  const message = errorMessage(error);
  const xmlMessage = safeXmlMessage(message);
  if (message.startsWith('XML Parse error:') || xmlMessage !== message) {
    return xmlMessage;
  }

  const reason = validationReasons.find(candidate => message.startsWith(candidate));
  return reason ?? 'Package metadata validation failed';
}

class MetadataReadError extends Error {
  public override name = 'MetadataReadError';
  public readonly diagnosticMessage: string;

  public constructor(error: unknown, relative: string, reason = diagnosticReason(error)) {
    super(errorMessage(error));
    if (error instanceof ConfigurationLineError) {
      this.diagnosticMessage = error.message;
      return;
    }

    if (reason === 'ENOENT') {
      this.diagnosticMessage = `Missing required metadata in ${relative}; package skipped. Restore the file or repair the package installation and run scan again.`;
      this.message = this.diagnosticMessage;
      return;
    }

    this.diagnosticMessage = `${reason} in ${relative}`;
  }
}

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
  try {
    const contents = await readFile(root, relative);
    const parsed: unknown = JSON.parse(contents.toString('utf8').replace(bom, ''));
    return object(parsed);
  } catch (error) {
    let reason = diagnosticReason(error);
    if (error instanceof SyntaxError) {
      reason = 'Invalid JSON';
    }

    throw new MetadataReadError(error, relative, reason);
  }
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

function modelXmlKeys(entries: readonly string[]): Readonly<Pick<Set<string>, 'has'>> {
  return new Set(
    entries.flatMap(relative => {
      const key = vfsKey(relative);
      if (!key.endsWith('.gltf')) {
        return [];
      }

      const stem = key.slice(firstIndex, -'.gltf'.length);
      return [`${stem}.xml`, `${stem.replace(modelLod, '')}.xml`];
    })
  );
}

function metadataRole(
  key: string,
  models: Readonly<Pick<Set<string>, 'has'>>
): FileLocator['role'] {
  if (configurationFiles.test(key)) {
    return 'configuration';
  }

  if (
    key.endsWith('.xml') &&
    !airportServices.test(key) &&
    (simObjectModel.test(key) || models.has(key))
  ) {
    return 'model';
  }

  return 'discovery';
}

function inventory(
  layout: Readonly<Record<string, unknown>>,
  policy: ContentPolicy
): Inventory {
  if (!Array.isArray(layout.content)) {
    throw new TypeError('layout.json requires a content array');
  }

  const entries = layout.content.map(entry => relativeFile(object(entry).path));
  const selected = {
    files: new Map<string, string>(),
    hasCompiledScenery: false,
    models: modelXmlKeys(entries),
  };
  for (const relative of entries) {
    const key = vfsKey(relative);
    selected.hasCompiledScenery ||= policy.airports && key.endsWith('.bgl');

    if (
      (policy.liveries && configurationFiles.test(key)) ||
      (policy.airports && sceneryFiles.test(key))
    ) {
      addMetadataFile(selected.files, key, relative);
    }
  }

  return {
    files: Array.from(
      selected.files.entries(),
      ([key, relative]: readonly [string, string]): FileLocator => ({
        key,
        relative,
        role: metadataRole(key, selected.models),
      })
    ),
    hasCompiledScenery: selected.hasCompiledScenery,
  };
}

async function parseMetadata(
  root: string,
  locator: FileLocator,
  packageName: string
): Promise<Contents> {
  const bytes = await readFile(root, locator.relative);
  if (locator.role === 'model') {
    return {aircraft: [], airports: [], liveries: [], warnings: []};
  }

  if (locator.key.endsWith('aircraft.cfg')) {
    return {
      ...configurations.aircraft(locator.relative, bytes.toString('utf8')),
      warnings: [],
    };
  }

  if (locator.key.endsWith('livery.cfg')) {
    return {
      ...configurations.livery(locator.relative, bytes.toString('utf8')),
      warnings: [],
    };
  }

  const scenery = await readScenery(locator.key, new Blob([bytes]), {
    filePath: locator.relative,
    packageName,
  });
  return {aircraft: [], liveries: [], ...scenery};
}

async function readMetadata(
  root: string,
  locator: FileLocator,
  packageName: string
): Promise<Contents> {
  try {
    return await parseMetadata(root, locator, packageName);
  } catch (error) {
    if (
      locator.role !== 'configuration' &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {
        aircraft: [],
        airports: [],
        liveries: [],
        warnings: [
          `Missing optional discovery metadata in ${locator.relative}; file skipped and coverage may be incomplete. Restore the file or correct layout.json and run scan again.`,
        ],
      };
    }

    throw new MetadataReadError(error, locator.relative);
  }
}

async function readContents(
  root: string,
  files: readonly FileLocator[],
  packageName: string
): Promise<Contents> {
  const contents: {
    aircraft: AircraftObservation[];
    airports: AirportObservation[];
    liveries: LiveryObservation[];
    warnings: string[];
  } = {aircraft: [], airports: [], liveries: [], warnings: []};
  for (const locator of files) {
    const rows = await readMetadata(root, locator, packageName);
    contents.warnings.push(...rows.warnings);
    contents.aircraft.push(...rows.aircraft);
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

async function snapshot(sourcePath: string, root: string): Promise<PackageSnapshot> {
  const [manifest, layout] = await Promise.all([
    json(root, 'manifest.json'),
    json(root, 'layout.json'),
  ]);
  const policy = contentPolicy(text(manifest.content_type));
  const {files, hasCompiledScenery} = inventory(layout, policy);
  let contents = await readContents(root, files, path.basename(sourcePath));
  if (contents.airports.length === firstIndex && hasCompiledScenery) {
    contents = {...contents, airports: airportFallback.infer(sourcePath)};
  }

  const warnings: string[] = [];
  if (hasCompiledScenery) {
    warnings.push(
      'Compiled scenery metadata is not decoded; airport coverage may be incomplete even with XML, AirportServices, or package-name fallback.'
    );
  }

  return {
    ...contents,
    aircraft: contents.aircraft.filter(() => policy.aircraft),
    metadata: metadata(sourcePath, manifest),
    warnings: [...warnings, ...contents.warnings],
  };
}

async function readPackage(sourcePath: string): Promise<PackageRead> {
  try {
    const root = await fs.realpath(sourcePath);
    return {snapshot: await snapshot(sourcePath, root), status: 'success'};
  } catch (error) {
    let diagnosticMessage = diagnosticReason(error);
    if (error instanceof MetadataReadError) {
      ({diagnosticMessage} = error);
    }

    return {
      diagnosticMessage,
      message: errorMessage(error),
      sourcePath,
      status: 'failure',
    };
  }
}

async function hasManifest(sourcePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(sourcePath, 'manifest.json'));
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
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
