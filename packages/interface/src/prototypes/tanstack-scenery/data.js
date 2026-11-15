const simulators = new Set(['msfs2020', 'msfs2024']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a nonempty string.`);
  }
  return value;
}

function optionalText(value, label) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string or null.`);
  }
  return value.trim() || null;
}

function position(longitude, latitude) {
  if (
    Number.isFinite(longitude) &&
    Math.abs(longitude) <= 180 &&
    Number.isFinite(latitude) &&
    Math.abs(latitude) <= 90
  ) {
    return [longitude, latitude];
  }
  return null;
}

/** Convert SimulatorInventory[] into installation records with position: [lon, lat] | null. */
export function inventoryRecords(inventories) {
  if (!Array.isArray(inventories)) {
    throw new Error('Choose a JSON array of simulator inventories.');
  }
  const records = [];
  const identities = new Set();
  const seenSimulators = new Set();
  for (const value of inventories) {
    const inventory = object(value, 'Inventory');
    const simulator = inventory.simulator;
    if (!simulators.has(simulator)) {
      throw new Error('Inventory simulator must be msfs2020 or msfs2024.');
    }
    if (seenSimulators.has(simulator)) {
      throw new Error(`Duplicate inventory for ${simulator}.`);
    }
    seenSimulators.add(simulator);
    if (!Array.isArray(inventory.addons) || !Array.isArray(inventory.airports)) {
      throw new Error('Each inventory needs addons and airports arrays.');
    }
    const packages = new Map();
    for (const value of inventory.addons) {
      const addon = object(value, 'Addon');
      if (addon.simulator !== simulator) {
        throw new Error('Addon simulator must match its inventory.');
      }
      const folder = text(addon.folderName, 'Addon folderName');
      if (packages.has(folder)) {
        throw new Error(`Duplicate package ${folder}.`);
      }
      packages.set(folder, {
        name: text(addon.name, 'Addon name'),
        contentType: optionalText(addon.contentType, 'Addon contentType'),
      });
    }
    const airportFolders = new Set();
    for (const value of inventory.airports) {
      const airport = object(value, 'Airport');
      if (airport.simulator !== simulator) {
        throw new Error('Airport simulator must match its inventory.');
      }
      const folder = text(airport.folderName, 'Airport folderName');
      const source = text(airport.sourceKey, 'Airport sourceKey');
      const id = JSON.stringify([simulator, folder, source]);
      if (identities.has(id)) {
        throw new Error(`Duplicate airport source ${source}.`);
      }
      identities.add(id);
      airportFolders.add(folder);
      const parent = packages.get(folder);
      records.push({
        id,
        packageId: JSON.stringify([simulator, folder]),
        sim: simulator,
        packageName: parent?.name ?? folder,
        folderName: folder,
        name: optionalText(airport.name, 'Airport name') ?? 'Unnamed airport',
        code:
          optionalText(airport.icaoCode, 'ICAO code') ??
          optionalText(airport.iataCode, 'IATA code') ??
          '',
        kind: 'airport',
        position: position(airport.longitude, airport.latitude),
        missingParent: !parent,
      });
    }
    for (const [folder, addon] of packages) {
      if (airportFolders.has(folder) || addon.contentType?.toUpperCase() !== 'SCENERY') {
        continue;
      }
      const packageId = JSON.stringify([simulator, folder]);
      records.push({
        id: JSON.stringify([simulator, folder]),
        packageId,
        sim: simulator,
        packageName: addon.name,
        folderName: folder,
        name: addon.name,
        code: '',
        kind: 'package',
        position: null,
        missingParent: false,
      });
    }
  }
  return records;
}

const airports = [
  ['KSEA', 'Seattle Tacoma', -122.31, 47.45, 'msfs2024', 'Northwest Airports'],
  ['KJFK', 'John F. Kennedy', -73.78, 40.64, 'msfs2024', 'New York'],
  ['EGLL', 'London Heathrow', -0.45, 51.47, 'msfs2024', 'Heathrow'],
  ['LFPG', 'Paris Charles de Gaulle', 2.55, 49.01, 'msfs2020', 'Paris'],
  ['LOWI', 'Innsbruck', 11.34, 47.26, 'msfs2024', 'Alpine Airports'],
  ['YSSY', 'Sydney', 151.18, -33.95, 'msfs2020', 'Sydney'],
  ['NZQN', 'Queenstown', 168.74, -45.02, 'msfs2024', 'Queenstown'],
  ['RJTT', 'Tokyo Haneda', 139.78, 35.55, 'msfs2024', 'Tokyo'],
  ['KSEA', 'Seattle alternate', -122.31, 47.45, 'msfs2020', 'Seattle package'],
  ['CYVR', 'Vancouver', null, null, 'msfs2024', 'Vancouver'],
];

export const sampleInventory = [...simulators].map(simulator => {
  const rows = airports.filter(row => row[4] === simulator);
  const addons = rows.map(row => ({
    simulator,
    folderName: row[5],
    folderPath: `/sample/${row[5]}`,
    name: row[5],
    version: null,
    creator: null,
    contentType: 'SCENERY',
    manifestJson: '{}',
  }));
  if (simulator === 'msfs2020') {
    addons.push({
      simulator,
      folderName: 'regional-scenery',
      folderPath: '/sample/regional-scenery',
      name: 'Regional scenery',
      version: null,
      creator: null,
      contentType: 'SCENERY',
      manifestJson: '{}',
    });
  }
  return {
    simulator,
    communityPath: null,
    scannedPath: null,
    scannedAt: null,
    addons,
    airports: rows.map(row => ({
      simulator,
      folderName: row[5],
      sourceKey: row[0],
      icaoCode: row[0],
      iataCode: null,
      name: row[1],
      longitude: row[2],
      latitude: row[3],
      elevationMeters: null,
    })),
  };
});

export function sampleRecords(scenario) {
  if (scenario === 'empty') {
    return [];
  }
  const sample = inventoryRecords(sampleInventory);
  if (scenario === 'missing') {
    return sample.map(record => ({...record, position: null}));
  }
  if (scenario === 'dense') {
    return Array.from({length: 1000}, (_, index) => ({
      id: `synthetic-${index}`,
      packageId: `synthetic-${index}`,
      code: `S${index}`,
      name: `Synthetic airport ${index}`,
      position: [((index * 137.508) % 350) - 175, ((index * 17.13) % 130) - 60],
      sim: index % 2 ? 'msfs2024' : 'msfs2020',
      packageName: `Synthetic package ${index}`,
      folderName: `synthetic-${index}`,
      kind: 'airport',
      missingParent: false,
    }));
  }
  return sample;
}
