import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {app, BrowserWindow, ipcMain, session} from 'electron';

import {runtimeHealthChannel} from '@flightsim-things/contract';
import type {RuntimeHealth} from '@flightsim-things/contract';
import {openDatabase} from '@flightsim-things/db';

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

    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    ipcMain.handle(runtimeHealthChannel, async (event): Promise<RuntimeHealth> => {
      if (
        event.senderFrame !== event.sender.mainFrame ||
        event.senderFrame?.url !== rendererUrl
      ) {
        throw new Error('Untrusted IPC sender');
      }
      await database.db.$client.exec('SELECT 1');
      return {status: 'ready', database: 'connected'};
    });

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
