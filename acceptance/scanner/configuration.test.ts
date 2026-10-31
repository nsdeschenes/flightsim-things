import {afterEach, beforeEach, expect, test} from 'bun:test';

import createFixture from '#acceptance-scanner';

let fixture: Awaited<ReturnType<typeof createFixture>>;
const cliTimeout = 60_000;

beforeEach(async () => {
  fixture = await createFixture();
});
afterEach(async () => {
  await fixture.dispose();
});

test(
  'SDK-style aircraft and native livery configurations import through the scanner',
  async () => {
    await fixture.addon(
      'synthetic-aircraft',
      {
        'SimObjects/Airplanes/Synthetic/aircraft.cfg':
          '; Synthetic fixture\r\n[GENERAL] ; Section comment\r\nicao_model="Synthetic; Model//Name"\r\n[FLTSIM.0]\r\nui_variation="Blue = White" ; Comment\r\natc_id=TEST01\r\n',
      },
      'AIRCRAFT'
    );
    await fixture.addon(
      'synthetic-livery',
      {
        'SimObjects/Airplanes/Synthetic/Liveries/Named/livery.cfg':
          '; Synthetic fixture\n[GENERAL]\nname="Native; Livery" ; Comment\n[FLTSIM.0]\natc_id=NATIVE01\n',
      },
      'LIVERY'
    );
    expect(await fixture.run('community-path', 'set', fixture.community)).toMatchObject({
      exitCode: 0,
    });
    const result = await fixture.run('scan');
    expect(result).toMatchObject({exitCode: 0, stderr: ''});
    expect(fixture.query('SELECT model FROM aircraft')).toEqual([
      {model: 'Synthetic; Model//Name'},
    ]);
    expect(
      fixture.query('SELECT name, registration FROM liveries ORDER BY name')
    ).toEqual([
      {name: 'Blue = White', registration: 'TEST01'},
      {name: 'Native; Livery', registration: 'NATIVE01'},
    ]);
  },
  cliTimeout
);
