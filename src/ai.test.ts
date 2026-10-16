import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {Schema} from 'effect';
import {Array as array, Record as record, Struct as struct} from 'effect/Schema';

const repository = fileURLToPath(new URL('..', import.meta.url));
const client = fileURLToPath(new URL('ai-test-client.ts', import.meta.url));
const testDirectory = path.join(
  homedir(),
  '.cache/agent-work/flightsim-things/vercel-ai/context'
);
let homeDirectory: string;
let configurationFile: string;
type EnvelopeItem = Readonly<{payload: string; type: string}>;
const decodeEnvelopeHeader = Schema.decodeUnknownSync(struct({type: Schema.String}));
const traceContext = struct({span_id: Schema.String, trace_id: Schema.String});
const decodeTransaction = Schema.decodeUnknownSync(
  struct({
    contexts: struct({trace: traceContext}),
    transaction: Schema.String,
    type: Schema.String,
  })
);
const aiSpan = struct({
  attributes: record(Schema.String, Schema.Unknown),
  name: Schema.String,
  parent_span_id: Schema.String,
  span_id: Schema.String,
  trace_id: Schema.String,
});
const decodeSpanBatch = Schema.decodeUnknownSync(struct({items: array(aiSpan)}));

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

async function seedTracing(
  traces: string | number,
  port: number | undefined
): Promise<void> {
  const configuration = {
    ai: {apiKey: 'private-api-key-sentinel', model: 'gpt-4.1-mini', provider: 'openai'},
  };
  if (typeof traces === 'number') {
    await seed(
      JSON.stringify({
        ...configuration,
        sentry: {
          dsn: `http://publickey@127.0.0.1:${port}/123`,
          sampleRates: {errors: 0, logs: 0, metrics: 0, traces},
        },
      })
    );
    return;
  }

  await seed(JSON.stringify(configuration));
}

function envelopeItems(envelopes: readonly string[]): readonly EnvelopeItem[] {
  return envelopes.flatMap(envelope => {
    const lines = envelope.split('\n');
    return lines
      .slice(1)
      .filter((line, index) => index % 2 === 0 && line !== '')
      .map((line, index): EnvelopeItem => {
        const header = decodeEnvelopeHeader(JSON.parse(line));
        return {payload: lines.at(index * 2 + 2) ?? '', type: header.type};
      });
  });
}

function expectAiSpans(items: readonly EnvelopeItem[]): void {
  const transactions = items.filter(item => item.type === 'transaction');
  expect(transactions).toHaveLength(1);
  const transaction = decodeTransaction(
    JSON.parse(transactions.map(item => item.payload).join(''))
  );
  expect(transaction).toMatchObject({transaction: 'CLI command', type: 'transaction'});
  const spans = items
    .filter(item => item.type === 'span')
    .flatMap(item => decodeSpanBatch(JSON.parse(item.payload)).items);
  expect(spans).toHaveLength(2);
  const agent = spans.find(span => span.name === 'invoke_agent');
  expect(agent).toMatchObject({
    attributes: {'sentry.op': {value: 'gen_ai.invoke_agent'}},
    parent_span_id: transaction.contexts.trace.span_id,
    trace_id: transaction.contexts.trace.trace_id,
  });
  if (agent) {
    expect(
      spans.find(span => span.name === 'generate_content gpt-4.1-mini')
    ).toMatchObject({
      attributes: {
        'gen_ai.request.model': {type: 'string', value: 'gpt-4.1-mini'},
        'gen_ai.usage.input_tokens': {type: 'integer', value: 1},
        'gen_ai.usage.output_tokens': {type: 'integer', value: 1},
        'gen_ai.usage.total_tokens': {type: 'integer', value: 2},
        'sentry.op': {type: 'string', value: 'gen_ai.generate_content'},
      },
      parent_span_id: agent.span_id,
      trace_id: transaction.contexts.trace.trace_id,
    });
  }
}

function expectTelemetry(envelopes: readonly string[], traces: string | number): void {
  const items = envelopeItems(envelopes);
  if (traces !== 1) {
    expect(items.filter(item => item.type !== 'client_report')).toEqual([]);
    if (traces === 'unconfigured') {
      expect(envelopes).toEqual([]);
    }

    return;
  }

  const payload = envelopes.join('\n');
  for (const forbidden of [
    'private-prompt-sentinel',
    'OpenAI response',
    'private-api-key-sentinel',
    'gen_ai.input.messages',
    'gen_ai.output.messages',
  ]) {
    expect(payload).not.toContain(forbidden);
  }

  expectAiSpans(items);
}

test.each([1, 0, 'unconfigured'])(
  'real AI SDK calls respect Sentry tracing %s without capturing content or credentials',
  async traces => {
    const envelopes: string[] = [];
    const server = Bun.serve({
      async fetch(request: Readonly<{text: () => Promise<string>}>): Promise<Response> {
        envelopes.push(await request.text());
        return Response.json({});
      },
      hostname: '127.0.0.1',
      port: 0,
    });
    try {
      await seedTracing(traces, server.port);
      expect(await run('tracing')).toEqual({
        exitCode: 0,
        stderr: '',
        stdout: 'OpenAI response\n',
      });
      expectTelemetry(envelopes, traces);
    } finally {
      await server.stop(true);
    }
  }
);
