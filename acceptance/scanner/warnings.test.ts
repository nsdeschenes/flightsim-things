import {afterEach, beforeEach, expect, test} from 'bun:test';
import {rm} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

const cliTimeout = 60_000;
const warningPackages = 18;
const failurePackages = 7;
const detailLimit = 5;
const aboveDetailLimit = 6;
const totalWarnings = 36;
const successExitCode = 0;
const failureExitCode = 1;
const singleNotice = 1;
let fixture: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  fixture = await createFixture();
  expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
    exitCode: 0,
  });
});
afterEach(async () => {
  await fixture.dispose();
});

async function warningFixtures(): Promise<void> {
  for (const index of Array.from({length: warningPackages}).keys()) {
    const root = await fixture.addon(
      `warning-${index}`,
      {
        'missing-a.xml': '',
        'missing-b.xml': '',
        'scenery/world.bgl': 'compiled',
        'sound.xml': '<Sound><broken',
      },
      'SCENERY'
    );
    await rm(path.join(root, 'missing-a.xml'));
    await rm(path.join(root, 'missing-b.xml'));
  }

  for (const index of Array.from({length: failurePackages}).keys()) {
    await fixture.addon(
      `broken-${index}`,
      {'airport.xml': '<FSData><Airport'},
      'SCENERY'
    );
  }
}

function verifyCoverage(stdout: string, verbose: boolean): void {
  expect(stdout.match(/Airport coverage may be incomplete/gu)).toHaveLength(singleNotice);
  expect(stdout).toContain('18 packages with compiled scenery');
  expect(stdout).toContain('Skipped 18 unrelated XML files');
  expect(stdout.includes('Run scan --verbose to show file paths.')).toBe(!verbose);
}

async function verifyDefaultWarnings(): Promise<void> {
  const result = await fixture.run('scan');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stdout).toContain('Scanned 18 packages');
  expect(result.stdout).toContain('7 packages failed. 36 warnings.');
  verifyCoverage(result.stdout, false);
  expect(result.stderr).not.toContain('sound.xml');
  expect(result.stderr.match(/Warning for /gu)).toHaveLength(detailLimit);
  expect(
    result.stderr.match(
      /31 additional warnings omitted\. Run scan --verbose to show every warning\./gu
    )
  ).toHaveLength(singleNotice);
  for (const index of Array.from({length: failurePackages}).keys()) {
    expect(result.stderr).toContain(`broken-${index}`);
  }
}

function verifySkippedXmlPaths(stderr: string): void {
  expect(stderr.match(/Skipped unrelated XML for /gu)).toHaveLength(warningPackages);
  for (const index of Array.from({length: warningPackages}).keys()) {
    expect(stderr).toContain(`Skipped unrelated XML for warning-${index}: sound.xml`);
  }
}

async function verifyVerboseWarnings(): Promise<void> {
  const verbose = await fixture.run('scan', '--verbose');
  expect(verbose.exitCode).toBe(failureExitCode);
  expect(verbose.stdout).toContain('7 packages failed. 36 warnings.');
  expect(verbose.stderr.match(/Warning for /gu)).toHaveLength(totalWarnings);
  verifyCoverage(verbose.stdout, true);
  expect(verbose.stderr).not.toContain('Compiled scenery');
  verifySkippedXmlPaths(verbose.stderr);
  expect(verbose.stderr).toContain('coverage may be incomplete');
  expect(verbose.stderr).not.toContain('additional warnings omitted');
}

test(
  'warning details are bounded across batches, verbose restores all, and failures remain uncapped',
  async () => {
    await warningFixtures();
    await verifyDefaultWarnings();
    await verifyVerboseWarnings();
  },
  cliTimeout
);

test.each([detailLimit, aboveDetailLimit])(
  'warning omission starts after five details for %s warnings',
  async count => {
    const root = await fixture.addon(
      'xml',
      Object.fromEntries(
        Array.from({length: count}, (_value, index) => [`sound-${index}.xml`, ''])
      ),
      'SCENERY'
    );
    await Promise.all(
      Array.from({length: count}, async (_value, index) => {
        await rm(path.join(root, `sound-${index}.xml`));
      })
    );
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stdout).toContain(`${count} warnings.`);
    expect(result.stderr.match(/Warning for /gu)).toHaveLength(detailLimit);
    expect(result.stderr.includes('1 additional warnings omitted')).toBe(
      count > detailLimit
    );
  },
  cliTimeout
);
