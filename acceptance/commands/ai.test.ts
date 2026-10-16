import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createCliFixture from '#acceptance-cli';

const successExitCode = 0;
const failureExitCode = 1;
const unknownCommandExitCode = 251;

let fixture: Awaited<ReturnType<typeof createCliFixture>>;

const saved = {exitCode: 0, stderr: '', stdout: 'AI configuration saved.\n'};
let configurationFile: string;

beforeEach(async () => {
  fixture = await createCliFixture();
  ({configurationFile} = fixture);
});

afterEach(async () => {
  await fixture.dispose();
});

async function seed(contents: string): Promise<void> {
  await mkdir(path.dirname(configurationFile), {recursive: true});
  await writeFile(configurationFile, contents);
}

async function set(
  provider = 'openai',
  model = 'opaque/model:v1',
  apiKey = 'private-saved-key'
): ReturnType<typeof fixture.run> {
  const result = await fixture.run(
    'ai',
    'set',
    '--provider',
    provider,
    '--model',
    model,
    '--api-key',
    apiKey
  );
  return result;
}

test('set replaces the complete tuple across providers and preserves unrelated settings', async () => {
  await seed(
    JSON.stringify({
      ai: {obsolete: true},
      communityPath: '/saved/Community',
      future: {enabled: true},
      openaipApiKey: 'retained',
      sentry: {dsn: 'invalid-but-retained'},
    })
  );
  for (const provider of ['openai', 'anthropic', 'google']) {
    expect(await set(provider, 'opaque/model:v1', `private-${provider}-key`)).toEqual(
      saved
    );
    expect(await fixture.run('ai', 'get')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout: `Provider: ${provider}\nModel: opaque/model:v1\nAPI key: <redacted>\n`,
    });
    expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
      ai: {apiKey: `private-${provider}-key`, model: 'opaque/model:v1', provider},
      communityPath: '/saved/Community',
      future: {enabled: true},
      openaipApiKey: 'retained',
      sentry: {dsn: 'invalid-but-retained'},
    });
  }
});

test('missing configuration gives setup instructions', async () => {
  const result = await fixture.run('ai', 'get');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('No AI configuration is saved.');
  expect(result.stderr).toContain('ai set --provider');
});

test('invalid model preserves saved bytes and hides input', async () => {
  const model = 'private model';
  const contents = '{"ai":{"old":true},"future":true}\n';
  await seed(contents);
  const result = await set('openai', model);
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('no whitespace or control characters');
  expect(result.stderr).not.toContain('private');
  expect(await readFile(configurationFile, 'utf8')).toBe(contents);
});

test('invalid key preserves saved bytes and hides input', async () => {
  const apiKey = 'private key';
  const contents = '{"ai":{"old":true},"future":true}\n';
  await seed(contents);
  const result = await set('openai', 'opaque-model', apiKey);
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('no whitespace or control characters');
  expect(result.stderr).not.toContain('private');
  expect(await readFile(configurationFile, 'utf8')).toBe(contents);
});

test('get rejects malformed saved configuration without echoing it', async () => {
  const ai = {apiKey: 'private-key', model: 'valid', provider: 'unknown'};
  const contents = JSON.stringify({ai});
  await seed(contents);
  const result = await fixture.run('ai', 'get');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('ai set --provider');
  expect(result.stderr).not.toContain('private');
  expect(await readFile(configurationFile, 'utf8')).toBe(contents);
});

test('corrupt document preserves bytes and fails safely', async () => {
  const contents = '{"ai":{"apiKey":"private-key"},broken}';
  await seed(contents);
  for (const result of [await fixture.run('ai', 'get'), await set()]) {
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Repair the file');
    expect(result.stderr).not.toContain('private');
    expect(result.stderr).not.toContain('SyntaxError');
    expect(result.stderr).not.toContain('Sentry telemetry skipped');
    expect(await readFile(configurationFile, 'utf8')).toBe(contents);
  }
});

