import {beforeEach, expect, test, vi} from 'vitest';

import type {DesktopApi, SimulatorInventory} from '@flightsim-things/contract';

const transport = vi.hoisted(() => ({
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  expose: vi.fn<(name: string, api: DesktopApi) => void>(),
}));

vi.mock('electron', () => ({
  contextBridge: {exposeInMainWorld: transport.expose},
  ipcRenderer: {invoke: transport.invoke},
}));

import './preload.js';

const desktop = transport.expose.mock.calls[0][1];
const inventory: SimulatorInventory = {
  simulator: 'msfs2020',
  communityPath: '/community',
  scannedPath: '/community',
  scannedAt: '2026-11-15T00:00:00.000Z',
  addons: [
    {
      simulator: 'msfs2020',
      folderName: 'airport',
      folderPath: '/community/airport',
      name: 'Airport',
      version: null,
      creator: null,
      contentType: null,
      manifestJson: '{}',
    },
  ],
  airports: [
    {
      simulator: 'msfs2020',
      folderName: 'airport',
      sourceKey: 'airport:0',
      icaoCode: 'KSEA',
      iataCode: null,
      name: null,
      elevationMeters: null,
      latitude: 47.45,
      longitude: -122.31,
    },
  ],
};

const calls: Array<{
  name: string;
  run: (api: DesktopApi) => Promise<unknown>;
  args: unknown[];
  result: unknown;
}> = [
  {
    name: 'getOpenAipKeyStatus',
    run: api => api.getOpenAipKeyStatus(),
    args: ['openaip:key-status'],
    result: {saved: false, available: true},
  },
  {
    name: 'saveOpenAipKey',
    run: api => api.saveOpenAipKey('key'),
    args: ['openaip:save-key', 'key'],
    result: {saved: true, available: true},
  },
  {
    name: 'removeOpenAipKey',
    run: api => api.removeOpenAipKey(),
    args: ['openaip:remove-key'],
    result: {saved: false, available: true},
  },
  {
    name: 'getRuntimeHealth',
    run: api => api.getRuntimeHealth(),
    args: ['runtime:health'],
    result: {status: 'ready', database: 'connected'},
  },
  {
    name: 'getAddonLibrary',
    run: api => api.getAddonLibrary(),
    args: ['addons:library'],
    result: [inventory],
  },
  {
    name: 'saveCommunityPath',
    run: api => api.saveCommunityPath('msfs2020', '/community'),
    args: ['addons:save-community-path', 'msfs2020', '/community'],
    result: inventory,
  },
  {
    name: 'scanAddons',
    run: api => api.scanAddons('msfs2020'),
    args: ['addons:scan', 'msfs2020'],
    result: {inventory, warnings: [{folderName: 'broken', message: 'Invalid manifest'}]},
  },
  {
    name: 'enrichAirports',
    run: api => api.enrichAirports('msfs2020', 'key'),
    args: ['airports:enrich', 'msfs2020', 'key'],
    result: {
      inventory,
      summary: {airports: 1, enriched: 1, unmatched: 0, ambiguous: 0, skipped: 0},
    },
  },
];

beforeEach(() => transport.invoke.mockReset());

test.each(calls)('$name preserves Promise results and IPC arguments', async call => {
  transport.invoke.mockResolvedValueOnce(call.result);
  expect(await call.run(desktop)).toEqual(call.result);
  expect(transport.invoke).toHaveBeenCalledExactlyOnceWith(...call.args);
});

test.each(calls)('$name rejects an invalid IPC response', async call => {
  transport.invoke.mockResolvedValueOnce(null);
  await expect(call.run(desktop)).rejects.toThrow();
});

test('rejects malformed nested airport data before exposing it to the renderer', async () => {
  transport.invoke.mockResolvedValueOnce([
    {...inventory, airports: [{...inventory.airports[0], longitude: 'invalid'}]},
  ]);
  await expect(desktop.getAddonLibrary()).rejects.toThrow(/longitude/);
});

test('rejects unsupported simulators from the main process', async () => {
  transport.invoke.mockResolvedValueOnce([{...inventory, simulator: 'unsupported'}]);
  await expect(desktop.getAddonLibrary()).rejects.toThrow(/simulator/);
});

test('propagates IPC transport failures as rejected Promises', async () => {
  transport.invoke.mockRejectedValueOnce(new Error('Database unavailable'));
  await expect(desktop.getRuntimeHealth()).rejects.toThrow('Database unavailable');
});
