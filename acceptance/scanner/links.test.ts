import {Database} from 'bun:sqlite';
import {afterEach, beforeEach, expect, test} from 'bun:test';
import {opendir, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

const failureExitCode = 1;
const packageCount = 17;
const variantCount = 2;
const changedPackages = 2;
const totalLinks = packageCount * variantCount;
const remainingLinks = totalLinks - changedPackages * variantCount;
const noLinks = 0;
const firstIndex = 0;
const secondIndex = 1;
const lastIndex = -1;

let fixture: Awaited<ReturnType<typeof createFixture>>;
const cliTimeout = 60_000;
const cfgPath = 'SimObjects/Airplanes/Base/aircraft.cfg';
const baseCfg = '[GENERAL]\nicao_model=Base\n';
const variantCfg =
  '[LIVERY]\nbase_container=..\\Base\n[FLTSIM.0]\nui_variation=First\n[FLTSIM.1]\nui_variation=Second\n';

beforeEach(async () => {
  fixture = await createFixture();
});
afterEach(async () => {
  await fixture.dispose();
});

function expectLinked(total: number): void {
  expect(
    fixture.query('SELECT count(*) AS total FROM liveries WHERE aircraft_id IS NOT NULL')
  ).toEqual([{total}]);
}

async function seedBatches(): Promise<void> {
  for (const index of Array.from({length: packageCount}).keys()) {
    await fixture.addon(
      `package-${index}`,
      {
        [cfgPath]: `${baseCfg}[FLTSIM.0]\nui_variation=First\n[FLTSIM.1]\nui_variation=Second\n`,
      },
      'AIRCRAFT'
    );
  }

  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
  expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
  expectLinked(totalLinks);
}

async function interruptSecondBatch(): Promise<readonly string[]> {
  const directory = await opendir(fixture.community);
  const packages: string[] = [];
  for await (const entry of directory) {
    packages.push(path.join(fixture.community, entry.name));
  }

  using db = new Database(path.join(fixture.home, '.flightsim-things/addons.sqlite'));
  const last = packages.at(lastIndex);
  if (typeof last !== 'string') {
    throw new TypeError('Expected a package in the second batch');
  }

  db.run(
    `CREATE TRIGGER stop_last_package BEFORE UPDATE ON packages
     WHEN NEW.source_path = '${last.replaceAll("'", "''")}'
     BEGIN SELECT RAISE(ABORT, 'injected second-batch failure'); END`
  );
  return packages;
}

async function expectInterrupted(): Promise<void> {
  const result = await fixture.run('scan');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stdout).toContain('Saved 16 packages so far.');
  expect(result.stderr).toContain('Could not access addon database');
}

async function changeTargets(packages: readonly string[]): Promise<void> {
  const changed = packages.at(firstIndex);
  const removed = packages.at(secondIndex);
  if (typeof changed !== 'string' || typeof removed !== 'string') {
    throw new TypeError('Expected two packages in the first batch');
  }

  await writeFile(path.join(changed, cfgPath), variantCfg.replace('Base', 'Absent'));
  await writeFile(
    path.join(removed, cfgPath),
    variantCfg.replace('base_container=..\\Base\n', '')
  );
}

test(
  'interrupted second batch retains unchanged links and clears changed or removed targets',
  async () => {
    await seedBatches();
    const packages = await interruptSecondBatch();
    await expectInterrupted();
    expectLinked(totalLinks);
    await changeTargets(packages);
    await expectInterrupted();
    expectLinked(remainingLinks);
    expect(
      fixture.query(
        'SELECT count(*) AS total FROM liveries WHERE aircraft_id IS NULL AND target_aircraft_key IS NULL'
      )
    ).toEqual([{total: 2}]);
    expect(
      fixture.query(
        "SELECT count(*) AS total FROM liveries WHERE aircraft_id IS NULL AND target_aircraft_key = 'simobjects/airplanes/absent'"
      )
    ).toEqual([{total: 2}]);
  },
  cliTimeout
);

async function seedExternalTarget(): Promise<string> {
  const base = await fixture.addon('base', {[cfgPath]: baseCfg}, 'AIRCRAFT');
  await fixture.addon(
    'variant',
    {
      'SimObjects/Airplanes/Variant/aircraft.cfg': variantCfg,
    },
    'LIVERY'
  );
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
  expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
  expectLinked(variantCount);
  return base;
}

test(
  'completed scans clear prior links when the observed target disappears or becomes ambiguous',
  async () => {
    const base = await seedExternalTarget();
    await rm(base, {recursive: true});
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expectLinked(noLinks);
    await fixture.addon('base', {[cfgPath]: baseCfg}, 'AIRCRAFT');
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expectLinked(variantCount);
    await fixture.addon('duplicate', {[cfgPath]: baseCfg}, 'AIRCRAFT');
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expectLinked(noLinks);
  },
  cliTimeout
);
