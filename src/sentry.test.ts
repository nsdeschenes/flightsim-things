import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('index.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/sentry-cli/context'
);
const envelopes: string[] = [];
const signalTypes = ['event', 'log', 'trace_metric', 'transaction'];
let homeDirectory: string;
let configurationFile: string;
let server: Bun.Server<unknown>;
let dsn: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'cli-test-'));
  configurationFile = path.join(homeDirectory, '.flightsim-things/config.json');
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
});

afterEach(async () => {
  await server.stop(true);
  await rm(homeDirectory, {force: true, recursive: true});
});

type CommandResult = Readonly<{exitCode: number; stderr: string; stdout: string}>;

async function run(...args: readonly string[]): Promise<CommandResult> {
  let executable = [process.execPath, cli];
  const binary = process.env.FLIGHTSIM_TEST_BINARY;
  if (typeof binary === 'string' && binary !== '') {
    executable = [binary];
  }

  const child = Bun.spawn([...executable, ...args], {
    cwd: homeDirectory,
    env: {...process.env, HOME: homeDirectory, USERPROFILE: homeDirectory},
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return {exitCode, stderr, stdout};
}

async function set(input = dsn, rate = '0'): Promise<CommandResult> {
  const result = await run(
    'sentry',
    'set',
    '--dsn',
    input,
    '--errors',
    rate,
    '--logs',
    rate,
    '--metrics',
    rate,
    '--traces',
    rate
  );
  return result;
}

async function seedConfiguration(contents: string): Promise<void> {
  await mkdir(path.dirname(configurationFile), {recursive: true});
  await writeFile(configurationFile, contents);
}

function envelopeTypes(): string[] {
  return envelopes
    .flatMap(envelope =>
      envelope
        .split('\n')
        .slice(1)
        .filter((line, index) => index % 2 === 0 && line !== '')
        .flatMap(line => {
          const record: unknown = JSON.parse(line);
          if (
            typeof record === 'object' &&
            record &&
            'type' in record &&
            typeof record.type === 'string'
          ) {
            return [record.type];
          }

          return [];
        })
    )
    .filter(type => signalTypes.includes(type));
}

test('Sentry set, partial update, and JSON get preserve Community configuration and unknown settings', async () => {
  await seedConfiguration(
    JSON.stringify({communityPath: homeDirectory, future: {enabled: true}})
  );
  expect(await set()).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'Sentry configuration saved.\n',
  });
  expect(await run('sentry', 'update', '--logs', '0.25', '--traces', '0')).toMatchObject({
    exitCode: 0,
  });
  const expected = {dsn, sampleRates: {errors: 0, logs: 0.25, metrics: 0, traces: 0}};
  expect(await run('sentry', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: `${JSON.stringify(expected)}\n`,
  });
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    communityPath: homeDirectory,
    future: {enabled: true},
    sentry: expected,
  });
  const stats = await stat(configurationFile);
  expect(stats.mode % 0o1000).toBe(0o600);
  expect(await run('community-path', 'set', homeDirectory)).toMatchObject({
    exitCode: 0,
  });
  expect(await run('sentry', 'get')).toMatchObject({
    stdout: `${JSON.stringify(expected)}\n`,
  });
});

test.each([{args: ['sentry', 'get']}, {args: ['sentry', 'update', '--logs', '1']}])(
  'unset configuration explains how to create it for %s',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    const result = await run(...args);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('sentry set');
  }
);

test('update requires at least one option', async () => {
  const result = await run('sentry', 'update');
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('at least one option');
});

test.each(['-0.1', '1.1', 'NaN', 'Infinity', '', 'junk'])(
  'invalid rate %s preserves the saved bytes',
  async rate => {
    expect(await set()).toMatchObject({exitCode: 0});
    const previous = await readFile(configurationFile, 'utf8');
    const result = await run('sentry', 'update', '--errors', rate);
    expect(result.exitCode).not.toBe(0);
    expect(await readFile(configurationFile, 'utf8')).toBe(previous);
  }
);

test.each([
  '',
  'https://localhost/123',
  'https://key@☃.net/1',
  'https://key@localhost/1\t2',
  'https://key@localhost/1\n2',
  String.raw`https://key@localhost\1`,
  'ftp://publickey@localhost/123',
  'https://publickey@localhost/nope',
  'https://publickey:secret@localhost/123',
  'https://publickey@localhost/123?token=private',
])('invalid DSN %s preserves the saved bytes', async input => {
  expect(await set()).toMatchObject({exitCode: 0});
  const previous = await readFile(configurationFile, 'utf8');
  const result = await set(input);
  expect(result.exitCode).not.toBe(0);
  expect(await readFile(configurationFile, 'utf8')).toBe(previous);
});

test('IPv6 Sentry DSNs persist without URL normalization', async () => {
  const ipv6Dsn = 'http://key@[::1]:9000/123';
  expect(await set(ipv6Dsn)).toMatchObject({exitCode: 0});
  const result = await run('sentry', 'get');
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    dsn: ipv6Dsn,
    sampleRates: {errors: 0, logs: 0, metrics: 0, traces: 0},
  });
});

