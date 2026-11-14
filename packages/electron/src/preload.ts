import {contextBridge, ipcRenderer} from 'electron';

import {
  addonLibraryChannel,
  enrichAirportsChannel,
  openAipKeyStatusChannel,
  saveOpenAipKeyChannel,
  removeOpenAipKeyChannel,
  runtimeHealthChannel,
  saveCommunityPathChannel,
  scanAddonsChannel,
} from '@flightsim-things/contract';
import type {DesktopApi} from '@flightsim-things/contract';

const desktop: DesktopApi = {
  getOpenAipKeyStatus: () => ipcRenderer.invoke(openAipKeyStatusChannel),
  saveOpenAipKey: key => ipcRenderer.invoke(saveOpenAipKeyChannel, key),
  removeOpenAipKey: () => ipcRenderer.invoke(removeOpenAipKeyChannel),
  getRuntimeHealth: () => ipcRenderer.invoke(runtimeHealthChannel),
  getAddonLibrary: () => ipcRenderer.invoke(addonLibraryChannel),
  saveCommunityPath: (simulator, path) =>
    ipcRenderer.invoke(saveCommunityPathChannel, simulator, path),
  scanAddons: simulator => ipcRenderer.invoke(scanAddonsChannel, simulator),
  enrichAirports: (simulator, apiKey) =>
    ipcRenderer.invoke(enrichAirportsChannel, simulator, apiKey),
};
contextBridge.exposeInMainWorld('desktop', desktop);
