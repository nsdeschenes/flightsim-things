import {expect, test} from 'bun:test';

import {Option} from 'effect';

import configurations from './aircraft.ts';

const missing = Option.getOrNull(Option.none());
const relative = 'SimObjects/Airplanes/Synthetic/aircraft.cfg';
const supported = `; Synthetic SDK-style configuration
[GENERAL] ; Section comment
icao_model = "Synthetic; Model//Name"
[FLTSIM.0]
ui_type = Synthetic
ui_variation = "Blue = White" ; Trailing comment
atc_id = TEST01
unknown_parameter = Type:12#Index:1
`;

test.each(['\n', '\r\n'])(
  'documented sections, assignments, and comments import with %j line endings',
  newline => {
    const result = configurations.aircraft(relative, supported.replaceAll('\n', newline));
    expect(result.aircraft).toEqual([
      {
        icaoTypeDesignator: missing,
        manufacturer: missing,
        model: 'Synthetic; Model//Name',
        name: 'Synthetic',
        sourceKey: 'simobjects/airplanes/synthetic',
      },
    ]);
    expect(result.liveries).toEqual([
      {
        airlineCode: missing,
        airlineName: missing,
        name: 'Blue = White',
        registration: 'TEST01',
        sourceKey: 'simobjects/airplanes/synthetic/aircraft.cfg#fltsim.0',
        targetAircraftKey: 'simobjects/airplanes/synthetic',
      },
    ]);
  }
);

test.each([
  {
    contents: '\uFEFF; comment\r\n\r\nprivate=value\r\n[GENERAL]',
    lineNumber: 3,
    reason: 'missing-section',
  },
  {
    contents: '; comment\n[GENERAL]\n\nPRIVATE_LINE',
    lineNumber: 4,
    reason: 'missing-equals',
  },
])(
  'invalid lines report $reason at physical line $lineNumber without contents',
  ({contents, lineNumber, reason}) => {
    for (const read of [configurations.aircraft, configurations.livery]) {
      expect(() => read(relative, contents)).toThrow(
        `Invalid aircraft configuration line (${reason}) at line ${lineNumber}`
      );
      try {
        read(relative, contents);
      } catch (error) {
        expect(error).toMatchObject({lineNumber, reason});
        expect(String(error)).not.toContain('PRIVATE_LINE');
        expect(String(error)).not.toContain('private=value');
        expect(String(error)).not.toContain(relative);
      }
    }
  }
);

test.each(['', '; comment only', '[VERSION]\nmajor=1'])(
  'configurations without inventory sections remain invalid',
  contents => {
    expect(() => configurations.aircraft(relative, contents)).toThrow(
      'Aircraft configuration requires GENERAL, LIVERY, or FLTSIM sections'
    );
  }
);
