import {afterEach, beforeEach, expect, test} from 'bun:test';
import {mkdir, rm, symlink, writeFile} from 'node:fs/promises';
import path from 'node:path';

import createFixture from '#acceptance-scanner';

const successExitCode = 0;
const failureExitCode = 1;
const packageCount = 17;

const cliTimeout = 60_000;
let fixture: Awaited<ReturnType<typeof createFixture>>;

beforeEach(async () => {
  fixture = await createFixture();
});
afterEach(async () => {
  await fixture.dispose();
});

const baseCfg =
  '\uFEFF[GENERAL]\nICAO_TYPE_DESIGNATOR="A320" ; comment\nicao_manufacturer=Airbus\nicao_model=A320\n[FLTSIM.0]\nui_type="A320"\nui_variation="Factory; white" ; comment\natc_id=F-TEST\n[fltsim.1]\nui_variation=Blue // comment\n';
const liveryCfg =
  '[LIVERY]\nbase_container="..\\Base"\n[FLTSIM.0]\nui_variation=Airline One\nicao_airline=TST\natc_airline=Test Airline\natc_id=N123\n[FLTSIM.1]\nui_variation=Airline Two\natc_airline=Name Only\n';

async function mixedPackages(): Promise<string> {
  await fixture.addon(
    '01-livery',
    {'SimObjects/Airplanes/Variant/aircraft.cfg': liveryCfg},
    'LIVERY'
  );
  for (const index of Array.from({length: packageCount}).keys()) {
    await fixture.addon(
      `livery-${index}`,
      {'SimObjects/Airplanes/Variant/aircraft.cfg': liveryCfg},
      'LIVERY'
    );
  }

  return fixture.addon(
    '99-base',
    {
      'AirportServices/KCCC/Services.xml': '<Service.Packages/>',
      'AirportServices/KDDD/Services.spb': 'binary service metadata',
      'AirportServices/Shared/Services.xml': '<Service.Packages/>',
      'SimObjects/Airplanes/Base/aircraft.cfg': baseCfg,
      'scenery/source.xml':
        '<FSData><Airport ident="KAAA" name="A &amp; B" iata="aaa"/><Airport ident="KBBB" name="Second"/></FSData>',
      'scenery/world.bgl': 'compiled scenery',
    },
    'SCENERY'
  );
}

function verifyImported(result: Awaited<ReturnType<typeof fixture.run>>): void {
  expect(result.exitCode).toBe(successExitCode);
  expect(result.stdout).toContain(
    'Scanned 19 packages, 1 aircraft, 4 airports, and 38 liveries. 0 packages failed. 1 warnings.'
  );
  expect(result.stderr).toContain('Compiled scenery metadata is not decoded');
  const airports: unknown = JSON.parse(
    '[{"iata_code":"AAA","icao_code":"KAAA","name":"A & B"},{"iata_code":null,"icao_code":"KBBB","name":"Second"},{"iata_code":null,"icao_code":"KCCC","name":null},{"iata_code":null,"icao_code":"KDDD","name":null}]'
  );
  if (!Array.isArray(airports)) {
    throw new TypeError('Expected airport fixture array');
  }

  expect(
    fixture.query('SELECT icao_code, iata_code, name FROM airports ORDER BY icao_code')
  ).toEqual(airports);
  expect(fixture.query('SELECT name FROM airlines')).toEqual([{name: 'Test Airline'}]);
  expect(
    fixture.query('SELECT count(*) AS linked FROM liveries WHERE aircraft_id IS NOT NULL')
  ).toEqual([{linked: 38}]);
  expect(
    fixture.query(
      "SELECT name FROM liveries WHERE name IN ('Blue', 'Factory; white') ORDER BY name"
    )
  ).toEqual([{name: 'Blue'}, {name: 'Factory; white'}]);
}

test(
  'CLI imports mixed metadata in multiple batches and repeats updates without changing IDs',
  async () => {
    const mixed = await mixedPackages();
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    verifyImported(await fixture.run('scan'));
    const ids = fixture.query(
      'SELECT id, source_key FROM aircraft UNION ALL SELECT id, source_key FROM liveries ORDER BY source_key'
    );
    await writeFile(
      path.join(mixed, 'SimObjects/Airplanes/Base/aircraft.cfg'),
      baseCfg.replace('F-TEST', 'F-NEW')
    );
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(
      fixture.query(
        'SELECT id, source_key FROM aircraft UNION ALL SELECT id, source_key FROM liveries ORDER BY source_key'
      )
    ).toEqual(ids);
    expect(
      fixture.query("SELECT registration FROM liveries WHERE name = 'Factory; white'")
    ).toEqual([{registration: 'F-NEW'}]);
    expect(fixture.query('SELECT count(*) AS total FROM packages')).toEqual([
      {total: 19},
    ]);
  },
  cliTimeout
);

