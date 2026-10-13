import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../index.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/openaip-key/context'
);
let homeDirectory: string;
let configurationFile: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'cli-test-'));
  configurationFile = path.join(homeDirectory, '.flightsim-things/config.json');
});

afterEach(async () => {
  await rm(homeDirectory, {force: true, recursive: true});
});

async function run(
  ...args: readonly string[]
): Promise<Readonly<{exitCode: number; stdout: string; stderr: string}>> {
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

async function seedConfiguration(contents: string): Promise<void> {
  await mkdir(path.dirname(configurationFile), {recursive: true});
  await writeFile(configurationFile, contents);
}

test('set creates and replaces the exact key across CLI processes without echoing it', async () => {
  const firstKey = 'opaque/key+=?first';
  const saved = {exitCode: 0, stderr: '', stdout: 'OpenAIP API key saved.\n'};
  expect(await run('openaip-key', 'set', firstKey)).toEqual(saved);
  expect(await run('openaip-key', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'opaque/key+=?first\n',
  });
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    openaipApiKey: 'opaque/key+=?first',
  });
  expect(await run('openaip-key', 'set', 'opaque-key:second')).toEqual(saved);
  expect(await run('openaip-key', 'get')).toEqual({
    exitCode: 0,
    stderr: '',
    stdout: 'opaque-key:second\n',
  });
  const stats = await stat(configurationFile);
  expect(stats.mode % 0o1000).toBe(0o600);
  expect(await readdir(path.dirname(configurationFile))).toEqual(['config.json']);
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
  expect(await run('openaip-key', 'set', 'replacement-key')).toEqual({
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
  const result = await run('openaip-key', 'get');
  expect(result.exitCode).toBe(1);
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
    const result = await run('openaip-key', 'set', input);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('contain no whitespace or control characters');
    expect(result.stderr).not.toContain('private');
    expect(await readFile(configurationFile, 'utf8')).toBe(
      '{"openaipApiKey":"previous-key","future":true}\n'
    );
  }
);

test.each([42, {}, '', ' ', 'private key', 'private\u0000key'])(
  'get rejects invalid saved key %# without printing it',
  async input => {
    await seedConfiguration(JSON.stringify({openaipApiKey: input}));
    const result = await run('openaip-key', 'get');
    expect(result.exitCode).toBe(1);
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
      const result = await run('openaip-key', ...args);
      expect(result.exitCode).toBe(1);
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
  const result = await run('openaip-key', 'set', 'private-replacement');
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Check directory permissions');
  expect(result.stderr).not.toContain('private-replacement');
  expect(await readdir(path.dirname(configurationFile))).toEqual(['config.json']);
});

test('root help lists the OpenAIP key command', async () => {
  const rootHelp = await run('--help');
  expect(rootHelp.exitCode).toBe(0);
  expect(rootHelp.stdout).toContain('openaip-key');
});

test('help lists get and set with the OpenAIP key instructions', async () => {
  const help = await run('openaip-key', '--help');
  expect(help.exitCode).toBe(0);
  expect(help.stderr).toBe('');
  expect(help.stdout).toContain('get');
  expect(help.stdout).toContain('set');
  expect(help.stdout).toContain('https://www.openaip.net/');
  expect(help.stdout).toContain('API clients');
});

test('set help lists the key argument and OpenAIP link', async () => {
  const setHelp = await run('openaip-key', 'set', '--help');
  expect(setHelp.exitCode).toBe(0);
  expect(setHelp.stderr).toBe('');
  expect(setHelp.stdout).toContain('<key>');
  expect(setHelp.stdout).toContain('https://www.openaip.net/');
});

test('set requires a key argument', async () => {
  const result = await run('openaip-key', 'set');
  expect(result.exitCode).toBe(252);
  expect(result.stderr).toContain('openaip-key --help');
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
    const result = await run(...args);
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
      expect(await run('openaip-key', ...args)).toMatchObject(expected);
    }
    expect(envelopes).toEqual([]);
    expect(await run('hello')).toMatchObject({exitCode: 0});
    expect(envelopes.join('\n')).toContain('cli.command.completed');
  } finally {
    await server.stop(true);
  }
});