test('filesystem errors hide causes and remove temporary files', async () => {
  await mkdir(configurationFile, {recursive: true});
  const result = await set();
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stderr).toContain('Check directory permissions');
  expect(result.stderr).not.toContain('private');
  const files = await readdir(path.dirname(configurationFile));
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('AI help exposes get, set, and all required provider flags', async () => {
  const help = await fixture.run('ai', '--help');
  expect(help.exitCode).toBe(successExitCode);
  expect(help.stdout).toContain('get');
  expect(help.stdout).toContain('set');
  const setHelp = await fixture.run('ai', 'set', '--help');
  expect(setHelp.exitCode).toBe(successExitCode);
  expect(setHelp.stderr).toBe('');
  for (const flag of [
    '--provider',
    '--model',
    '--api-key',
    'openai',
    'anthropic',
    'google',
  ]) {
    expect(setHelp.stdout).toContain(flag);
  }
});

test.each([
  {args: ['ai', 'set'], exitCode: 252},
  {
    args: ['ai', 'set', '--model', 'private-model', '--api-key', 'private-key'],
    exitCode: 252,
  },
  {
    args: ['ai', 'set', '--provider', 'openai', '--api-key', 'private-key'],
    exitCode: 252,
  },
  {
    args: ['ai', 'set', '--provider', 'openai', '--model', 'private-model'],
    exitCode: 252,
  },
  {
    args: [
      'ai',
      'set',
      '--provider',
      'private-unknown',
      '--model',
      'model',
      '--api-key',
      'private-key',
    ],
    exitCode: 252,
  },
  {args: ['ai', 'get', 'private-extra-key'], exitCode: 252},
  {args: ['ai', 'private-unknown-key'], exitCode: 251},
  {args: ['--log-level', 'private-option-key', 'ai', 'get'], exitCode: 251},
  {args: ['--unknown', 'ai', 'get', 'private-extra-key'], exitCode: 252},
  {
    args: [
      'ai',
      'set',
      '--provider',
      'openai',
      '--model',
      'model',
      '--api-key',
      'private-key',
      '--private-flag',
    ],
    exitCode: 252,
  },
])(
  'parser failure %# hides secrets and preserves bytes',
  async ({args, exitCode}: Readonly<{args: readonly string[]; exitCode: number}>) => {
    const contents = '{"ai":{"old":true},"future":true}\n';
    await seed(contents);
    const result = await fixture.run(...args);
    expect(result).toMatchObject({
      exitCode,
      stderr: 'Invalid AI command arguments. Run flightsim-things ai --help for usage.\n',
    });
    expect(result.stdout).toContain('USAGE');
    expect(result.stdout).not.toContain('private');
    expect(await readFile(configurationFile, 'utf8')).toBe(contents);
  }
);

async function assertAiInvocations(): Promise<void> {
  expect(await set()).toEqual(saved);
  expect(await fixture.run('ai', 'get')).toMatchObject({
    exitCode: 0,
    stdout: 'Provider: openai\nModel: opaque/model:v1\nAPI key: <redacted>\n',
  });
  expect(await set('openai', 'model', 'private invalid-key')).toMatchObject({
    exitCode: 1,
  });
  expect(await fixture.run('ai', 'get', 'private-extra-key')).toMatchObject({
    exitCode: 252,
  });
  expect(
    await fixture.run('--log-level', 'private-option-key', 'ai', 'get')
  ).toMatchObject({
    exitCode: 251,
  });
}

test('AI invocations bypass telemetry for valid and malformed commands', async () => {
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
    await seed(
      JSON.stringify({
        sentry: {
          dsn: `http://publickey@127.0.0.1:${server.port}/123`,
          sampleRates: {errors: 1, logs: 1, metrics: 1, traces: 1},
        },
      })
    );
    await assertAiInvocations();
    expect(envelopes).toEqual([]);
    expect(await fixture.run('hello')).toMatchObject({exitCode: 0});
    expect(envelopes.join('\n')).toContain('cli.command.completed');
  } finally {
    await server.stop(true);
  }
});

test.each(['{broken', '{"sentry":{"dsn":"private-invalid-dsn"}}'])(
  'malformed leading AI arguments bypass invalid telemetry configuration %#',
  async contents => {
    await seed(contents);
    const result = await fixture.run('--log-level', 'private-option-key', 'ai', 'get');
    expect(result.exitCode).toBe(unknownCommandExitCode);
    expect(result.stderr).toBe(
      'Invalid AI command arguments. Run flightsim-things ai --help for usage.\n'
    );
    expect(result.stdout).not.toContain('private');
    expect(await readFile(configurationFile, 'utf8')).toBe(contents);
  }
);
