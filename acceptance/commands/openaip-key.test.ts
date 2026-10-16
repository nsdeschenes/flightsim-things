import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, readFile, readdir, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createCliFixture from '#acceptance-cli';

const successExitCode = 0;
const failureExitCode = 1;
const invalidArgumentsExitCode = 252;
const permissionBits = 0o1000;
const privateFileMode = 0o600;
const invalidSavedValue = 42;

let fixture: Awaited<ReturnType<typeof createCliFixture>>;

let homeDirectory: string;
let configurationFile: string;

beforeEach(async () => {
  fixture = await createCliFixture();
  homeDirectory = fixture.home;
  configurationFile = path.join(homeDirectory, '.flightsim-things/config.json');
});

afterEach(async () => {
  await fixture.dispose();
});

async function seedConfiguration(contents: string): Promise<void> {
  await mkdir(path.dirname(configurationFile), {recursive: true});
  await writeFile(configurationFile, contents);
}

test('set creates and replaces the exact key across CLI processes without echoing it', async () => {
  const firstKey = 'opaque/key+=?first';
  const saved = {exitCode: 0, stderr: '', stdout: 'OpenAIP API key saved.\n'};
  expect(await fixture.run('openaip-key', 'set', firstKey)).toEqual(saved);
  expect(await fixture.run('openaip-key', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'opaque/key+=?first\n',
  });
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    openaipApiKey: 'opaque/key+=?first',
  });
  expect(await fixture.run('openaip-key', 'set', 'opaque-key:second')).toEqual(saved);
  expect(await fixture.run('openaip-key', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'opaque-key:second\n',
  });
  const [stats, files] = await Promise.all([
    stat(configurationFile),
    readdir(path.dirname(configurationFile)),
  ]);
  expect(stats.mode % permissionBits).toBe(privateFileMode);
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('set repairs an invalid saved key and preserves all other settings', async () => {
  await seedConfiguration(
    JSON.stringify({
      communityPath: '/saved/Community',
      future: {enabled: true},
      openaipApiKey: 42,
      sentry: {dsn: 'retained'},
    })
  );
  expect(await fixture.run('openaip-key', 'set', 'replacement-key')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'OpenAIP API key saved.\n',
  });
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    communityPath: '/saved/Community',
    future: {enabled: true},
    openaipApiKey: 'replacement-key',
    sentry: {dsn: 'retained'},
  });
});

test('an unset key explains where to get a key and how to save it', async () => {
  const result = await fixture.run('openaip-key', 'get');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('No OpenAIP API key is saved.');
  expect(result.stderr).toContain('https://www.openaip.net/');
  expect(result.stderr).toContain('API clients');
  expect(result.stderr).toContain('openaip-key set <key>');
});

test.each([
  '',
  ' ',
  ' key',
  'key ',
  'private key',
  'private\tkey',
  'private\nkey',
  'private\u007Fkey',
  'private\u0085key',
])(
  'invalid input %# preserves the saved bytes and does not print the key',
  async input => {
    await seedConfiguration('{"openaipApiKey":"previous-key","future":true}\n');
    const result = await fixture.run('openaip-key', 'set', input);
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('contain no whitespace or control characters');
    expect(result.stderr).not.toContain('private');
    expect(await readFile(configurationFile, 'utf8')).toBe(
      '{"openaipApiKey":"previous-key","future":true}\n'
    );
  }
);

test.each([invalidSavedValue, {}, '', ' ', 'private key', 'private\u0000key'])(
  'get rejects invalid saved key %# without printing it',
  async input => {
    await seedConfiguration(JSON.stringify({openaipApiKey: input}));
    const result = await fixture.run('openaip-key', 'get');
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('openaip-key set <key>');
    expect(result.stderr).not.toContain('private');
  }
);

test.each(['{"openaipApiKey":"private-secret",broken}', '[]', 'null'])(
  'corrupt configuration %# fails safely and preserves the file',
  async contents => {
    await seedConfiguration(contents);
    for (const args of [['get'], ['set', 'private-replacement']]) {
      const result = await fixture.run('openaip-key', ...args);
      expect(result.exitCode).toBe(failureExitCode);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Repair the file');
      expect(result.stderr).not.toContain('private');
      expect(result.stderr).not.toContain('SyntaxError');
      expect(result.stderr).not.toContain('Sentry telemetry skipped');
      expect(await readFile(configurationFile, 'utf8')).toBe(contents);
    }
  }
);

