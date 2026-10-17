import {afterEach, beforeEach, expect, test} from 'bun:test';
import {rm} from 'node:fs/promises';
import path from 'node:path';

import {Option, Schema} from 'effect';
import {Array as array, Record as record, Struct as struct} from 'effect/Schema';

import createFixture from '#acceptance-scanner';

const cliTimeout = 60_000;
const successExitCode = 0;
const failureExitCode = 1;
const warningCount = 6;
const failureCount = 2;
const detailLimit = 5;
const envelopeHeaderLines = 1;
const itemLines = 2;
const payloadOffset = 1;
const log = struct({
  attributes: record(Schema.String, Schema.Unknown),
  body: Schema.String,
  level: Schema.String,
});
const logContainer = struct({items: array(log)});
const itemHeader = struct({type: Schema.String});
const stringAttribute = struct({type: Schema.String, value: Schema.String});
const diagnosticAttributes = struct({
  'diagnostic.message': stringAttribute,
  'package.name': stringAttribute,
});
const decodeHeader = Schema.decodeUnknownOption(itemHeader);
const decodeLogs = Schema.decodeUnknownOption(logContainer);
const decodeAttributes = Schema.decodeUnknownOption(diagnosticAttributes);
const envelopes: string[] = [];
let fixture: Awaited<ReturnType<typeof createFixture>>;
let server: Bun.Server<unknown>;
let dsn: string;

beforeEach(async () => {
  fixture = await createFixture();
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
  envelopes.length = 0;
  server = Bun.serve({
    async fetch(request: Readonly<{text: () => Promise<string>}>): Promise<Response> {
      envelopes.push(await request.text());
      return new Response('{}', {headers: {'Content-Type': 'application/json'}});
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  dsn = `http://publickey@127.0.0.1:${server.port}/123`;
  await fixture.addon(
    'warning-package',
    Object.fromEntries(
      Array.from({length: warningCount}, (_value, index) => [
        `sound-${index}.xml`,
        '<Sound><broken',
      ])
    )
  );
  await fixture.addon('malformed-airport', {'airport.xml': '<FSData><Airport'});
  const missingFile = await fixture.addon('missing-file', {'aircraft.cfg': ''});
  await rm(path.join(missingFile, 'aircraft.cfg'));
});

afterEach(async () => {
  await server.stop(true);
  await fixture.dispose();
});

async function configureTelemetry(logRate: string): Promise<void> {
  expect(
    await fixture.run(
      'sentry',
      'set',
      '--dsn',
      dsn,
      '--errors',
      '1',
      '--logs',
      logRate,
      '--metrics',
      '0',
      '--traces',
      '0'
    )
  ).toMatchObject({exitCode: 0});
}

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
        const {type} = Option.getOrThrow(decodeHeader(parsed));
        items.push({payload: JSON.parse(payload), type});
      }
    }

    return items;
  });
}

function scanLogs(): readonly Readonly<{
  attributes: typeof diagnosticAttributes.Type;
  body: string;
  level: string;
}>[] {
  return envelopeItems()
    .filter(item => item.type === 'log')
    .flatMap(item => Option.getOrThrow(decodeLogs(item.payload)).items)
    .filter(item => item.body.startsWith('Package scan '))
    .map(item => ({
      ...item,
      attributes: Option.getOrThrow(decodeAttributes(item.attributes)),
    }));
}

function verifyWarnings(): void {
  const warnings = scanLogs().filter(item => item.body === 'Package scan warning');
  expect(warnings).toHaveLength(warningCount);
  for (const warning of warnings) {
    expect(warning.level).toBe('warn');
    expect(warning.attributes['package.name']).toEqual({
      type: 'string',
      value: 'warning-package',
    });
  }

  for (const index of Array.from({length: warningCount}).keys()) {
    expect(
      warnings.some(warning =>
        warning.attributes['diagnostic.message'].value.includes(`sound-${index}.xml`)
      )
    ).toBe(true);
  }
}

function verifyFailures(): void {
  const failures = scanLogs().filter(item => item.body === 'Package scan failed');
  expect(failures).toHaveLength(failureCount);
  for (const failure of failures) {
    expect(failure.level).toBe('error');
    expect(failure.attributes['diagnostic.message'].type).toBe('string');
    expect(failure.attributes['diagnostic.message'].value).not.toBe('');
  }

  expect(
    failures.map(failure => failure.attributes['package.name'].value).toSorted()
  ).toEqual(['malformed-airport', 'missing-file']);
  expect(envelopeItems().some(item => item.type === 'event')).toBe(false);
  expect(envelopes.join('\n')).not.toContain(fixture.home);
}

function verifyOutput(result: Awaited<ReturnType<typeof fixture.run>>): void {
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stdout).toContain('2 packages failed. 6 warnings.');
  expect(result.stderr.match(/Warning for /gu)).toHaveLength(detailLimit);
  expect(result.stderr).toContain('1 additional warnings omitted');
  expect(result.stderr).toContain('2 packages could not be scanned');
}

test(
  'scan sends every diagnostic as a structured log without creating issues for incomplete scans',
  async () => {
    await configureTelemetry('1');
    const result = await fixture.run('scan');
    verifyOutput(result);
    verifyWarnings();
    verifyFailures();
  },
  cliTimeout
);

test(
  'zero log sampling preserves scan output and exit status without sending diagnostics',
  async () => {
    const disabled = await fixture.run('scan');
    expect(disabled.exitCode).toBe(failureExitCode);
    expect(envelopes).toEqual([]);
    await configureTelemetry('0');
    expect(await fixture.run('scan')).toEqual(disabled);
    expect(
      envelopeItems().some(item => item.type === 'log' || item.type === 'event')
    ).toBe(false);
    expect(disabled.stdout).toContain('Scanned 1 packages');
    expect(disabled.stderr.match(/Warning for /gu)).toHaveLength(detailLimit);
    expect(disabled.exitCode).not.toBe(successExitCode);
  },
  cliTimeout
);
