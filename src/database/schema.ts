import path from 'node:path';

import {createRelationsHelper, defineRelations} from 'drizzle-orm';
import {
  createInsertSchema,
  createSelectSchema,
  createUpdateSchema,
} from 'drizzle-orm/effect-schema';
import {Schema} from 'effect';

import aircraft from './tables/aircraft.ts';
import airlines from './tables/airlines.ts';
import airports from './tables/airports.ts';
import liveries from './tables/liveries.ts';
import packages from './tables/packages.ts';

const tables = {aircraft, airlines, airports, liveries, packages};
const helpers = createRelationsHelper(tables);
const relations = defineRelations(tables, () => ({
  aircraft: {
    liveries: helpers.many.liveries(),
    package: helpers.one.packages({
      from: helpers.aircraft.packageId,
      optional: false,
      to: helpers.packages.id,
    }),
  },
  airlines: {liveries: helpers.many.liveries()},
  airports: {
    package: helpers.one.packages({
      from: helpers.airports.packageId,
      optional: false,
      to: helpers.packages.id,
    }),
  },
  liveries: {
    aircraft: helpers.one.aircraft({
      from: helpers.liveries.aircraftId,
      to: helpers.aircraft.id,
    }),
    airline: helpers.one.airlines({
      from: helpers.liveries.airlineId,
      to: helpers.airlines.id,
    }),
    package: helpers.one.packages({
      from: helpers.liveries.packageId,
      optional: false,
      to: helpers.packages.id,
    }),
  },
  packages: {
    aircraft: helpers.many.aircraft(),
    airports: helpers.many.airports(),
    liveries: helpers.many.liveries(),
  },
}));

function validatePackagePath(): Schema.String {
  return Schema.String.check(
    Schema.makeFilter(path.isAbsolute, {expected: 'an absolute package directory'})
  );
}

const packageRefinements = {sourcePath: validatePackagePath};
const schema = {
  ...tables,
  insert: {
    aircraft: createInsertSchema(aircraft),
    airlines: createInsertSchema(airlines),
    airports: createInsertSchema(airports),
    liveries: createInsertSchema(liveries),
    packages: createInsertSchema(packages, packageRefinements),
  },
  relations,
  select: {
    aircraft: createSelectSchema(aircraft),
    airlines: createSelectSchema(airlines),
    airports: createSelectSchema(airports),
    liveries: createSelectSchema(liveries),
    packages: createSelectSchema(packages, packageRefinements),
  },
  update: {
    aircraft: createUpdateSchema(aircraft),
    airlines: createUpdateSchema(airlines),
    airports: createUpdateSchema(airports),
    liveries: createUpdateSchema(liveries),
    packages: createUpdateSchema(packages, packageRefinements),
  },
};

export default schema;
