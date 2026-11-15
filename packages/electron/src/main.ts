import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {Deferred, Effect, Fiber} from 'effect';

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
import {validate} from './errors.js';

const development = process.argv.includes('--dev');
const rendererUrl = development
  ? 'http://127.0.0.1:5173/'
  : new URL('./renderer/index.html', import.meta.url).href;

const application = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.promise(() => app.whenReady());
    const scope = yield* Effect.scope;
    let closing = false;
    const run = <A, E>(operation: Effect.Effect<A, E>) =>
      closing
        ? Promise.reject(new Error('Application is closing.'))
        : Effect.runPromise(
            Effect.forkIn(operation, scope).pipe(Effect.flatMap(Fiber.join))
          );
    const database = yield* openDatabase(
      join(app.getPath('userData'), 'flightsim.sqlite')
    );
    const shutdown = yield* Deferred.make<void, unknown>();
    const onQuit = (event: Electron.Event) => {
      event.preventDefault();
      closing = true;
      Effect.runSync(Deferred.succeed(shutdown, undefined));
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => app.on('will-quit', onQuit)),
      () => Effect.sync(() => app.removeListener('will-quit', onQuit))
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
        event.senderFrame?.url.split('#', 1)[0] !== rendererUrl
      ) {
        throw new Error('Untrusted IPC sender');
      }
    }

    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false)
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    ipcMain.handle(runtimeHealthChannel, event => {
      assertTrustedSender(event);
      return run(
        database
          .getLibrary()
          .pipe(
            Effect.as({status: 'ready', database: 'connected'} satisfies RuntimeHealth)
          )
      );
    });
    ipcMain.handle(addonLibraryChannel, event => {
      assertTrustedSender(event);
      return run(library.getLibrary());
    });
    ipcMain.handle(
      saveCommunityPathChannel,
      (event, simulator: unknown, path: unknown) => {
        assertTrustedSender(event);
        return run(
          Effect.gen(function* () {
            const parsedSimulator = yield* validate(() => parseSimulator(simulator));
            const parsedPath = yield* validate(() => parseCommunityPath(path));
            return yield* library.saveCommunityPath(parsedSimulator, parsedPath);
          })
        );
      }
    );
    ipcMain.handle(scanAddonsChannel, (event, simulator: unknown) => {
      assertTrustedSender(event);
      return run(
        validate(() => parseSimulator(simulator)).pipe(
          Effect.flatMap(value => library.scan(value))
        )
      );
    });
    ipcMain.handle(openAipKeyStatusChannel, event => {
      assertTrustedSender(event);
      return run(keyStore.status());
    });
    ipcMain.handle(saveOpenAipKeyChannel, (event, key: unknown) => {
      assertTrustedSender(event);
      return run(keyStore.save(key));
    });
    ipcMain.handle(removeOpenAipKeyChannel, event => {
      assertTrustedSender(event);
      return run(keyStore.remove());
    });
    ipcMain.handle(
      enrichAirportsChannel,
      (event, simulator: unknown, apiKey: unknown) => {
        assertTrustedSender(event);
        return run(
          Effect.gen(function* () {
            const parsedSimulator = yield* validate(() => parseSimulator(simulator));
            const key =
              apiKey === undefined
                ? yield* keyStore.load()
                : yield* validate(() => parseOpenAipKey(apiKey));
            return yield* library.enrichAirports(parsedSimulator, key);
          })
        );
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
      run(Effect.promise(() => window.loadURL(rendererUrl))).catch(error => {
        closing = true;
        Effect.runSync(Deferred.fail(shutdown, error));
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
    createWindow();
    yield* Deferred.await(shutdown);
  })
);

Effect.runPromise(application)
  .then(() => {
    // Electron ignores another quit request until the current quit dispatch returns.
    setImmediate(() => app.quit());
  })
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
