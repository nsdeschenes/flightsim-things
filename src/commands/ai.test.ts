import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const cli = fileURLToPath(new URL('../index.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/vercel-ai/context'
);
const saved = {exitCode: 0, stderr: '', stdout: 'AI configuration saved.\n'};
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
): Promise<Readonly<{exitCode: number; stderr: string; stdout: string}>> {
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

async function seed(contents: string): Promise<void> {
  await mkdir(path.dirname(configurationFile), {recursive: true});
  await writeFile(configurationFile, contents);
}

async function set(
  provider = 'openai',
  model = 'opaque/model:v1',
  apiKey = 'private-saved-key'
): ReturnType<typeof run> {
  const result = await run(
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
    expect(await run('ai', 'get')).toEqual({
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

  const [stats, files] = await Promise.all([
    stat(configurationFile),
    readdir(path.dirname(configurationFile)),
  ]);
  expect(stats.mode % 0o1000).toBe(0o600);
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('concurrent AI and OpenAIP saves retain both configurations', async () => {
  const results = await Promise.all([
    set(),
    run('openaip-key', 'set', 'private-openaip-key'),
  ]);
  expect(results).toEqual([
    saved,
    {exitCode: 0, stderr: '', stdout: 'OpenAIP API key saved.\n'},
  ]);
  expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
    ai: {apiKey: 'private-saved-key', model: 'opaque/model:v1', provider: 'openai'},
    openaipApiKey: 'private-openaip-key',
  });
});

test('missing configuration gives setup instructions', async () => {
  const result = await run('ai', 'get');
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('No AI configuration is saved.');
  expect(result.stderr).toContain('ai set --provider');
});

test.each([
  '',
  ' ',
  'private model',
  'private\tmodel',
  'private\nmodel',
  'private\u007Fmodel',
  'private\u0085model',
  'private-model\n',
])('invalid model %# preserves saved bytes and hides input', async model => {
  const contents = '{"ai":{"old":true},"future":true}\n';
  await seed(contents);
  const result = await set('openai', model);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('no whitespace or control characters');
  expect(result.stderr).not.toContain('private');
  expect(await readFile(configurationFile, 'utf8')).toBe(contents);
});

test.each([
  '',
  ' ',
  'private key',
  'private\tkey',
  'private\nkey',
  'private\u007Fkey',
  'private\u0085key',
  'private-key\n',
])('invalid key %# preserves saved bytes and hides input', async apiKey => {
  const contents = '{"ai":{"old":true},"future":true}\n';
  await seed(contents);
  const result = await set('openai', 'opaque-model', apiKey);
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('no whitespace or control characters');
  expect(result.stderr).not.toContain('private');
  expect(await readFile(configurationFile, 'utf8')).toBe(contents);
});

test.each([
  42,
  {},
  {apiKey: 'private-key', model: 'valid', provider: 'unknown'},
  {apiKey: 'private-key', model: '', provider: 'openai'},
  {apiKey: 'private-key', model: 'private model', provider: 'openai'},
  {apiKey: 'private key', model: 'valid', provider: 'openai'},
  {apiKey: 42, model: 'valid', provider: 'openai'},
])(
  'get rejects malformed saved configuration %# without echoing it',
  async (ai: unknown) => {
    const contents = JSON.stringify({ai});
    await seed(contents);
    const result = await run('ai', 'get');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ai set --provider');
    expect(result.stderr).not.toContain('private');
    expect(await readFile(configurationFile, 'utf8')).toBe(contents);
  }
);

test.each(['{"ai":{"apiKey":"private-key"},broken}', '[]', 'null'])(
  'corrupt document %# preserves bytes and fails safely',
  async contents => {
    await seed(contents);
    for (const result of [await run('ai', 'get'), await set()]) {
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

test('filesystem errors hide causes and remove temporary files', async () => {
  await mkdir(configurationFile, {recursive: true});
  const result = await set();
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('Check directory permissions');
  expect(result.stderr).not.toContain('private');
  const files = await readdir(path.dirname(configurationFile));
  expect(new Set(files)).toEqual(new Set(['config.json', 'config.json.lock.sqlite']));
});

test('root help lists the AI command', async () => {
  const root = await run('--help');
  expect(root.exitCode).toBe(0);
  expect(root.stdout).toContain('ai');
});

test('AI help exposes get, set, and all required provider flags', async () => {
  const help = await run('ai', '--help');
  expect(help.exitCode).toBe(0);
  expect(help.stdout).toContain('get');
  expect(help.stdout).toContain('set');
  const setHelp = await run('ai', 'set', '--help');
  expect(setHelp.exitCode).toBe(0);
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
    const result = await run(...args);
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
  expect(await run('ai', 'get')).toMatchObject({
    exitCode: 0,
    stdout: 'Provider: openai\nModel: opaque/model:v1\nAPI key: <redacted>\n',
  });
  expect(await set('openai', 'model', 'private invalid-key')).toMatchObject({
    exitCode: 1,
  });
  expect(await run('ai', 'get', 'private-extra-key')).toMatchObject({exitCode: 252});
  expect(await run('--log-level', 'private-option-key', 'ai', 'get')).toMatchObject({
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
    expect(await run('hello')).toMatchObject({exitCode: 0});
    expect(envelopes.join('\n')).toContain('cli.command.completed');
  } finally {
    await server.stop(true);
  }
});

test.each(['{broken', '{"sentry":{"dsn":"private-invalid-dsn"}}'])(
  'malformed leading AI arguments bypass invalid telemetry configuration %#',
  async contents => {
    await seed(contents);
    const result = await run('--log-level', 'private-option-key', 'ai', 'get');
    expect(result.exitCode).toBe(251);
    expect(result.stderr).toBe(
      'Invalid AI command arguments. Run flightsim-things ai --help for usage.\n'
    );
    expect(result.stdout).not.toContain('private');
    expect(await readFile(configurationFile, 'utf8')).toBe(contents);
  }
);