test(
  'unresolved and ambiguous targets remain null and own-package targets link locally',
  async () => {
    await fixture.addon(
      'first',
      {'SimObjects/Airplanes/Base/aircraft.cfg': baseCfg},
      'AIRCRAFT'
    );
    await fixture.addon(
      'second',
      {'SimObjects/Airplanes/Base/aircraft.cfg': baseCfg},
      'AIRCRAFT'
    );
    await fixture.addon(
      'ambiguous',
      {'SimObjects/Airplanes/Variant/aircraft.cfg': liveryCfg},
      'LIVERY'
    );
    await fixture.addon(
      'missing',
      {
        'SimObjects/Airplanes/Variant/aircraft.cfg': liveryCfg.replace(
          String.raw`..\Base`,
          String.raw`..\Absent`
        ),
      },
      'LIVERY'
    );
    await fixture.addon(
      'unknown-base',
      {
        'SimObjects/Airplanes/Unknown/aircraft.cfg':
          '[LIVERY]\n[FLTSIM.0]\nui_variation=Unknown target\n',
      },
      'LIVERY'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(
      fixture.query('SELECT count(*) AS total FROM liveries WHERE aircraft_id IS NULL')
    ).toEqual([{total: 5}]);
    expect(
      fixture.query(
        'SELECT count(*) AS total FROM liveries WHERE aircraft_id IS NOT NULL'
      )
    ).toEqual([{total: 4}]);
  },
  cliTimeout
);

async function malformedPackages(): Promise<void> {
  const valid = await fixture.addon('external-package', {
    'SimObjects/Airplanes/Base/aircraft.cfg': baseCfg,
  });
  await symlink(valid, path.join(fixture.community, 'linked-package'), 'dir');
  const broken = await fixture.addon('broken', {});
  await writeFile(path.join(broken, 'manifest.json'), '{bad json');
  const escaped = await fixture.addon('escaped', {});
  await writeFile(
    path.join(escaped, 'layout.json'),
    JSON.stringify({content: [{path: '../outside.cfg'}]})
  );
  const linkedFile = await fixture.addon('linked-file', {'aircraft.cfg': baseCfg});
  await rm(path.join(linkedFile, 'aircraft.cfg'));
  await symlink(
    path.join(valid, 'SimObjects/Airplanes/Base/aircraft.cfg'),
    path.join(linkedFile, 'aircraft.cfg')
  );
  await fixture.addon('empty-cfg', {'aircraft.cfg': ''});
}

test(
  'malformed packages and escaped metadata fail independently while package symlinks import',
  async () => {
    await malformedPackages();
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(failureExitCode);
    expect(result.stdout).toContain('Scanned 2 packages');
    expect(result.stdout).toContain('4 packages failed');
    expect(result.stderr).toContain('Unsafe layout path');
    expect(result.stderr).toContain('Metadata file escapes its package');
    expect(result.stderr).toContain('Aircraft configuration requires');
    expect(fixture.query('SELECT count(*) AS total FROM packages')).toEqual([{total: 2}]);
  },
  cliTimeout
);

async function expectScanError(message: string): Promise<void> {
  const result = await fixture.run('scan');
  expect(result.exitCode).toBe(failureExitCode);
  expect(result.stderr).toContain(message);
}

test(
  'missing configuration and unavailable paths fail before database writes; empty directories succeed',
  async () => {
    await expectScanError('No Community directory is saved');
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    await rm(fixture.community, {recursive: true});
    await expectScanError('Community directory does not exist');
    expect(
      await Bun.file(path.join(fixture.home, '.flightsim-things/addons.sqlite')).exists()
    ).toBe(false);
    await writeFile(fixture.community, 'file');
    await expectScanError('Community path is not a directory');
    await rm(fixture.community);
    await mkdir(fixture.community);
    expect(await fixture.run('scan')).toEqual({
      exitCode: 0,
      stderr: '',
      stdout:
        'Scanned 0 packages, 0 aircraft, 0 airports, and 0 liveries. 0 packages failed. 0 warnings.\n',
    });
  },
  cliTimeout
);

test(
  'one large package writes child records across SQLite parameter chunks',
  async () => {
    const variations = Array.from(
      {length: 135},
      (_value, index) => `[FLTSIM.${index}]\nui_variation=Variation ${index}\n`
    ).join('');
    await fixture.addon(
      'many-variations',
      {
        'SimObjects/Airplanes/Large/aircraft.cfg': `[GENERAL]\nicao_model=Large\n${variations}`,
      },
      'AIRCRAFT'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(
      fixture.query(
        'SELECT count(*) AS total FROM liveries WHERE aircraft_id IS NOT NULL'
      )
    ).toEqual([{total: 135}]);
  },
  cliTimeout
);
