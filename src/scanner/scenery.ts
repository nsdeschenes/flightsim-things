import {Option} from 'effect';

import type PackageSnapshot from './model.ts';
import type XmlContext from './xml-context.ts';
import reportXmlDiagnostic from './xml-diagnostic.ts';

type AirportObservation = PackageSnapshot['airports'][number];
type SceneryRead = Pick<PackageSnapshot, 'airports' | 'skippedXmlFiles'>;
type XmlContents = Readonly<Pick<Blob, keyof Blob>>;
type AirportElement = Readonly<{
  name: string;
  attributes: Readonly<Record<string, string>>;
}>;
type AirportDocument = Readonly<{
  name: string;
  children: readonly (
    | string
    | AirportElement
    | Readonly<Bun.XML.Comment>
    | Readonly<Bun.XML.ProcessingInstruction>
  )[];
}>;
const missing = Option.getOrNull(Option.none());
const airportServicePath =
  /(?:^|\/)airportservices\/(?<code>[a-z\d]{3,8})\/services\.(?:xml|spb)$/iu;
const airportCode = /^[a-z\d]{3,8}$/iu;
const iataCode = /^[a-z]{3}$/iu;
const leadingRoot =
  /^(?:\uFEFF)?[\t\r\n ]*(?:<!--(?:[^-]|-(?!-))*-->[\t\r\n ]*)*(?<declaration><\?xml[\t\r\n ]+[^?]*\?>[\t\r\n ]*)?(?:<!--(?:[^-]|-(?!-))*-->[\t\r\n ]*)*<(?<root>[a-z_][a-z\d_.-]*(?::[a-z_][a-z\d_.-]*)?)(?=[\t\r\n />]|$)/iu;
const utf8Declaration =
  /^<\?xml\s+version\s*=\s*(?:"1\.[01]"|'1\.[01]')(?:\s+encoding\s*=\s*(?:"utf-8"|'utf-8'))?(?:\s+standalone\s*=\s*(?:"(?:yes|no)"|'(?:yes|no)'))?\s*\?>\s*$/iu;

async function unrelatedRoot(contents: XmlContents): Promise<boolean> {
  try {
    const source = new TextDecoder('utf-8', {fatal: true}).decode(
      await contents.arrayBuffer()
    );
    const match = leadingRoot.exec(source);
    const groups = match && match.groups;
    if (
      source.includes('\0') ||
      !groups ||
      (typeof groups.declaration === 'string' &&
        !utf8Declaration.test(groups.declaration))
    ) {
      return false;
    }

    return (
      typeof groups.root === 'string' &&
      groups.root !== 'FSData' &&
      !groups.root.endsWith(':FSData')
    );
  } catch {
    return false;
  }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return missing;
  }

  return value.trim();
}

function airportObservation(
  key: string,
  airport: Readonly<{attributes: Readonly<Record<string, string>>}>
): AirportObservation {
  const ident = text(airport.attributes.ident);
  const iata = text(airport.attributes.iata);
  if (ident === missing || !airportCode.test(ident)) {
    throw new Error(`Airport in ${key} requires an explicit valid ident`);
  }

  if (iata !== missing && !iataCode.test(iata)) {
    throw new Error(`Invalid explicit airport IATA code in ${key}: ${iata}`);
  }

  let normalizedIata = iata;
  if (iata !== missing) {
    normalizedIata = iata.toUpperCase();
  }

  return {
    iataCode: normalizedIata,
    icaoCode: ident.toUpperCase(),
    name: text(airport.attributes.name),
    sourceKey: `${key}#airport:${ident.toUpperCase()}`,
  };
}

function airportObservations(
  key: string,
  document: AirportDocument
): readonly AirportObservation[] {
  const observations: AirportObservation[] = [];
  for (const child of document.children) {
    if (
      document.name === 'FSData' &&
      typeof child === 'object' &&
      'name' in child &&
      child.name === 'Airport'
    ) {
      observations.push(airportObservation(key, child));
    }
  }

  if (
    new Set(observations.map(airport => airport.sourceKey)).size !== observations.length
  ) {
    throw new Error(`Duplicate airport ident in ${key}`);
  }

  return observations;
}

async function parseAirports(
  contents: XmlContents,
  context: XmlContext
): Promise<Bun.XML.Node | null> {
  try {
    return Bun.XML.parse(contents, {compact: false});
  } catch (error) {
    const skipped = await unrelatedRoot(contents);
    let recovery: 'skip-file' | 'reject-package' = 'reject-package';
    if (skipped) {
      recovery = 'skip-file';
    }

    await reportXmlDiagnostic(context, contents, {
      category: 'xml.parse',
      error,
      recovery,
    });
    if (!skipped) {
      throw error;
    }

    return missing;
  }
}

async function readAirports(
  key: string,
  contents: XmlContents,
  context: XmlContext
): Promise<SceneryRead> {
  const document = await parseAirports(contents, context);
  if (document === missing) {
    return {airports: [], skippedXmlFiles: [context.filePath]};
  }

  try {
    return {airports: airportObservations(key, document), skippedXmlFiles: []};
  } catch (error) {
    await reportXmlDiagnostic(context, contents, {
      category: 'xml.airport-validation',
      error,
      recovery: 'reject-package',
    });
    throw error;
  }
}

async function readServices(contents: XmlContents, context: XmlContext): Promise<void> {
  try {
    Bun.XML.parse(contents);
  } catch (error) {
    await reportXmlDiagnostic(context, contents, {
      category: 'xml.parse',
      error,
      recovery: 'reject-package',
    });
    throw error;
  }
}

async function readScenery(
  key: string,
  contents: XmlContents,
  context: XmlContext
): Promise<SceneryRead> {
  const service = airportServicePath.exec(key);
  const groups = service && service.groups;
  if (groups && typeof groups.code === 'string' && groups.code !== 'shared') {
    if (key.endsWith('.xml')) {
      await readServices(contents, context);
    }

    return {
      airports: [
        {
          iataCode: missing,
          icaoCode: groups.code.toUpperCase(),
          name: missing,
          sourceKey: key,
        },
      ],
      skippedXmlFiles: [],
    };
  }

  if (key.endsWith('.xml')) {
    const result = await readAirports(key, contents, context);
    return result;
  }

  return {airports: [], skippedXmlFiles: []};
}

export default readScenery;
