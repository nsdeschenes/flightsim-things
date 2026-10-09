import {buildApplication, buildCommand, buildRouteMap, run} from '@stricli/core';

import communityPath from './community-path.ts';

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
  saveCommunityPath = buildCommand<Readonly<Record<string, never>>, [string]>({
    docs: {
      brief: 'Save or replace the MSFS 2024 Community directory',
    },
    async func(_flags: Readonly<Record<string, never>>, path: string) {
      this.process.stdout.write(`${await communityPath.set(path)}\n`);
    },
    parameters: {
      flags: {},
      positional: {
        kind: 'tuple',
        parameters: [
          {
            brief: 'An existing Community directory',
            parse: String,
            placeholder: 'path',
          },
        ],
      },
    },
  }),
  communityPathRoutes = buildRouteMap({
    docs: {
      brief: 'Manage the saved MSFS 2024 Community directory',
    },
    routes: {
      get: buildCommand({
        docs: {
          brief: 'Print the saved Community directory',
        },
        async func() {
          this.process.stdout.write(`${await communityPath.get()}\n`);
        },
        parameters: {
          flags: {},
        },
      }),
      set: saveCommunityPath,
      update: saveCommunityPath,
    },
  }),
  routes = buildRouteMap({
    docs: {
      brief: 'Flight simulator tools',
    },
    routes: {'community-path': communityPathRoutes, hello},
  });

// eslint-disable-next-line node/no-top-level-await -- This CLI entrypoint is not loaded with require.
await run(
  buildApplication(routes, {name: 'flightsim-things'}),
  process.argv.slice(argvOffset),
  {
    process,
  }
);
