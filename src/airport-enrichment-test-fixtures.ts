import {Database} from 'bun:sqlite';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import type schema from '#database-schema';

import processFixture from './database/test-fixtures/process.ts';

type SeedAirport = Readonly<
  Omit<typeof schema.airports.$inferInsert, 'id' | 'packageId' | 'sourceKey'>
>;
type RequestPlan = Readonly<{
  body?: unknown;
  code: string;
  error?: string;
  mutation?: string;
  page?: number;
  raw?: string;
  redirect?: string;
  stallBody?: boolean;
  status?: number;
}>;
type Result = Readonly<{exitCode: number; stderr: string; stdout: string}>;
const cli = fileURLToPath(new URL('index.ts', import.meta.url));
const testDirectory = path.join(tmpdir(), 'flightsim-things-airports-enrich');
const successExitCode = 0;
const key = 'sentinel-private-openaip-key';
const emptyPlans: readonly RequestPlan[] = [];
const preload = `
import {Database} from 'bun:sqlite';
import {appendFileSync, readFileSync} from 'node:fs';
import path from 'node:path';
const root = process.env.HOME;
const plans = JSON.parse(readFileSync(path.join(root, 'requests.json'), 'utf8'));
let index = 0;
globalThis.fetch = async function mockedOpenAipFetch(input, options) {
  const url = new URL(String(input));
  const observed = {code: url.searchParams.get('search'), page: Number(url.searchParams.get('page'))};
  appendFileSync(path.join(root, 'observed.jsonl'), JSON.stringify(observed) + '\\n');
  const plan = plans[index++];
  if (!plan || url.origin !== 'https://api.core.openaip.net' || url.pathname !== '/api/airports' ||
    observed.code !== plan.code || observed.page !== (plan.page ?? 1) ||
    url.searchParams.get('limit') !== '100' || url.searchParams.get('fields') !== '_id,name,icaoCode,iataCode,geometry,elevation' ||
    new Headers(options.headers).get('x-openaip-api-key') !== '${key}' || !options.signal || (options.method ?? 'GET') !== 'GET') {
    throw new Error('Unexpected HTTP request');
  }
  if (plan.mutation) {
    using lock = new Database(path.join(root, '.flightsim-things/addons.sqlite.lock.sqlite'));
    lock.run('PRAGMA busy_timeout = 0');
    lock.run('BEGIN IMMEDIATE');
    using db = new Database(path.join(root, '.flightsim-things/addons.sqlite'));
    db.run(plan.mutation);
    lock.run('ROLLBACK');
  }
  if (plan.error) {throw new Error(plan.error);}
  if (plan.redirect) {
    if (options.redirect === 'error') {throw new Error('Redirect rejected');}
    appendFileSync(path.join(root, 'observed.jsonl'), JSON.stringify({redirect: plan.redirect, apiKey: new Headers(options.headers).get('x-openaip-api-key')}) + '\\n');
  }
  if (plan.stallBody) {
    return new Response(new ReadableStream({start(controller) {
      options.signal.addEventListener('abort', () => {
        appendFileSync(path.join(root, 'aborted.txt'), 'aborted');
        controller.error(new Error('${key}'));
      }, {once: true});
    }}));
  }
  return new Response(plan.raw ?? JSON.stringify(plan.body), {status: plan.status ?? 200});
};
`;
async function command(
  home: string,
  args: readonly string[],
  usePreload = false
): Promise<Result> {
  let executable = [process.execPath, cli];
  if (usePreload) {
    executable = [process.execPath, '--preload', path.join(home, 'fetch.ts'), cli];
  }
  const child = Bun.spawn([...executable, ...args], {
    env: {...process.env, HOME: home, USERPROFILE: home},
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
function query(home: string): readonly Readonly<Record<string, unknown>>[] {
  using db = new Database(path.join(home, '.flightsim-things/addons.sqlite'), {
    readonly: true,
  });
  return db
    .query<Readonly<Record<string, unknown>>, []>('SELECT * FROM airports ORDER BY id')
    .all();
}
async function initialize(
  home: string,
  rows: readonly SeedAirport[],
  saveKey: boolean
): Promise<void> {
  const initialized = await processFixture.run(
    home,
    `
    await Effect.runPromise(database.use(db => {
      const record = db.insert(schema.packages).values({sourcePath: '/Community/airports'}).returning().get();
      for (const [index, row] of ${JSON.stringify(rows)}.entries()) {
        db.insert(schema.airports).values({...row, packageId: record.id, sourceKey: 'airport-' + index}).run();
      }
    }));
  `
  );
  if (initialized.exitCode !== successExitCode) {
    throw new Error(initialized.stderr);
  }
  if (saveKey) {
    const saved = await command(home, ['openaip-key', 'set', key]);
    if (saved.exitCode !== successExitCode) {
      throw new Error(saved.stderr);
    }
  }
}
async function createFixture(
  rows: readonly SeedAirport[] = [],
  saveKey = true
): Promise<
  Readonly<{
    aborted: () => Promise<string>;
    dispose: () => Promise<void>;
    enrich: (plans?: readonly RequestPlan[]) => Promise<Result>;
    home: string;
    observed: () => Promise<unknown[]>;
    query: () => readonly Readonly<Record<string, unknown>>[];
  }>
> {
  await mkdir(testDirectory, {recursive: true});
  const home = await mkdtemp(path.join(testDirectory, 'cli-test-'));
  await initialize(home, rows, saveKey);
  await writeFile(path.join(home, 'fetch.ts'), preload);
  return {
    aborted: async () => {
      const contents = await readFile(path.join(home, 'aborted.txt'), 'utf8');
      return contents;
    },
    dispose: async () => {
      await rm(home, {force: true, recursive: true});
    },
    enrich: async (plans = emptyPlans) => {
      await writeFile(path.join(home, 'requests.json'), JSON.stringify(plans));
      await writeFile(path.join(home, 'observed.jsonl'), '');
      await writeFile(path.join(home, 'aborted.txt'), '');
      const result = await command(home, ['airports', 'enrich'], true);
      return result;
    },
    home,
    observed: async () => {
      const contents = await readFile(path.join(home, 'observed.jsonl'), 'utf8');
      return contents
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line: string) => {
          const observed: unknown = JSON.parse(line);
          return observed;
        });
    },
    query: () => query(home),
  };
}
function page(
  items: readonly unknown[],
  overrides: Readonly<Record<string, unknown>> = {}
): unknown {
  return {
    items,
    limit: 100,
    page: 1,
    totalCount: items.length,
    totalPages: 1,
    ...overrides,
  };
}
const fixtures = {createFixture, key, page};
export default fixtures;
