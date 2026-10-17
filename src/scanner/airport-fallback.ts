import path from 'node:path';

import {Option} from 'effect';

import type PackageSnapshot from './model.ts';

type AirportObservation = PackageSnapshot['airports'][number];
const missing = Option.getOrNull(Option.none());
const sourceKey = '#package-name-airport';
const packageName =
  /^(?:[a-z\d]+-)+airport-(?<code>[a-z\d]{4})-[a-z\d]+(?:-[a-z\d]+)*$/iu;

function infer(sourcePath: string): readonly AirportObservation[] {
  const match = packageName.exec(path.basename(sourcePath));
  const groups = match && match.groups;
  if (!groups || typeof groups.code !== 'string') {
    return [];
  }

  return [
    {iataCode: missing, icaoCode: groups.code.toUpperCase(), name: missing, sourceKey},
  ];
}

const airportFallback = {infer, sourceKey};
export default airportFallback;
