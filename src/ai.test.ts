import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository = fileURLToPath(new URL('..', import.meta.url));
const client = fileURLToPath(new URL('ai-test-client.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/vercel-ai/context'
);
let homeDirectory: string;
let configurationFile: string;

beforeEach(async () => {
  await mkdir(testDirectory, {recursive: true});
  homeDirectory = await mkdtemp(path.join(testDirectory, 'sdk-test-'));
  configurationFile = path.join(homeDirectory, '.flightsim-things/config.json');
});

afterEach(async () => {
  await rm(homeDirectory, {force: true, recursive: true});
});

async function seed(contents: string): Promise<void> {
  await mkdir(path.dirname(configurationFile), {recursive: true});
  await writeFile(configurationFile, contents);
}

async function run(
  action: string,
  ambientKey = ''
): Promise<Readonly<{exitCode: number; stderr: string; stdout: string}>> {
  const child = Bun.spawn([process.execPath, client, action], {
    cwd: repository,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: ambientKey,
      GOOGLE_GENERATIVE_AI_API_KEY: ambientKey,
      HOME: homeDirectory,
      OPENAI_API_KEY: ambientKey,
      USERPROFILE: homeDirectory,
    },
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

test.each(['', 'conflicting-ambient-key'])(
  'real SDK requests use saved models and authentication with ambient key %s',
  async ambientKey => {
    await seed(
      JSON.stringify({
        ai: {apiKey: 'saved-openai-key', model: 'gpt-4.1-mini', provider: 'openai'},
        future: {retained: true},
      })
    );
    const result = await run('requests', ambientKey);
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      requests: [
        {
          apiKey: '',
          authorization: 'Bearer saved-openai-key',
          body: {model: 'gpt-4.1-mini'},
          url: 'https://api.openai.com/v1/responses',
        },
        {
          apiKey: 'saved-anthropic-key',
          authorization: '',
          body: {model: 'claude-sonnet-4-5'},
          url: 'https://api.anthropic.com/v1/messages',
        },
        {
          apiKey: 'saved-google-key',
          authorization: '',
          body: {contents: [{parts: [{text: 'Say hello.'}], role: 'user'}]},
          url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        },
      ],
      responses: ['OpenAI response', 'Anthropic response', 'Google response'],
    });
    expect(JSON.parse(await readFile(configurationFile, 'utf8'))).toEqual({
      ai: {apiKey: 'saved-google-key', model: 'gemini-2.5-flash', provider: 'google'},
      future: {retained: true},
    });
  }
);

test('configuration keeps the key Redacted during JSON serialization and inspection', async () => {
  await seed(
    JSON.stringify({
      ai: {
        apiKey: 'private-runtime-sentinel',
        model: 'opaque/model:v1',
        provider: 'openai',
      },
    })
  );
  const result = await run('inspect');
  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).not.toContain('private-runtime-sentinel');
  expect(JSON.parse(result.stdout)).toMatchObject({
    json: '{"apiKey":"<redacted>","model":"opaque/model:v1","provider":"openai"}',
    redacted: true,
  });
  expect(result.stdout).toContain('<redacted>');
  expect(result.stdout).toContain('opaque/model:v1');
});

test.each([
  '{"ai":{"apiKey":"private-parse-sentinel"},broken}',
  '{"ai":{"apiKey":"private-parse-sentinel","model":"valid","provider":"unknown"}}',
])(
  'configuration failure %# retains no secret-bearing parser or storage causes',
  async contents => {
    await seed(contents);
    const result = await run('failure');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('AiConfigurationError');
    expect(result.stdout).not.toContain('private-parse-sentinel');
    expect(result.stdout).not.toContain('cause');
    expect(result.stdout).not.toContain('SyntaxError');
    expect(await readFile(configurationFile, 'utf8')).toBe(contents);
  }
);
