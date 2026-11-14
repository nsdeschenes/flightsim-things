import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {app, BrowserWindow, ipcMain, safeStorage, session} from 'electron';
import type {IpcMainInvokeEvent} from 'electron';

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
import type {RuntimeHealth} from '@flightsim-things/contract';
import {openDatabase} from '@flightsim-things/db';

import {createAddonLibrary, parseCommunityPath, parseSimulator} from './addons.js';
import {parseOpenAipKey} from './airport-enrichment.js';
import {createOpenAipKeyStore} from './openaip-key.js';

const development = process.argv.includes('--dev');
const rendererUrl = development
  ? 'http://127.0.0.1:5173/'
  : new URL('./renderer/index.html', import.meta.url).href;

app
  .whenReady()
  .then(async () => {
    const database = await openDatabase(
      join(app.getPath('userData'), 'flightsim.sqlite')
    );
    const library = createAddonLibrary(database);
    const keyStore = createOpenAipKeyStore(
      join(app.getPath('userData'), 'openaip-key.enc'),
      {
        available: () =>
          safeStorage.isEncryptionAvailable() &&
          (process.platform !== 'linux' ||
            !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())),
        encrypt: key => safeStorage.encryptString(key),
        decrypt: bytes => safeStorage.decryptString(bytes),
      }
    );

    function assertTrustedSender(event: IpcMainInvokeEvent) {
      if (
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url !== rendererUrl
      ) {
        throw new Error('Untrusted IPC sender');
      }
    }

    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    ipcMain.handle(runtimeHealthChannel, async (event): Promise<RuntimeHealth> => {
      assertTrustedSender(event);
      await database.db.$client.exec('SELECT 1');
      return {status: 'ready', database: 'connected'};
    });
    ipcMain.handle(addonLibraryChannel, event => {
      assertTrustedSender(event);
      return library.getLibrary();
    });
    ipcMain.handle(
      saveCommunityPathChannel,
      (event, simulator: unknown, path: unknown) => {
        assertTrustedSender(event);
        return library.saveCommunityPath(
          parseSimulator(simulator),
          parseCommunityPath(path)
        );
      }
    );
    ipcMain.handle(scanAddonsChannel, (event, simulator: unknown) => {
      assertTrustedSender(event);
      return library.scan(parseSimulator(simulator));
    });
    ipcMain.handle(openAipKeyStatusChannel, event => {
      assertTrustedSender(event);
      return keyStore.status();
    });
    ipcMain.handle(saveOpenAipKeyChannel, (event, key: unknown) => {
      assertTrustedSender(event);
      return keyStore.save(key);
    });
    ipcMain.handle(removeOpenAipKeyChannel, event => {
      assertTrustedSender(event);
      return keyStore.remove();
    });
    ipcMain.handle(
      enrichAirportsChannel,
      async (event, simulator: unknown, apiKey: unknown) => {
        assertTrustedSender(event);
        const parsedSimulator = parseSimulator(simulator);
        const key =
          apiKey === undefined ? await keyStore.load() : parseOpenAipKey(apiKey);
        return library.enrichAirports(parsedSimulator, key);
      }
    );

    function createWindow() {
      const window = new BrowserWindow({
        width: 1000,
        height: 720,
        webPreferences: {
          preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
      window.webContents.on('will-navigate', event => event.preventDefault());
      window.loadURL(rendererUrl).catch(error => {
        console.error(error);
        app.exit(1);
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
    app.on('will-quit', () => database.close());
    createWindow();
  })
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
