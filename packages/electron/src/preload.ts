import {contextBridge, ipcRenderer} from 'electron';
import {Schema} from 'effect';

import {
  addonLibraryChannel,
  addonLibrarySchema,
  enrichAirportsChannel,
  enrichmentResultSchema,
  openAipKeyStatusChannel,
  openAipKeyStatusSchema,
  saveOpenAipKeyChannel,
  removeOpenAipKeyChannel,
  runtimeHealthChannel,
  runtimeHealthSchema,
  saveCommunityPathChannel,
  scanAddonsChannel,
  scanResultSchema,
  simulatorInventorySchema,
} from '@flightsim-things/contract';
import type {DesktopApi} from '@flightsim-things/contract';

function invoke<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  channel: string,
  ...args: unknown[]
): Promise<S['Type']> {
  return ipcRenderer.invoke(channel, ...args).then(Schema.decodeUnknownPromise(schema));
}

const desktop: DesktopApi = {
  getOpenAipKeyStatus: () => invoke(openAipKeyStatusSchema, openAipKeyStatusChannel),
  saveOpenAipKey: key => invoke(openAipKeyStatusSchema, saveOpenAipKeyChannel, key),
  removeOpenAipKey: () => invoke(openAipKeyStatusSchema, removeOpenAipKeyChannel),
  getRuntimeHealth: () => invoke(runtimeHealthSchema, runtimeHealthChannel),
  getAddonLibrary: () => invoke(addonLibrarySchema, addonLibraryChannel),
  saveCommunityPath: (simulator, path) =>
    invoke(simulatorInventorySchema, saveCommunityPathChannel, simulator, path),
  scanAddons: simulator => invoke(scanResultSchema, scanAddonsChannel, simulator),
  enrichAirports: (simulator, apiKey) =>
    invoke(enrichmentResultSchema, enrichAirportsChannel, simulator, apiKey),
};
contextBridge.exposeInMainWorld('desktop', desktop);
