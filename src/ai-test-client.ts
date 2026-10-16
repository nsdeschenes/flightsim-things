import {inspect} from 'node:util';

import {BunRuntime} from '@effect/platform-bun';
import {generateText} from 'ai';
import {Effect, Option, Redacted} from 'effect';
import {http, HttpResponse, passthrough} from 'msw';

import ai from '#ai';

import withSentry from './sentry.ts';
import testHttp from './test-http.ts';

type CapturedRequest = Readonly<{
  apiKey: string;
  authorization: string;
  body: unknown;
  url: string;
}>;
const requests: CapturedRequest[] = [];
const lastArgument = -1;
const sentryEnvelopeUrl = /^http:\/\/127\.0\.0\.1:\d+\/api\/123\/envelope\//u;
type TestRequest = Readonly<{
  headers: Readonly<{get: (name: string) => string | null}>;
  json: () => Promise<unknown>;
  url: string;
}>;

async function capture(request: TestRequest): Promise<void> {
  requests.push({
    apiKey:
      request.headers.get('x-api-key') ?? request.headers.get('x-goog-api-key') ?? '',
    authorization: request.headers.get('authorization') ?? '',
    body: await request.json(),
    url: request.url,
  });
}

const openaiResponse = {
  id: 'response-test',
  model: 'gpt-4.1-mini',
  output: [
    {
      content: [{annotations: [], text: 'OpenAI response', type: 'output_text'}],
      id: 'message-test',
      role: 'assistant',
      type: 'message',
    },
  ],
  usage: {input_tokens: 1, output_tokens: 1, total_tokens: 2},
};
const anthropicResponse = {
  content: [{text: 'Anthropic response', type: 'text'}],
  id: 'message-test',
  model: 'claude-sonnet-4-5',
  role: 'assistant',
  stop_reason: 'end_turn',
  stop_sequence: Option.getOrNull(Option.none<string>()),
  type: 'message',
  usage: {input_tokens: 1, output_tokens: 1},
};
const googleResponse = {
  candidates: [
    {
      content: {parts: [{text: 'Google response'}], role: 'model'},
      finishReason: 'STOP',
      index: 0,
    },
  ],
  usageMetadata: {candidatesTokenCount: 1, promptTokenCount: 1, totalTokenCount: 2},
};

function interceptProviders(): void {
  testHttp.server.use(
    http.post(sentryEnvelopeUrl, passthrough),
    http.post(
      'https://api.openai.com/v1/responses',
      async ({request}: Readonly<{request: TestRequest}>) => {
        await capture(request);
        return HttpResponse.json(openaiResponse);
      }
    ),
    http.post(
      'https://api.anthropic.com/v1/messages',
      async ({request}: Readonly<{request: TestRequest}>) => {
        await capture(request);
        return HttpResponse.json(anthropicResponse);
      }
    ),
    http.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      async ({request}: Readonly<{request: TestRequest}>) => {
        await capture(request);
        return HttpResponse.json(googleResponse);
      }
    )
  );
  testHttp.server.listen({onUnhandledRequest: 'error'});
}

async function generate(prompt = 'Say hello.'): Promise<string> {
  const configuredModel = await Effect.runPromise(ai.model());
  const result = await generateText({
    maxRetries: 0,
    model: configuredModel,
    prompt,
  });
  return result.text;
}

async function exerciseProviders(): Promise<void> {
  interceptProviders();
  try {
    const responses = [await generate()];
    await Effect.runPromise(
      ai.set({
        apiKey: Redacted.make('saved-anthropic-key'),
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
      })
    );
    responses.push(await generate());
    await Effect.runPromise(
      ai.set({
        apiKey: Redacted.make('saved-google-key'),
        model: 'gemini-2.5-flash',
        provider: 'google',
      })
    );
    responses.push(await generate());
    process.stdout.write(`${JSON.stringify({requests, responses})}\n`);
  } finally {
    testHttp.server.close();
  }
}

async function exerciseTracing(): Promise<void> {
  interceptProviders();
  try {
    await Effect.runPromise(
      withSentry(
        () =>
          Effect.promise(async () => {
            const text = await generate('private-prompt-sentinel');
            process.stdout.write(`${text}\n`);
          }),
        ['generate']
      )
    );
  } finally {
    testHttp.server.close();
  }
}

async function main(): Promise<void> {
  const action = process.argv.at(lastArgument);
  if (action === 'tracing') {
    await exerciseTracing();
  } else if (action === 'requests') {
    await exerciseProviders();
  } else if (action === 'inspect') {
    const saved = await Effect.runPromise(ai.get());
    process.stdout.write(
      `${JSON.stringify({
        inspected: inspect(saved),
        json: JSON.stringify(saved),
        redacted: Redacted.isRedacted(saved.apiKey),
      })}\n`
    );
  } else if (action === 'failure') {
    const error = await Effect.runPromise(ai.get().pipe(Effect.flip));
    process.stdout.write(
      `${JSON.stringify({inspected: inspect(error), json: JSON.stringify(error)})}\n`
    );
  }
}

BunRuntime.runMain(Effect.promise(main));
