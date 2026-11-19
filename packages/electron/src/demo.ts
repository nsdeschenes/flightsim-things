import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {Effect} from 'effect';

import {simulators} from '@flightsim-things/contract';
import type {SimulatorId} from '@flightsim-things/contract';
import type {AddonDatabase} from '@flightsim-things/db';

import {scanCommunityDirectory} from './addons.js';
import {fileSystem} from './errors.js';

interface DemoAirport {
  icaoCode: string;
  iataCode: string;
  name: string;
  position?: {latitude: number; longitude: number};
}

interface DemoPackage {
  folderName: string;
  title: string;
  version: string;
  creator: string;
  contentType: 'AIRCRAFT' | 'LIVERY' | 'SCENERY';
  airports?: readonly DemoAirport[];
}

const seattle: DemoAirport = {
  icaoCode: 'KSEA',
  iataCode: 'SEA',
  name: 'Seattle Tacoma International Airport',
  position: {latitude: 47.449, longitude: -122.3093},
};

const demoPackages: Record<SimulatorId, readonly DemoPackage[]> = {
  msfs2020: [
    {
      folderName: 'demo-aircraft-737',
      title: 'Demo 737-800',
      version: '2.1.0',
      creator: 'Demo Aviation',
      contentType: 'AIRCRAFT',
    },
    {
      folderName: 'demo-livery-northern-lights',
      title: 'Demo 737-800 Northern Lights Livery',
      version: '1.0.2',
      creator: 'Demo Liveries',
      contentType: 'LIVERY',
    },
    {
      folderName: 'demo-airport-ksea-seattle',
      title: 'Demo Seattle Tacoma Airport',
      version: '1.3.0',
      creator: 'Demo Airports',
      contentType: 'SCENERY',
      airports: [seattle],
    },
    {
      folderName: 'demo-airport-lowi-innsbruck',
      title: 'Demo Innsbruck Airport',
      version: '2.0.0',
      creator: 'Demo Airports',
      contentType: 'SCENERY',
      airports: [
        {
          icaoCode: 'LOWI',
          iataCode: 'INN',
          name: 'Innsbruck Airport',
          position: {latitude: 47.2602, longitude: 11.344},
        },
      ],
    },
    {
      folderName: 'demo-airport-nzqn-queenstown',
      title: 'Demo Queenstown Airport',
      version: '1.0.0',
      creator: 'Demo Airports',
      contentType: 'SCENERY',
      airports: [
        {
          icaoCode: 'NZQN',
          iataCode: 'ZQN',
          name: 'Queenstown Airport',
        },
      ],
    },
    {
      folderName: 'demo-scenery-rocky-mountains',
      title: 'Demo Rocky Mountains Terrain',
      version: '1.4.1',
      creator: 'Demo Landscapes',
      contentType: 'SCENERY',
    },
  ],
  msfs2024: [
    {
      folderName: 'demo-aircraft-a350',
      title: 'Demo A350-900',
      version: '1.2.0',
      creator: 'Demo Aviation',
      contentType: 'AIRCRAFT',
    },
    {
      folderName: 'demo-livery-pacific-blue',
      title: 'Demo A350-900 Pacific Blue Livery',
      version: '1.1.0',
      creator: 'Demo Liveries',
      contentType: 'LIVERY',
    },
    {
      folderName: 'demo-airport-ksea-seattle',
      title: 'Demo Seattle Tacoma Airport 2024',
      version: '2.0.0',
      creator: 'Demo Airports',
      contentType: 'SCENERY',
      airports: [seattle],
    },
    {
      folderName: 'demo-airport-cyul-montreal',
      title: 'Demo Montreal Trudeau Airport',
      version: '1.5.0',
      creator: 'Demo Airports',
      contentType: 'SCENERY',
      airports: [
        {
          icaoCode: 'CYUL',
          iataCode: 'YUL',
          name: 'Montreal Trudeau International Airport',
          position: {latitude: 45.4706, longitude: -73.7408},
        },
      ],
    },
    {
      folderName: 'demo-airport-rjtt-tokyo',
      title: 'Demo Tokyo Haneda Airport',
      version: '3.0.1',
      creator: 'Demo Airports',
      contentType: 'SCENERY',
      airports: [
        {
          icaoCode: 'RJTT',
          iataCode: 'HND',
          name: 'Tokyo Haneda Airport',
          position: {latitude: 35.5523, longitude: 139.7798},
        },
      ],
    },
    {
      folderName: 'demo-scenery-alps',
      title: 'Demo Alps Terrain',
      version: '2.2.0',
      creator: 'Demo Landscapes',
      contentType: 'SCENERY',
    },
  ],
};

export const seedDemoLibrary = Effect.fn(function* (
  database: AddonDatabase,
  profilePath: string
) {
  for (const simulator of simulators) {
    const inventory = yield* database.getInventory(simulator);
    if (inventory.communityPath !== null) {
      continue;
    }
    const communityPath = join(profilePath, simulator, 'Community');
    for (const fixture of demoPackages[simulator]) {
      const packagePath = join(communityPath, fixture.folderName);
      yield* fileSystem(() => mkdir(packagePath, {recursive: true}));
      yield* fileSystem(() =>
        writeFile(
          join(packagePath, 'manifest.json'),
          JSON.stringify({
            dependencies: [],
            content_type: fixture.contentType,
            title: fixture.title,
            creator: fixture.creator,
            package_version: fixture.version,
            minimum_game_version: '1.0.0',
          })
        )
      );
      const airports = fixture.airports ?? [];
      const xml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<FSData version="9.0">',
        ...airports.map(airport => {
          const name = airport.name
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('"', '&quot;');
          return `  <Airport ident="${airport.icaoCode}" iata="${airport.iataCode}" name="${name}" />`;
        }),
        '</FSData>',
        '',
      ].join('\n');
      if (airports.length) {
        yield* fileSystem(() => writeFile(join(packagePath, 'airports.xml'), xml));
      }
      yield* fileSystem(() =>
        writeFile(
          join(packagePath, 'layout.json'),
          JSON.stringify({
            content: airports.length
              ? [{path: 'airports.xml', size: Buffer.byteLength(xml), date: 0}]
              : [],
          })
        )
      );
    }
    const {addons, airports, incompleteAirportFolders} = yield* scanCommunityDirectory(
      simulator,
      communityPath
    );
    const positionedAirports = airports.map(airport => {
      const fixture = demoPackages[simulator].find(
        entry => entry.folderName === airport.folderName
      );
      const position = fixture?.airports?.find(
        entry => entry.icaoCode === airport.icaoCode
      )?.position;
      return {...airport, ...position};
    });
    yield* database.replaceInventory(
      simulator,
      communityPath,
      addons,
      positionedAirports,
      incompleteAirportFolders
    );
    yield* database.saveCommunityPath(simulator, communityPath);
  }
});
