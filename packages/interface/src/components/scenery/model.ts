import type {
  Addon,
  Airport,
  SimulatorId,
  SimulatorInventory,
} from '@flightsim-things/contract';

export type Position = [longitude: number, latitude: number];
type InstallationBase = {
  id: string;
  simulator: SimulatorId;
  folderName: string;
  package: Addon | undefined;
  name: string;
  position: Position | null;
};
export type Installation = InstallationBase &
  (
    | {kind: 'airport'; airport: Airport}
    | {kind: 'scenery'; package: Addon; position: null}
  );

export const simulatorLabel = (simulator: SimulatorId) =>
  simulator === 'msfs2020' ? 'MSFS 2020' : 'MSFS 2024';

function airportPosition(airport: Airport): Position | null {
  const {longitude, latitude} = airport;
  return typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180 &&
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90
    ? [longitude, latitude]
    : null;
}

export function installations(library: SimulatorInventory[]): Installation[] {
  return library
    .flatMap(inventory => {
      const packages = new Map(inventory.addons.map(addon => [addon.folderName, addon]));
      const airports: Installation[] = inventory.airports.map(airport => ({
        id: JSON.stringify([inventory.simulator, airport.folderName, airport.sourceKey]),
        simulator: inventory.simulator,
        folderName: airport.folderName,
        package: packages.get(airport.folderName),
        name: airport.name ?? airport.icaoCode ?? airport.iataCode ?? airport.folderName,
        position: airportPosition(airport),
        kind: 'airport',
        airport,
      }));
      const scenery: Installation[] = inventory.addons
        .filter(addon => addon.contentType?.toUpperCase() === 'SCENERY')
        .map(addon => ({
          id: JSON.stringify(['package', inventory.simulator, addon.folderName]),
          simulator: inventory.simulator,
          folderName: addon.folderName,
          package: addon,
          name: addon.name,
          position: null,
          kind: 'scenery',
        }));
      return [...airports, ...scenery];
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export function locationGroups(records: Installation[]) {
  const groups = new Map<string, {position: Position; records: Installation[]}>();
  for (const record of records) {
    if (!record.position) {
      continue;
    }
    const key = JSON.stringify(record.position);
    const group = groups.get(key);
    if (group) {
      group.records.push(record);
    } else {
      groups.set(key, {position: record.position, records: [record]});
    }
  }
  return [...groups.values()];
}
