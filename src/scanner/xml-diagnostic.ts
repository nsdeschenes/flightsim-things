import {logger} from '@sentry/effect/server';

import type XmlContext from './xml-context.ts';
import safeXmlMessage from './xml-message.ts';

type XmlContents = Readonly<Pick<Blob, keyof Blob>>;
type XmlHints = Readonly<{
  root: string;
  declaredEncoding: string;
  byteEncoding: string;
}>;
type XmlFailure = Readonly<{
  category: 'xml.parse' | 'xml.airport-validation';
  recovery: 'skip-file' | 'reject-package';
  error: unknown;
}>;
const prefixLimit = 8192;
const firstIndex = 0;
const firstPair = 2;
const unknownHints: XmlHints = {
  byteEncoding: 'unknown',
  declaredEncoding: 'unknown',
  root: 'unknown',
};
const openingRoot =
  /^(?:\uFEFF)?\s*(?:<!--(?:[^-]|-(?!-))*-->\s*)*(?:<\?xml\s+[^?]*\?>\s*)?(?:<!--(?:[^-]|-(?!-))*-->\s*)*<(?<token>[a-z_][a-z\d_.:-]{0,127})(?=[\t\r\n />]|$)/iu;
const declaredEncoding =
  /^\s*<\?xml\s+[^?]*\bencoding\s*=\s*["'](?<token>[a-z][a-z\d_.-]{0,39})["']/iu;

function byteEncoding(opening: string): 'utf8' | 'utf-16le' | 'utf-16be' {
  if (opening === 'fffe' || opening === '3c00') {
    return 'utf-16le';
  }

  if (opening === 'feff' || opening === '003c') {
    return 'utf-16be';
  }

  return 'utf8';
}

function token(
  pattern: Readonly<Pick<RegExp, 'exec'>>,
  source: string,
  fallback: string
): string {
  const match = pattern.exec(source);
  const groups = match && match.groups;
  if (groups && typeof groups.token === 'string') {
    return groups.token;
  }

  return fallback;
}

function sourceHints(source: string, encoding: string): XmlHints {
  if (source.includes('\0')) {
    return {...unknownHints, byteEncoding: encoding};
  }

  return {
    byteEncoding: encoding,
    declaredEncoding: token(declaredEncoding, source, 'unspecified'),
    root: token(openingRoot, source, 'unknown'),
  };
}

async function xmlHints(contents: XmlContents): Promise<XmlHints> {
  let encoding = unknownHints.byteEncoding;
  try {
    const bytes = new Uint8Array(await contents.arrayBuffer()).subarray(
      firstIndex,
      prefixLimit
    );
    const detected = byteEncoding(
      Buffer.from(bytes).subarray(firstIndex, firstPair).toString('hex')
    );
    if (detected !== 'utf8') {
      encoding = detected;
    }

    const decoder = new TextDecoder(detected, {fatal: true});
    return sourceHints(
      decoder.decode(bytes, {stream: contents.size > prefixLimit}),
      decoder.encoding
    );
  } catch {
    return {...unknownHints, byteEncoding: encoding};
  }
}

function errorDetails(error: unknown): Readonly<{type: string; message: string}> {
  if (error instanceof Error) {
    return {message: safeXmlMessage(error.message), type: error.name};
  }

  return {message: 'XML metadata validation failed', type: 'unknown'};
}

async function reportXmlDiagnostic(
  context: XmlContext,
  contents: XmlContents,
  failure: XmlFailure
): Promise<void> {
  const hints = await xmlHints(contents);
  const error = errorDetails(failure.error);
  const attributes = {
    'diagnostic.category': failure.category,
    'diagnostic.message': error.message,
    'error.message': error.message,
    'error.type': error.type,
    'file.path': context.filePath,
    'package.name': context.packageName,
    'xml.byte_encoding': hints.byteEncoding,
    'xml.declared_encoding': hints.declaredEncoding,
    'xml.recovery': failure.recovery,
    'xml.root': hints.root,
  };
  if (failure.recovery === 'skip-file') {
    logger.info('XML metadata diagnostic', attributes);
  } else {
    logger.error('XML metadata diagnostic', attributes);
  }
}

export default reportXmlDiagnostic;
