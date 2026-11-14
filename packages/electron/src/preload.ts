import {contextBridge, ipcRenderer} from 'electron';

import {runtimeHealthChannel} from '@flightsim-things/contract';
import type {DesktopApi} from '@flightsim-things/contract';

const desktop: DesktopApi = {
  getRuntimeHealth: () => ipcRenderer.invoke(runtimeHealthChannel),
};
contextBridge.exposeInMainWorld('desktop', desktop);
