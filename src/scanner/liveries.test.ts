import {afterEach, beforeEach, expect, test} from 'bun:test';

import createFixture from './test-fixtures.ts';

let fixture: Awaited<ReturnType<typeof createFixture>>;
const cliTimeout = 60_000;

beforeEach(async () => {
  fixture = await createFixture();
});
afterEach(async () => {
  await fixture.dispose();
});

async function nativePackages(): Promise<void> {
  await fixture.addon(
    'native',
    {
      'SimObjects/Airplanes/Unproven/Liveries/Conflict/livery.cfg':
        '[GENERAL]\nname=Conflicting Overrides\n[FLTSIM.0]\nicao_airline=AAA\natc_id=SHARED\n[FLTSIM.1]\nicao_airline=BBB\natc_id=SHARED\n',
      'SimObjects/Airplanes/Unproven/Liveries/Named/livery.cfg':
        '[GENERAL]\nname="Native Livery"\n[FLTSIM.1]\nicao_airline=NEW\natc_id=NATIVE1\n',
      'SimObjects/Airplanes/Unproven/Liveries/Simple/livery.cfg':
        '[GENERAL]\nname=General Only\n',
    },
    'LIVERY'
  );
}

function verifyNativeRows(): void {
  const expected: unknown = JSON.parse(
    '[{"name":"Conflicting Overrides","registration":"SHARED","aircraft_id":null,"icao_code":null},{"name":"General Only","registration":null,"aircraft_id":null,"icao_code":null},{"name":"Native Livery","registration":"NATIVE1","aircraft_id":null,"icao_code":"NEW"}]'
  );
  if (!Array.isArray(expected)) {
    throw new TypeError('Expected native livery rows');
  }
  expect(
    fixture.query(
      'SELECT l.name, l.registration, l.aircraft_id, a.icao_code FROM liveries l LEFT JOIN airlines a ON a.id=l.airline_id ORDER BY l.name'
    )
  ).toEqual(expected);
  expect(fixture.query('SELECT count(*) AS total FROM aircraft')).toEqual([{total: 0}]);
}

test(
  'native livery files import one row per file and preserve identities on repeat',
  async () => {
    await nativePackages();
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    verifyNativeRows();
    const ids = fixture.query('SELECT id, source_key FROM liveries ORDER BY id');
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(fixture.query('SELECT id, source_key FROM liveries ORDER BY id')).toEqual(ids);
  },
  cliTimeout
);

test(
  'legacy variation sections link to their explicit virtual base and missing bases remain unknown',
  async () => {
    await fixture.addon(
      'base',
      {'SimObjects/Airplanes/Base/aircraft.cfg': '[GENERAL]\nicao_model=Base\n'},
      'AIRCRAFT'
    );
    await fixture.addon(
      'legacy',
      {
        'SimObjects/Airplanes/Legacy/aircraft.cfg':
          '[VARIATION]\nbase_container="..\\Base"\n[FLTSIM.0]\nui_variation=Legacy\n',
      },
      'LIVERY'
    );
    await fixture.addon(
      'unknown',
      {
        'SimObjects/Airplanes/Unknown/aircraft.cfg':
          '[VARIATION]\n[FLTSIM.0]\nui_variation=Unknown\n',
      },
      'LIVERY'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(fixture.query('SELECT count(*) AS total FROM aircraft')).toEqual([{total: 1}]);
    expect(
      fixture.query(
        "SELECT count(*) AS total FROM liveries WHERE name='Legacy' AND aircraft_id IS NOT NULL"
      )
    ).toEqual([{total: 1}]);
    expect(
      fixture.query(
        "SELECT count(*) AS total FROM liveries WHERE name='Unknown' AND target_aircraft_key IS NULL AND aircraft_id IS NULL"
      )
    ).toEqual([{total: 1}]);
  },
  cliTimeout
);

test(
  'airline names survive unnamed observations in either order within one batch',
  async () => {
    await fixture.addon('airline-names', {
      'SimObjects/Airplanes/Base/aircraft.cfg':
        '[GENERAL]\nicao_model=Base\n[FLTSIM.0]\nicao_airline=TST\natc_airline=Test Airline\n[FLTSIM.1]\nicao_airline=TST\n[FLTSIM.2]\nicao_airline=REV\n[FLTSIM.3]\nicao_airline=REV\natc_airline=Reverse Airline\n',
    });
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
    expect(
      fixture.query('SELECT icao_code, name FROM airlines ORDER BY icao_code')
    ).toEqual([
      {icao_code: 'REV', name: 'Reverse Airline'},
      {icao_code: 'TST', name: 'Test Airline'},
    ]);
  },
  cliTimeout
);
