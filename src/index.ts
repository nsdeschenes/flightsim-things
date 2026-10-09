import {buildApplication, buildCommand, buildRouteMap, run} from '@stricli/core';

const argvOffset = 2,
  hello = buildCommand({
    docs: {
      brief: 'Print a greeting',
    },
    func() {
      this.process.stdout.write('Hello via Bun!\n');
    },
    parameters: {
      flags: {},
    },
  }),
  routes = buildRouteMap({
    docs: {
      brief: 'Flight simulator tools',
    },
    routes: {hello},
  });

// eslint-disable-next-line node/no-top-level-await -- This CLI entrypoint is not loaded with require.
await run(
  buildApplication(routes, {name: 'flightsim-things'}),
  process.argv.slice(argvOffset),
  {
    process,
  }
);
