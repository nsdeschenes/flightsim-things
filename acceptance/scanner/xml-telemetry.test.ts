import {afterEach, beforeEach, expect, test} from 'bun:test';
import {rename, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {gunzip} from 'node:zlib';

import {Option, Schema} from 'effect';
import {Array as array, Record as record, Struct as struct} from 'effect/Schema';

import createFixture from '#acceptance-scanner';

const cliTimeout = 60_000;
const decompress = promisify(gunzip);
type EnvelopeRequest = Readonly<{
  arrayBuffer: () => Promise<ArrayBuffer>;
  headers: Readonly<{get: (name: string) => string | null}>;
}>;
const envelopeHeaderLines = 1;
const itemLines = 2;
const payloadOffset = 1;
const xmlLog = struct({
  attributes: record(Schema.String, Schema.Unknown),
  body: Schema.String,
  level: Schema.String,
});
const decodeLogs = Schema.decodeUnknownOption(struct({items: array(xmlLog)}));
const stringAttribute = struct({type: Schema.String, value: Schema.String});
const diagnosticAttributes = struct({
  'diagnostic.category': stringAttribute,
  'diagnostic.message': stringAttribute,
  'error.message': stringAttribute,
  'error.type': stringAttribute,
  'file.path': stringAttribute,
  'package.name': stringAttribute,
  'xml.byte_encoding': stringAttribute,
  'xml.declared_encoding': stringAttribute,
  'xml.recovery': stringAttribute,
  'xml.root': stringAttribute,
});
const decodeAttributes = Schema.decodeUnknownOption(diagnosticAttributes);
const canonicalUtf8 = new TextDecoder().encoding;
const singleItem = 1;
const firstIndex = 0;
const additionalDiagnostics = 3;
const usefulReason =
  /XML Parse error:|requires an explicit valid ident|Invalid explicit airport IATA code/u;
const decodeHeader = Schema.decodeUnknownOption(struct({type: Schema.String}));
const envelopes: string[] = [];
const sentinel = 'PRIVATE_XML_SENTINEL';
const malformedSound = `<Sound secret="${sentinel}"><broken`;
const malformedAirport = '<FSData><Airport';
const prefixSplitPadding = 8184;
const malformedUtf16 = '<?xml version="1.0" encoding="UTF-16"?><Sound><broken';
const byteOrderMark = '\uFEFF';
const utf16be = Buffer.from(byteOrderMark + malformedUtf16, 'utf16le').swap16();
type XmlCase = Readonly<{
  name: string;
  filename: string;
  source: string;
  format: BufferEncoding;
  root: string;
  declared: string;
  bytes: string;
  recovery: 'skip-file' | 'reject-package';
  category: 'xml.parse' | 'xml.airport-validation';
  error: string;
}>;
const cases: readonly XmlCase[] = [
  {
    bytes: 'utf-16le',
    category: 'xml.parse',
    declared: 'unknown',
    error: 'SyntaxError',
    filename: 'nul.xml',
    format: 'hex',
    name: 'utf16-nul',
    recovery: 'reject-package',
    root: 'unknown',
    source: Buffer.from('\uFEFF<Sound>\0<broken', 'utf16le').toString('hex'),
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.parse',
    declared: 'unspecified',
    error: 'SyntaxError',
    filename: 'large.xml',
    format: 'utf8',
    name: 'prefix-boundary',
    recovery: 'skip-file',
    root: 'Sound',
    source: `<Sound>${'a'.repeat(prefixSplitPadding)}€<broken`,
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.parse',
    declared: 'unspecified',
    error: 'SyntaxError',
    filename: 'nested\nsound.xml',
    format: 'utf8',
    name: 'newline-file',
    recovery: 'skip-file',
    root: 'foo',
    source: `<foo>&${sentinel};</foo>`,
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.parse',
    declared: 'unspecified',
    error: 'SyntaxError',
    filename: 'tag.xml',
    format: 'utf8',
    name: 'source-tag',
    recovery: 'skip-file',
    root: 'foo',
    source: `<foo><${sentinel}></foo>`,
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.parse',
    declared: 'unspecified',
    error: 'SyntaxError',
    filename: 'entity.xml',
    format: 'utf8',
    name: 'source-entity',
    recovery: 'reject-package',
    root: 'FSData',
    source: `<FSData>&${sentinel};</FSData>`,
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.airport-validation',
    declared: 'unspecified',
    error: 'Error',
    filename: 'iata.xml',
    format: 'utf8',
    name: 'source-iata',
    recovery: 'reject-package',
    root: 'FSData',
    source: `<FSData><Airport ident="KAAA" iata="/private/${sentinel}"/></FSData>`,
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.parse',
    declared: 'unspecified',
    error: 'SyntaxError',
    filename: 'SimObjects/Sound.XML',
    format: 'utf8',
    name: 'sound',
    recovery: 'skip-file',
    root: 'Sound',
    source: malformedSound,
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.parse',
    declared: 'unspecified',
    error: 'SyntaxError',
    filename: 'Scenery/Airport.xml',
    format: 'utf8',
    name: 'airport',
    recovery: 'reject-package',
    root: 'FSData',
    source: malformedAirport,
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.parse',
    declared: 'unspecified',
    error: 'SyntaxError',
    filename: 'AirportServices/KAAA/Services.xml',
    format: 'utf8',
    name: 'services',
    recovery: 'reject-package',
    root: 'Service.Packages',
    source: '<Service.Packages><broken',
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.parse',
    declared: 'unspecified',
    error: 'SyntaxError',
    filename: 'mystery.xml',
    format: 'utf8',
    name: 'uncertain',
    recovery: 'reject-package',
    root: 'unknown',
    source: '<!-- missing close <Sound>',
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.parse',
    declared: 'UTF-16',
    error: 'SyntaxError',
    filename: 'encoding.xml',
    format: 'utf8',
    name: 'declaration',
    recovery: 'reject-package',
    root: 'Sound',
    source: malformedUtf16,
  },
  {
    bytes: 'utf-16le',
    category: 'xml.parse',
    declared: 'unknown',
    error: 'SyntaxError',
    filename: 'bytes.xml',
    format: 'hex',
    name: 'invalid-bytes',
    recovery: 'reject-package',
    root: 'unknown',
    source: 'fffeff',
  },
  {
    bytes: 'unknown',
    category: 'xml.parse',
    declared: 'unknown',
    error: 'SyntaxError',
    filename: 'unknown.xml',
    format: 'hex',
    name: 'invalid-utf8',
    recovery: 'reject-package',
    root: 'unknown',
    source: 'ffffff',
  },
  {
    bytes: 'utf-16le',
    category: 'xml.parse',
    declared: 'UTF-16',
    error: 'SyntaxError',
    filename: 'little.xml',
    format: 'hex',
    name: 'utf16le',
    recovery: 'reject-package',
    root: 'Sound',
    source: Buffer.from(byteOrderMark + malformedUtf16, 'utf16le').toString('hex'),
  },
  {
    bytes: 'utf-16be',
    category: 'xml.parse',
    declared: 'UTF-16',
    error: 'SyntaxError',
    filename: 'big.xml',
    format: 'hex',
    name: 'utf16be',
    recovery: 'reject-package',
    root: 'Sound',
    source: utf16be.toString('hex'),
  },
  {
    bytes: canonicalUtf8,
    category: 'xml.airport-validation',
    declared: 'unspecified',
    error: 'Error',
    filename: 'airport.xml',
    format: 'utf8',
    name: 'invalid-airport',
    recovery: 'reject-package',
    root: 'FSData',
    source: '<FSData><Airport ident="?"/></FSData>',
  },
];
let fixture: Awaited<ReturnType<typeof createFixture>>;
let server: Bun.Server<unknown>;

async function readEnvelope(request: EnvelopeRequest): Promise<string> {
  let bytes = Buffer.from(await request.arrayBuffer());
  if (request.headers.get('content-encoding') === 'gzip') {
    bytes = await decompress(bytes);
  }

  return bytes.toString('utf8');
}

beforeEach(async () => {
  fixture = await createFixture();
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
  envelopes.length = 0;
  server = Bun.serve({
    async fetch(request: EnvelopeRequest): Promise<Response> {
      envelopes.push(await readEnvelope(request));
      return new Response('{}', {headers: {'Content-Type': 'application/json'}});
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  expect(
    await fixture.run(
      'sentry',
      'set',
      '--dsn',
      `http://publickey@127.0.0.1:${server.port}/123`,
      '--errors',
      '1',
      '--logs',
      '1',
      '--metrics',
      '0',
      '--traces',
      '0'
    )
  ).toMatchObject({exitCode: 0});
});

afterEach(async () => {
  await server.stop(true);
  await fixture.dispose();
});

function envelopeItems(): readonly Readonly<{type: string; payload: unknown}>[] {
  return envelopes.flatMap(envelope => {
    const lines = envelope.split('\n');
    const items: {type: string; payload: unknown}[] = [];
    for (let index = envelopeHeaderLines; index < lines.length; index += itemLines) {
      const header = lines.at(index);
      const payload = lines.at(index + payloadOffset);
      if (
        typeof header === 'string' &&
        header !== '' &&
        typeof payload === 'string' &&
        payload !== ''
      ) {
        const parsed: unknown = JSON.parse(header);
        items.push({
          payload: JSON.parse(payload),
          type: Option.getOrThrow(decodeHeader(parsed)).type,
        });
      }
    }

    return items;
  });
}

function xmlLogs(): readonly Readonly<{
  attributes: typeof diagnosticAttributes.Type;
  body: string;
  level: string;
}>[] {
  return envelopeItems()
    .filter(item => item.type === 'log')
    .flatMap(item => Option.getOrThrow(decodeLogs(item.payload)).items)
    .filter(item => item.body === 'XML metadata diagnostic')
    .map(item => ({
      ...item,
      attributes: Option.getOrThrow(decodeAttributes(item.attributes)),
    }));
}

async function addCase(input: XmlCase): Promise<void> {
  const root = await fixture.addon(input.name, {[input.filename]: ''}, 'SCENERY');
  await writeFile(
    path.join(root, input.filename),
    Buffer.from(input.source, input.format)
  );
}

function verifyCase(input: XmlCase): void {
  const matching = xmlLogs().filter(
    item => item.attributes['package.name'].value === input.name
  );
  expect(matching).toHaveLength(singleItem);
  const item = Option.getOrThrow(Option.fromUndefinedOr(matching.at(firstIndex)));
  let level = 'error';
  if (input.recovery === 'skip-file') {
    level = 'warn';
  }

  expect(item.level).toBe(level);
  expect(item.attributes).toMatchObject({
    'diagnostic.category': {type: 'string', value: input.category},
    'error.type': {type: 'string', value: input.error},
    'file.path': {type: 'string', value: input.filename},
    'package.name': {type: 'string', value: input.name},
    'xml.byte_encoding': {type: 'string', value: input.bytes},
    'xml.declared_encoding': {type: 'string', value: input.declared},
    'xml.recovery': {type: 'string', value: input.recovery},
    'xml.root': {type: 'string', value: input.root},
  });
  expect(item.attributes['diagnostic.message'].value).toBe(
    item.attributes['error.message'].value
  );
  expect(item.attributes['diagnostic.message'].value).toMatch(usefulReason);
}

async function addAlias(): Promise<void> {
  const original = await fixture.addon(
    'alias',
    {'linked.xml': malformedSound},
    'SCENERY'
  );
  const target = path.join(fixture.home, 'private-target');
  await rename(original, target);
  await symlink(target, original);
}

async function seedPackages(): Promise<void> {
  await Promise.all(
    cases.map(async input => {
      await addCase(input);
    })
  );
  await fixture.addon(
    'later-failure',
    {
      'a-Sound.xml': malformedSound,
      'z-Fatal.xml': malformedAirport,
    },
    'SCENERY'
  );
  await fixture.addon(
    'valid',
    {'valid.xml': '<FSData><Airport ident="KAAA"/></FSData>'},
    'SCENERY'
  );
  await addAlias();
}

function verifyRetentionAndPrivacy(): void {
  const later = xmlLogs().filter(
    item => item.attributes['package.name'].value === 'later-failure'
  );
  expect(later.map(item => item.attributes['file.path'].value)).toEqual([
    'a-Sound.xml',
    'z-Fatal.xml',
  ]);
  expect(later.map(item => item.attributes['xml.recovery'].value)).toEqual([
    'skip-file',
    'reject-package',
  ]);
  const aliases = xmlLogs().filter(
    item => item.attributes['package.name'].value === 'alias'
  );
  expect(aliases.map(item => item.attributes['file.path'].value)).toEqual(['linked.xml']);
  expect(envelopeItems().some(item => item.type === 'event')).toBe(false);
  expect(envelopes.join('\n')).not.toContain(sentinel);
  expect(envelopes.join('\n')).not.toContain(fixture.home);
  expect(JSON.stringify(xmlLogs())).not.toContain('<Sound');
}

test(
  'XML logs retain file context, parser reasons, encoding hints, and earlier skips when a package later fails',
  async () => {
    await seedPackages();
    expect(await fixture.run('scan')).toMatchObject({exitCode: 1});
    for (const input of cases) {
      verifyCase(input);
    }

    expect(xmlLogs()).toHaveLength(cases.length + additionalDiagnostics);
    verifyRetentionAndPrivacy();
  },
  cliTimeout
);
