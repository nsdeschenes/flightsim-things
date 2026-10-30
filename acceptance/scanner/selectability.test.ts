import {afterEach, beforeEach, expect, test} from 'bun:test';

import createFixture from '#acceptance-scanner';

let fixture: Awaited<ReturnType<typeof createFixture>>;
const cliTimeout = 60_000;
const successExitCode = 0;
const changingFilename = 'SimObjects/Airplanes/Changing/aircraft.cfg';
const changingInitial =
  '[GENERAL]\nicao_model=Changing\n[FLTSIM.0]\nui_variation=Keep\n[FLTSIM.1]\nui_variation=Hide\n';

beforeEach(async () => {
  fixture = await createFixture();
});
afterEach(async () => {
  await fixture.dispose();
});

test(
  'scan excludes non-selectable traffic variations while keeping flyable and legacy entries',
  async () => {
    await fixture.addon(
      'fsltl-traffic-base',
      {
        'SimObjects/Airplanes/FSLTL_A20N/aircraft.cfg':
          '[GENERAL]\nicao_model=Traffic Base\n[FLTSIM.0]\nui_variation=Traffic Base\nisAirTraffic=1\nisUserSelectable=0\n',
        'SimObjects/Airplanes/FSLTL_A20N_AEE/aircraft.cfg':
          '[VARIATION]\nbase_container="..\\FSLTL_A20N"\n[FLTSIM.0]\nui_variation=Aegean Traffic\nicao_airline=AEE\nisairtraffic=1\nisuserselectable=0\n',
      },
      'AIRCRAFT'
    );
    await fixture.addon(
      'mixed',
      {
        'SimObjects/Airplanes/Legacy/aircraft.cfg': '[GENERAL]\nicao_model=Legacy\n',
        'SimObjects/Airplanes/Mixed/aircraft.cfg':
          '[GENERAL]\nicao_model=Mixed\n[FLTSIM.0]\nui_variation=Hidden\nisUserSelectable="FALSE" ; hidden\n[FLTSIM.1]\nui_variation=Flyable AI\nisUserSelectable=1\nisAirTraffic=1\ncanBeUsedByAITraffic=1\n[FLTSIM.2]\nui_variation=Legacy AI\nisAirTraffic=1\n[FLTSIM.3]\nui_variation=Legacy\n[FLTSIM.4]\nui_variation=Flyable\nisUserSelectable=True\nisAirTraffic=0\n',
      },
      'AIRCRAFT'
    );
    await fixture.addon(
      'hidden-livery',
      {
        'SimObjects/Airplanes/Hidden/aircraft.cfg':
          '[LIVERY]\nbase_container="..\\Mixed"\n[FLTSIM.0]\nui_variation=Hidden repaint\nisUserSelectable=0\nisAirTraffic=0\n',
      },
      'LIVERY'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    const result = await fixture.run('scan');
    expect(result.exitCode).toBe(successExitCode);
    expect(result.stdout).toContain(
      'Scanned 3 packages, 2 aircraft, 0 airports, and 4 liveries.'
    );
    expect(fixture.query('SELECT model FROM aircraft ORDER BY model')).toEqual([
      {model: 'Legacy'},
      {model: 'Mixed'},
    ]);
    expect(fixture.query('SELECT name FROM liveries ORDER BY name')).toEqual([
      {name: 'Flyable'},
      {name: 'Flyable AI'},
      {name: 'Legacy'},
      {name: 'Legacy AI'},
    ]);
    expect(fixture.query('SELECT count(*) AS total FROM airlines')).toEqual([{total: 0}]);
  },
  cliTimeout
);

async function scanChanging(contents: string): Promise<void> {
  await fixture.addon('changing', {[changingFilename]: contents}, 'AIRCRAFT');
  expect(await fixture.run('scan')).toMatchObject({exitCode: 0});
}

async function verifyPartialRescan(): Promise<void> {
  const kept = fixture.query("SELECT id FROM liveries WHERE name='Keep'");
  expect(fixture.query('SELECT name FROM liveries ORDER BY name')).toEqual([
    {name: 'Hide'},
    {name: 'Keep'},
    {name: 'Untouched'},
  ]);
  await scanChanging(`${changingInitial}isUserSelectable=0\n`);
  expect(fixture.query('SELECT name FROM liveries ORDER BY name')).toEqual([
    {name: 'Keep'},
    {name: 'Untouched'},
  ]);
  expect(fixture.query("SELECT id FROM liveries WHERE name='Keep'")).toEqual(kept);
}

test(
  'rescan removes newly hidden variations and AI-only aircraft while retaining other packages and row identities',
  async () => {
    await fixture.addon(
      'untouched',
      {
        'SimObjects/Airplanes/Untouched/aircraft.cfg':
          '[GENERAL]\nicao_model=Untouched\n[FLTSIM.0]\nui_variation=Untouched\n',
      },
      'AIRCRAFT'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    await scanChanging(changingInitial);
    const untouched = fixture.query("SELECT id FROM aircraft WHERE model='Untouched'");
    await verifyPartialRescan();
    await scanChanging(
      changingInitial.replaceAll('ui_variation=', 'isUserSelectable=0\nui_variation=')
    );
    expect(fixture.query('SELECT name FROM liveries')).toEqual([{name: 'Untouched'}]);
    expect(fixture.query('SELECT model FROM aircraft')).toEqual([{model: 'Untouched'}]);
    expect(fixture.query("SELECT id FROM aircraft WHERE model='Untouched'")).toEqual(
      untouched
    );
  },
  cliTimeout
);

test(
  'cleanup spans deletion batches and failed package reads preserve their prior rows',
  async () => {
    const variations = Array.from(
      {length: 135},
      (_value, index) => `[FLTSIM.${index}]\nui_variation=Traffic ${index}\n`
    ).join('');
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    await scanChanging(`[GENERAL]\nicao_model=Changing\n${variations}`);
    expect(fixture.query('SELECT count(*) AS total FROM liveries')).toEqual([
      {total: 135},
    ]);
    await fixture.addon(
      'changing',
      {[changingFilename]: 'invalid configuration'},
      'AIRCRAFT'
    );
    expect(await fixture.run('scan')).toMatchObject({exitCode: 1});
    expect(fixture.query('SELECT count(*) AS total FROM liveries')).toEqual([
      {total: 135},
    ]);
    await scanChanging(
      `[GENERAL]\nicao_model=Changing\n${variations.replaceAll('ui_variation=', 'isUserSelectable=0\nui_variation=')}[FLTSIM.135]\nui_variation=Flyable\n`
    );
    expect(fixture.query('SELECT name FROM liveries')).toEqual([{name: 'Flyable'}]);
    expect(fixture.query('SELECT model FROM aircraft')).toEqual([{model: 'Changing'}]);
  },
  cliTimeout
);