test('filesystem failure reports a safe error and preserves the configuration directory', async () => {
  await mkdir(configurationFile, {recursive: true});
  const result = await fixture.run('openaip-key', 'set', 'private-replacement');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stderr).toContain('Check directory permissions');
  expect(result.stderr).not.toContain('private-replacement');
  const files = await readdir(path.dirname(configurationFile));
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('root help lists the OpenAIP key command', async () => {
  const rootHelp = await fixture.run('--help');
  expect(rootHelp.exitCode).toBe(successExitCode);
  expect(rootHelp.stdout).toContain('openaip-key');
});

test('help lists get and set with the OpenAIP key instructions', async () => {
  const help = await fixture.run('openaip-key', '--help');
  expect(help.exitCode).toBe(successExitCode);
  expect(help.stderr).toBe('');
  expect(help.stdout).toContain('get');
  expect(help.stdout).toContain('set');
  expect(help.stdout).toContain('https://www.openaip.net/');
  expect(help.stdout).toContain('API clients');
});

test('set help lists the key argument and OpenAIP link', async () => {
  const setHelp = await fixture.run('openaip-key', 'set', '--help');
  expect(setHelp.exitCode).toBe(successExitCode);
  expect(setHelp.stderr).toBe('');
  expect(setHelp.stdout).toContain('<key>');
  expect(setHelp.stdout).toContain('https://www.openaip.net/');
});

test('set requires a key argument', async () => {
  const result = await fixture.run('openaip-key', 'set');
  expect(result.exitCode).toBe(invalidArgumentsExitCode);
  expect(result.stderr).toContain('openaip-key --help');
});

test('an AI-named key keeps OpenAIP parser guidance and hides extra credentials', async () => {
  const result = await fixture.run('openaip-key', 'set', 'ai', 'private-extra-key');
  expect(result.exitCode).toBe(invalidArgumentsExitCode);
  expect(result.stderr).toBe(
    'Invalid OpenAIP key command arguments. Run flightsim-things openaip-key --help for usage.\n'
  );
  expect(result.stdout).toContain('USAGE');
  expect(result.stdout).not.toContain('private-extra-key');
});

test.each([
  {
    args: ['openaip-key', 'set', 'private-primary-key', 'private-extra-key'],
    exitCode: 252,
  },
  {args: ['openaip-key', 'get', 'private-extra-key'], exitCode: 252},
  {args: ['openaip-key', 'set', 'private-primary-key', '--private-flag'], exitCode: 252},
  {args: ['openaip-key', 'private-unknown-key'], exitCode: 251},
  {args: ['--log-level', 'private-option-key', 'openaip-key', 'get'], exitCode: 251},
])(
  'parser failure %# hides credentials and preserves the saved bytes',
  async ({args, exitCode}: Readonly<{args: readonly string[]; exitCode: number}>) => {
    const contents = '{"openaipApiKey":"previous-key","future":true}\n';
    await seedConfiguration(contents);
    const result = await fixture.run(...args);
    expect(result.exitCode).toBe(exitCode);
    expect(result.stdout).toContain('USAGE');
    expect(result.stdout).not.toContain('private');
    expect(result.stderr).not.toContain('private');
    expect(result.stderr).toContain('openaip-key --help');
    expect(await readFile(configurationFile, 'utf8')).toBe(contents);
  }
);

test('OpenAIP key commands exclude credentials and failures from telemetry', async () => {
  const envelopes: string[] = [];
  const server = Bun.serve({
    async fetch(request: Readonly<{text: () => Promise<string>}>): Promise<Response> {
      envelopes.push(await request.text());
      return new Response('{}', {headers: {'Content-Type': 'application/json'}});
    },
    hostname: '127.0.0.1',
    port: 0,
  });
  try {
    await seedConfiguration(
      JSON.stringify({
        sentry: {
          dsn: `http://publickey@127.0.0.1:${server.port}/123`,
          sampleRates: {errors: 1, logs: 1, metrics: 1, traces: 1},
        },
      })
    );
    for (const {args, expected} of [
      {args: ['get'], expected: {exitCode: 1}},
      {
        args: ['set', 'private-openaip-key'],
        expected: {exitCode: 0, stdout: 'OpenAIP API key saved.\n'},
      },
      {args: ['get'], expected: {exitCode: 0, stdout: 'private-openaip-key\n'}},
      {args: ['set', 'private invalid-key'], expected: {exitCode: 1}},
      {
        args: ['set', 'private-openaip-key', 'private-extra-key'],
        expected: {exitCode: 252},
      },
    ]) {
      expect(await fixture.run('openaip-key', ...args)).toMatchObject(expected);
    }

    expect(envelopes).toEqual([]);
    expect(await fixture.run('hello')).toMatchObject({exitCode: 0});
    expect(envelopes.join('\n')).toContain('cli.command.completed');
  } finally {
    await server.stop(true);
  }
});
