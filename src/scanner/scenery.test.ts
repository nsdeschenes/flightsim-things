import {expect, test} from 'bun:test';

import readScenery from './scenery.ts';

test.each([
  '<malformed',
  '<Sound><broken',
  '\uFEFF<?xml version="1.0" encoding="UTF-8"?><!-- <FSData> --><Sound><broken',
])('unrelated malformed XML records a skipped file for %s', async xml => {
  const result = await readScenery(
    'simobjects/airplanes/base/sound.xml',
    new Blob([xml]),
    {filePath: 'simobjects/airplanes/base/sound.xml', packageName: 'test-package'}
  );
  expect(result.airports).toEqual([]);
  expect(result.skippedXmlFiles).toEqual(['simobjects/airplanes/base/sound.xml']);
});

test.each([
  ['malformed-airport', 'arbitrary.xml', '<FSData><Airport'],
  ['invalid-code', 'arbitrary.xml', '<FSData><Airport ident="?"/></FSData>'],
  ['invalid-iata', 'arbitrary.xml', '<FSData><Airport ident="KAAA" iata="?"/></FSData>'],
  [
    'duplicate-code',
    'arbitrary.xml',
    '<FSData><Airport ident="KAAA"/><Airport ident="KAAA"/></FSData>',
  ],
  ['services', 'airportservices/kaaa/services.xml', '<Service.Packages><broken'],
  ['uncertain-root', 'arbitrary.xml', '<!-- missing close <Sound>'],
  ['doctype', 'arbitrary.xml', '<!DOCTYPE Sound><Sound><broken'],
  [
    'unsupported-encoding',
    'arbitrary.xml',
    '<?xml version="1.0" encoding="UTF-16"?><Sound><broken',
  ],
])('airport corruption and uncertain XML reject %s', (_name, filename, xml) => {
  expect(
    readScenery(filename, new Blob([xml]), {
      filePath: filename,
      packageName: 'test-package',
    })
  ).rejects.toThrow();
});
