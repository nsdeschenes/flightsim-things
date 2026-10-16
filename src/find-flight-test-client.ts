import {writeFile} from 'node:fs/promises';
import path from 'node:path';

import {BunRuntime} from '@effect/platform-bun';
import {Effect, Option, Redacted} from 'effect';
import {http, HttpResponse} from 'msw';
import {z} from 'zod';

import ai from '#ai';

import testHttp from './test-http.ts';

type Captured = Readonly<{
  authorization: string | null;
  apiKey: string | null;
  body: unknown;
}>;
const requests: Captured[] = [];
const scenario = process.env.FLIGHTSIM_AI_TEST_CASE ?? 'success';
const dataStart = 'Data JSON: ';
const sourceUrl = 'https://example.com/routes';
const textPart = z.object({text: z.string()});
const message = z.object({content: z.array(textPart)});
const requestSchema = z.object({input: z.array(message)});
const source = z.object({id: z.string()});
const extractionSchema = z.object({sources: z.array(source)});
type TestRequest = Readonly<{
  headers: Readonly<{get: (name: string) => string | null}>;
  json: () => Promise<unknown>;
}>;
const firstIndex = 0;
const one = 1;
const unknownId = 999;
const departureId = 3;

function selectedId(unknownScenario: string, departureScenario = ''): number {
  if (scenario === unknownScenario) {
    return unknownId;
  }

  if (scenario === departureScenario) {
    return departureId;
  }

  return one;
}

function selectedSources(sources: readonly Readonly<{id: string}>[]): readonly string[] {
  if (scenario === 'fabricated-source') {
    return ['invented'];
  }

  return sources.map(value => value.id);
}

function researchSources(body: unknown): readonly Readonly<{id: string}>[] {
  const request = requestSchema.parse(body);
  const prompt = request.input
    .flatMap(
      (value: Readonly<{content: readonly Readonly<{text: string}>[]}>) => value.content
    )
    .map(value => value.text)
    .join('');
  const json: unknown = JSON.parse(
    prompt.slice(prompt.indexOf(dataStart) + dataStart.length)
  );
  return extractionSchema.parse(json).sources;
}

function extraction(body: unknown): string {
  const destinationAirportId = selectedId('unknown-id', 'departure-id');
  const liveryId = selectedId('unknown-livery');
  const sourceIds = selectedSources(researchSources(body));
  if (scenario === 'malformed') {
    return 'not JSON';
  }

  if (scenario === 'no-results') {
    return JSON.stringify({flights: []});
  }

  return JSON.stringify({
    flights: [
      {
        destinationAirportId,
        flightNumber: 'BA123',
        liveryId,
        reason: 'Route and A320 operation supported.\u001B[31m\n',
        sourceIds,
      },
    ],
  });
}

function openaiResponse(
  text: string,
  citations: boolean
): Readonly<Record<string, unknown>> {
  let annotations: readonly Readonly<Record<string, string | number>>[] = [];
  if (citations) {
    annotations = [
      {
        end_index: one,
        start_index: firstIndex,
        title: 'Route source',
        type: 'url_citation',
        url: sourceUrl,
      },
      {
        end_index: one,
        start_index: firstIndex,
        title: 'Duplicate source',
        type: 'url_citation',
        url: sourceUrl,
      },
      {
        end_index: one,
        start_index: firstIndex,
        title: 'Non-web source',
        type: 'url_citation',
        url: 'ftp://example.com/routes',
      },
    ];
  }

  return {
    id: 'response-test',
    model: 'gpt-4.1-mini',
    output: [
      {
        content: [{annotations, text, type: 'output_text'}],
        id: 'message-test',
        role: 'assistant',
        type: 'message',
      },
    ],
    usage: {input_tokens: one, output_tokens: one, total_tokens: one},
  };
}

async function openai({request}: Readonly<{request: TestRequest}>): Promise<Response> {
  const body: unknown = await request.json();
  requests.push({
    apiKey: request.headers.get('x-api-key'),
    authorization: request.headers.get('authorization'),
    body,
  });
  if (scenario === 'network') {
    return HttpResponse.json(
      {error: {message: 'private-provider-body saved-openai-key'}},
      {status: 401}
    );
  }

  await writeFile(
    path.join(process.env.HOME ?? '', 'ai-requests.json'),
    JSON.stringify(requests)
  );
  const parsed = z.object({tools: z.array(z.unknown()).optional()}).parse(body);
  if (parsed.tools && parsed.tools.length > firstIndex) {
    return HttpResponse.json(
      openaiResponse(
        'London to Paris on British Airways A320.',
        scenario !== 'no-sources'
      )
    );
  }

  return HttpResponse.json(openaiResponse(extraction(body), false));
}

async function capture(request: TestRequest): Promise<void> {
  requests.push({
    apiKey: request.headers.get('x-api-key') ?? request.headers.get('x-goog-api-key'),
    authorization: request.headers.get('authorization'),
    body: await request.json(),
  });
}

const anthropicResponse = {
  content: [
    {
      citations: [
        {
          cited_text: 'route',
          encrypted_index: 'index',
          title: 'Route source',
          type: 'web_search_result_location',
          url: sourceUrl,
        },
      ],
      text: 'Anthropic research',
      type: 'text',
    },
  ],
  id: 'message-test',
  model: 'claude-sonnet-4-5',
  role: 'assistant',
  stop_reason: 'end_turn',
  stop_sequence: Option.getOrNull(Option.none<string>()),
  type: 'message',
  usage: {input_tokens: one, output_tokens: one},
};
const googleResponse = {
  candidates: [
    {
      content: {parts: [{text: 'Google research'}], role: 'model'},
      finishReason: 'STOP',
      groundingMetadata: {
        groundingChunks: [{web: {title: 'Route source', uri: sourceUrl}}],
      },
      index: firstIndex,
    },
  ],
  usageMetadata: {candidatesTokenCount: one, promptTokenCount: one, totalTokenCount: one},
};

function intercept(): void {
  testHttp.server.use(
    http.post(
      'https://api.openai.com/v1/responses',
      async (input: Readonly<{request: TestRequest}>) => {
        const response = await openai(input);
        return response;
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

async function providers(): Promise<void> {
  const results = [await Effect.runPromise(ai.search('Research routes.'))];
  await Effect.runPromise(
    ai.set({
      apiKey: Redacted.make('saved-anthropic-key'),
      model: 'claude-sonnet-4-5',
      provider: 'anthropic',
    })
  );
  results.push(await Effect.runPromise(ai.search('Research routes.')));
  await Effect.runPromise(
    ai.set({
      apiKey: Redacted.make('saved-google-key'),
      model: 'gemini-2.5-flash',
      provider: 'google',
    })
  );
  results.push(await Effect.runPromise(ai.search('Research routes.')));
  process.stdout.write(`${JSON.stringify({requests, results})}\n`);
}

async function main(): Promise<void> {
  intercept();
  if (scenario === 'providers') {
    await providers();
    testHttp.server.close();
  } else {
    await import('./index.ts');
  }
}

BunRuntime.runMain(Effect.promise(main));