test('set requires all four sampling rates and help lists commands', async () => {
  expect(await run('sentry', 'set', '--dsn', dsn)).toMatchObject({
    exitCode: 252,
  });
  const help = await run('sentry', '--help');
  expect(help.exitCode).toBe(0);
  for (const name of ['get', 'set', 'update']) {
    expect(help.stdout).toContain(name);
  }
});

test('malformed configuration skips telemetry and preserves bytes on set and update', async () => {
  await seedConfiguration('{broken');
  const greeting = await run('hello');
  expect(greeting).toMatchObject({exitCode: 0, stdout: 'Hello via Bun!\n'});
  expect(greeting.stderr).toContain('Sentry telemetry skipped.');
  const get = await run('sentry', 'get');
  expect(get.exitCode).toBe(1);
  expect(get.stderr).toContain('Repair the file');
  expect(await set()).toMatchObject({exitCode: 1});
  expect(await run('sentry', 'update', '--logs', '1')).toMatchObject({exitCode: 1});
  expect(await readFile(configurationFile, 'utf8')).toBe('{broken');
});

test('failed atomic replacement removes temporary files', async () => {
  await mkdir(configurationFile, {recursive: true});
  expect(await set()).toMatchObject({exitCode: 1});
  const files = await readdir(path.dirname(configurationFile));
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test.each(['sentry', 'openaip-key'])(
  'malformed leading arguments skip telemetry for %s',
  async command => {
    await seedConfiguration('{broken');
    const result = await run('--log-level', 'private-option-key', command, 'get');
    expect(result.exitCode).toBe(251);
    expect(result.stderr).not.toContain('Sentry telemetry skipped');
    expect(await readFile(configurationFile, 'utf8')).toBe('{broken');
  }
);

test('official SDK delivers logs, metrics, and traces before a successful command exits', async () => {
  expect(await set(dsn, '1')).toMatchObject({exitCode: 0});
  expect(envelopes).toEqual([]);
  expect(await run('hello')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'Hello via Bun!\n',
  });
  expect(envelopeTypes().toSorted()).toEqual(['log', 'trace_metric', 'transaction']);
  expect(envelopes.join('\n')).toContain('cli.command.completed');
  expect(envelopes.join('\n')).not.toContain(homeDirectory);
});

test.each(['ai', 'openaip-key', 'sentry'])(
  'Community directory named %s still emits telemetry',
  async directoryName => {
    const directory = path.join(homeDirectory, directoryName);
    await mkdir(directory);
    expect(await set(dsn, '1')).toMatchObject({exitCode: 0});
    expect(await run('community-path', 'set', directoryName)).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `${directory}\n`,
    });
    expect(envelopeTypes().toSorted()).toEqual(['log', 'trace_metric', 'transaction']);
    expect(envelopes.join('\n')).toContain('cli.command.completed');
  }
);

test.each([
  {output: 'flightsim-things community-path set', prefix: ['--help', 'false']},
  {output: 'flightsim-things v', prefix: ['-v', 'false']},
])(
  'boolean-valued builtin $prefix remains a control invocation',
  async ({prefix, output}) => {
    expect(await set(dsn, '1')).toMatchObject({exitCode: 0});
    const result = await run(...prefix, 'community-path', 'set', 'ai');
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(result.stdout).toContain(output);
    expect(envelopes).toEqual([]);
  }
);

test('official SDK captures a real filesystem command failure before exit', async () => {
  expect(await set(dsn, '1')).toMatchObject({exitCode: 0});
  expect(await run('community-path', 'set', 'missing-private-directory')).toMatchObject({
    exitCode: 1,
  });
  expect(envelopeTypes().toSorted()).toEqual([
    'event',
    'log',
    'trace_metric',
    'transaction',
  ]);
});

test.each([
  {args: ['hello', '--private-invalid-flag']},
  {args: ['--help']},
  {args: ['unknown-private-command']},
  {args: ['sentry', 'get']},
  {args: ['--help', 'sentry']},
])(
  'expected CLI control command %s does not send telemetry',
  async ({args}: Readonly<{args: readonly string[]}>) => {
    expect(await set(dsn, '1')).toMatchObject({exitCode: 0});
    await run(...args);
    expect(envelopeTypes()).toEqual([]);
    expect(envelopes.join('\n')).not.toContain('private-invalid');
  }
);

test('zero sampling rates drop all four signals', async () => {
  expect(await set()).toMatchObject({exitCode: 0});
  expect(await run('hello')).toMatchObject({exitCode: 0});
  expect(await run('community-path', 'get')).toMatchObject({exitCode: 1});
  expect(envelopeTypes()).toEqual([]);
});

test.each([
  ['errors', 'event'],
  ['logs', 'log'],
  ['metrics', 'trace_metric'],
  ['traces', 'transaction'],
])('sampling %s independently keeps only %s', async (signal, itemType) => {
  expect(await set()).toMatchObject({exitCode: 0});
  expect(await run('sentry', 'update', `--${signal}`, '1')).toMatchObject({
    exitCode: 0,
  });
  expect(await run('community-path', 'get')).toMatchObject({exitCode: 1});
  expect(envelopeTypes()).toEqual([itemType]);
});
