import {contextBridge, ipcRenderer} from 'electron';

import {
  addonLibraryChannel,
  runtimeHealthChannel,
  saveCommunityPathChannel,
  scanAddonsChannel,
} from '@flightsim-things/contract';
import type {DesktopApi} from '@flightsim-things/contract';

const desktop: DesktopApi = {
  getRuntimeHealth: () => ipcRenderer.invoke(runtimeHealthChannel),
  getAddonLibrary: () => ipcRenderer.invoke(addonLibraryChannel),
  saveCommunityPath: (simulator, path) =>
    ipcRenderer.invoke(saveCommunityPathChannel, simulator, path),
  scanAddons: simulator => ipcRenderer.invoke(scanAddonsChannel, simulator),
};
contextBridge.exposeInMainWorld('desktop', desktop);
