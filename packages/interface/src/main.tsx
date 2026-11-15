import * as stylex from '@stylexjs/stylex';
import {StrictMode, createContext, useContext, useEffect, useState} from 'react';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {createRoot} from 'react-dom/client';

import type {
  EnrichmentSummary,
  OpenAipKeyStatus,
  ScanWarning,
  SimulatorInventory,
} from '@flightsim-things/contract';

import './reset.css';

type Activity =
  | {kind: 'idle'}
  | {kind: 'saving' | 'scanning' | 'enriching'}
  | {kind: 'saved'}
  | {kind: 'scanned'; warnings: ScanWarning[]}
  | {kind: 'enriched'; summary: EnrichmentSummary}
  | {kind: 'error'; message: string};

function SimulatorSettings({
  inventory,
  onChange,
  apiKey,
  canUseSavedKey,
}: {
  inventory: SimulatorInventory;
  onChange: (inventory: SimulatorInventory) => void;
  apiKey: string;
  canUseSavedKey: boolean;
}) {
  const [path, setPath] = useState(inventory.communityPath ?? '');
  const [activity, setActivity] = useState<Activity>({kind: 'idle'});
  const busy =
    activity.kind === 'saving' ||
    activity.kind === 'scanning' ||
    activity.kind === 'enriching';
  const dirty = path !== (inventory.communityPath ?? '');
  const label = inventory.simulator === 'msfs2020' ? 'MSFS 2020' : 'MSFS 2024';

  async function save() {
    setActivity({kind: 'saving'});
    try {
      const saved = await window.desktop!.saveCommunityPath(inventory.simulator, path);
      onChange(saved);
      setActivity({kind: 'saved'});
    } catch (error) {
      setActivity({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Could not save the Community folder.',
      });
    }
  }

  async function scan() {
    setActivity({kind: 'scanning'});
    try {
      const result = await window.desktop!.scanAddons(inventory.simulator);
      onChange(result.inventory);
      setActivity({kind: 'scanned', warnings: result.warnings});
    } catch (error) {
      setActivity({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Could not scan the Community folder.',
      });
    }
  }

  async function enrich() {
    setActivity({kind: 'enriching'});
    try {
      const result = await window.desktop!.enrichAirports(
        inventory.simulator,
        apiKey.trim() ? apiKey : undefined
      );
      onChange(result.inventory);
      setActivity({kind: 'enriched', summary: result.summary});
    } catch (error) {
      setActivity({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not enrich airports.',
      });
    }
  }

  return (
    <section aria-label={label} {...stylex.props(styles.section)}>
      <h2 {...stylex.props(styles.subheading)}>{label}</h2>
      <form
        onSubmit={event => {
          event.preventDefault();
          void save();
        }}
      >
        <label htmlFor={`${inventory.simulator}-path`}>Community folder</label>
        <div {...stylex.props(styles.controls)}>
          <input
            id={`${inventory.simulator}-path`}
            type="text"
            value={path}
            onChange={event => {
              setPath(event.target.value);
              setActivity({kind: 'idle'});
            }}
            disabled={busy}
            placeholder="Enter the full Community folder path"
            {...stylex.props(styles.input)}
          />
          <button
            type="submit"
            disabled={busy || !path.trim()}
            {...stylex.props(styles.button)}
          >
            {activity.kind === 'saving' ? 'Saving…' : 'Save path'}
          </button>
          <button
            type="button"
            onClick={() => void scan()}
            disabled={busy || dirty || !inventory.communityPath}
            {...stylex.props(styles.button)}
          >
            {activity.kind === 'scanning' ? 'Scanning…' : 'Scan addons'}
          </button>
        </div>
      </form>
      <form
        onSubmit={event => {
          event.preventDefault();
          void enrich();
        }}
      >
        <div {...stylex.props(styles.controls)}>
          <button
            type="submit"
            disabled={
              busy ||
              (!apiKey.trim() && !canUseSavedKey) ||
              inventory.airports.length === 0
            }
            {...stylex.props(styles.button)}
          >
            {activity.kind === 'enriching' ? 'Enriching…' : 'Enrich airports'}
          </button>
        </div>
      </form>
      <div aria-live="polite" {...stylex.props(styles.feedback)}>
        {dirty && <p>Save the path before scanning.</p>}
        {activity.kind === 'saved' && <p>Community folder saved.</p>}
        {activity.kind === 'scanned' && (
          <p>
            Scan complete. Found {inventory.addons.length} addons. Skipped{' '}
            {activity.warnings.length} folders.
          </p>
        )}
        {activity.kind === 'enriched' && (
          <p>
            Updated {activity.summary.enriched} airports. Unmatched{' '}
            {activity.summary.unmatched}. Ambiguous {activity.summary.ambiguous}. Skipped{' '}
            {activity.summary.skipped}.
          </p>
        )}
        {activity.kind === 'error' && <p role="alert">{activity.message}</p>}
        {activity.kind === 'scanned' && activity.warnings.length > 0 && (
          <details>
            <summary>Skipped folders</summary>
            <ul>
              {activity.warnings.map(warning => (
                <li key={warning.folderName}>
                  {warning.folderName}: {warning.message}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {inventory.scannedAt && (
        <p {...stylex.props(styles.scanInfo)}>
          Last scan {new Date(inventory.scannedAt).toLocaleString()} from{' '}
          {inventory.scannedPath}
        </p>
      )}
    </section>
  );
}

type KeyActivity =
  | {kind: 'idle' | 'saving' | 'removing' | 'saved' | 'removed'}
  | {kind: 'error'; message: string};

function useAppState() {
  const [apiKey, setApiKey] = useState('');
  const [keyStatus, setKeyStatus] = useState<OpenAipKeyStatus | null>(null);
  const [keyActivity, setKeyActivity] = useState<KeyActivity>({kind: 'idle'});
  const keyBusy = keyActivity.kind === 'saving' || keyActivity.kind === 'removing';

  async function updateKey(action: 'save' | 'remove') {
    setKeyActivity({kind: action === 'save' ? 'saving' : 'removing'});
    try {
      const status =
        action === 'save'
          ? await window.desktop!.saveOpenAipKey(apiKey)
          : await window.desktop!.removeOpenAipKey();
      setKeyStatus(status);
      setApiKey('');
      setKeyActivity({kind: action === 'save' ? 'saved' : 'removed'});
    } catch (error) {
      setKeyActivity({
        kind: 'error',
        message:
          error instanceof Error ? error.message : 'Could not update the saved API key.',
      });
    }
  }

  const [status, setStatus] = useState(
    window.desktop ? 'Connecting to desktop…' : 'Open the desktop app to connect.'
  );
  const [library, setLibrary] = useState<SimulatorInventory[]>([]);
  useEffect(() => {
    let active = true;
    const desktop = window.desktop;
    if (!desktop) {
      return;
    }
    desktop.getOpenAipKeyStatus().then(
      value => {
        if (active) {
          setKeyStatus(value);
        }
      },
      () => {
        if (active) {
          setKeyActivity({
            kind: 'error',
            message: 'Could not read the saved API key status.',
          });
        }
      }
    );
    Promise.all([desktop.getRuntimeHealth(), desktop.getAddonLibrary()]).then(
      ([health, inventories]) => {
        if (active) {
          setStatus(`Runtime ${health.status}. Database ${health.database}.`);
          setLibrary(inventories);
        }
      },
      () => {
        if (active) {
          setStatus('Desktop connection failed. Restart the app to try again.');
        }
      }
    );
    return () => {
      active = false;
    };
  }, []);
  function updateInventory(updated: SimulatorInventory) {
    setLibrary(current =>
      current.map(inventory =>
        inventory.simulator === updated.simulator ? updated : inventory
      )
    );
  }

  return {
    apiKey,
    setApiKey,
    keyStatus,
    keyActivity,
    setKeyActivity,
    keyBusy,
    updateKey,
    status,
    library,
    updateInventory,
  };
}

const AppContext = createContext<ReturnType<typeof useAppState> | null>(null);

function useLibrary() {
  const state = useContext(AppContext);
  if (!state) {
    throw new Error('Missing app state');
  }
  return state;
}

function App() {
  const state = useAppState();
  return (
    <AppContext.Provider value={state}>
      <main {...stylex.props(styles.page)}>
        <h1 {...stylex.props(styles.heading)}>Flightsim Things</h1>
        <nav aria-label="Main navigation" {...stylex.props(styles.controls)}>
          <Link to="/" activeOptions={{exact: true}}>
            Home
          </Link>
          <Link to="/scenery">Scenery</Link>
          <Link to="/settings">Settings</Link>
        </nav>
        <p role="status">{state.status}</p>
        <Outlet />
      </main>
    </AppContext.Provider>
  );
}

function Settings() {
  const {
    apiKey,
    setApiKey,
    keyStatus,
    keyActivity,
    setKeyActivity,
    keyBusy,
    updateKey,
    library,
    updateInventory,
  } = useLibrary();
  return (
    <>
      <h2 {...stylex.props(styles.subheading)}>Settings</h2>
      <section aria-label="OpenAIP settings" {...stylex.props(styles.section)}>
        <h2 {...stylex.props(styles.subheading)}>OpenAIP</h2>
        <p>
          {keyStatus?.saved
            ? 'An API key is saved for both simulators.'
            : 'No API key is saved.'}
        </p>
        <form
          onSubmit={event => {
            event.preventDefault();
            void updateKey('save');
          }}
        >
          <label htmlFor="openaip-key">OpenAIP API key</label>
          <div {...stylex.props(styles.controls)}>
            <input
              id="openaip-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={event => {
                setApiKey(event.target.value);
                setKeyActivity({kind: 'idle'});
              }}
              disabled={keyBusy}
              {...stylex.props(styles.input)}
            />
            <button
              type="submit"
              disabled={keyBusy || !keyStatus?.available || !apiKey.trim()}
              {...stylex.props(styles.button)}
            >
              {keyActivity.kind === 'saving' ? 'Saving…' : 'Save API key'}
            </button>
            <button
              type="button"
              onClick={() => void updateKey('remove')}
              disabled={keyBusy || !keyStatus?.saved}
              {...stylex.props(styles.button)}
            >
              {keyActivity.kind === 'removing' ? 'Removing…' : 'Remove saved key'}
            </button>
          </div>
        </form>
        <p>
          Enter a key to use for this session, or save it securely on this device. Leave
          the field empty to use the saved key.
        </p>
        {keyStatus && !keyStatus.available && (
          <p>Secure storage is unavailable. Enter a key to use for this session.</p>
        )}
        <div aria-live="polite">
          {keyActivity.kind === 'saved' && <p>API key saved.</p>}
          {keyActivity.kind === 'removed' && <p>Saved API key removed.</p>}
          {keyActivity.kind === 'error' && <p role="alert">{keyActivity.message}</p>}
        </div>
      </section>
      {library.map(inventory => (
        <SimulatorSettings
          key={inventory.simulator}
          inventory={inventory}
          onChange={updateInventory}
          apiKey={apiKey}
          canUseSavedKey={Boolean(keyStatus?.saved && keyStatus.available)}
        />
      ))}
    </>
  );
}

function AddonTables({scenery = false}: {scenery?: boolean}) {
  const {library} = useLibrary();
  return (
    <>
      <h2 {...stylex.props(styles.subheading)}>{scenery ? 'Scenery' : 'Addons'}</h2>
      {library.map(source => {
        const inventory = {
          ...source,
          addons: source.addons
            .filter(addon => !scenery || addon.contentType?.toUpperCase() === 'SCENERY')
            .toSorted((a, b) => a.name.localeCompare(b.name)),
          airports: source.airports.toSorted((a, b) =>
            (a.name ?? '').localeCompare(b.name ?? '')
          ),
        };
        const label = inventory.simulator === 'msfs2020' ? 'MSFS 2020' : 'MSFS 2024';
        return (
          <section
            key={inventory.simulator}
            aria-label={label}
            {...stylex.props(styles.section)}
          >
            <h3 {...stylex.props(styles.subheading)}>{label}</h3>
            {scenery && inventory.airports.length > 0 && (
              <div {...stylex.props(styles.tableContainer)}>
                <table {...stylex.props(styles.table)}>
                  <caption {...stylex.props(styles.caption)}>
                    {label} Airports ({inventory.airports.length})
                  </caption>
                  <thead>
                    <tr>
                      {[
                        'Code',
                        'Airport name',
                        'Latitude',
                        'Longitude',
                        'Elevation (m)',
                      ].map(label => (
                        <th key={label} scope="col" {...stylex.props(styles.cell)}>
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.airports.map(airport => (
                      <tr key={`${airport.folderName}/${airport.sourceKey}`}>
                        {[
                          airport.icaoCode ?? airport.iataCode,
                          airport.name,
                          airport.latitude,
                          airport.longitude,
                          airport.elevationMeters,
                        ].map((value, index) => (
                          <td key={index} {...stylex.props(styles.cell)}>
                            {value ?? 'Unknown'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {inventory.addons.length > 0 ? (
              <div {...stylex.props(styles.tableContainer)}>
                <table {...stylex.props(styles.table)}>
                  <caption {...stylex.props(styles.caption)}>
                    {label} {scenery ? 'Scenery' : 'Addons'} ({inventory.addons.length})
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" {...stylex.props(styles.cell)}>
                        Addon name
                      </th>
                      <th scope="col" {...stylex.props(styles.cell)}>
                        Folder
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.addons.map(addon => (
                      <tr key={addon.folderName}>
                        <td {...stylex.props(styles.cell)}>{addon.name}</td>
                        <td
                          title={addon.folderPath}
                          {...stylex.props(styles.cell, styles.folder)}
                        >
                          {addon.folderName}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>
                {inventory.scannedAt
                  ? scenery
                    ? 'No scenery found in the last scan.'
                    : 'No addons found in the last scan.'
                  : 'Save your Community folder and scan to list installed addons.'}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

const rootRoute = createRootRoute({component: App});
const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AddonTables,
});
const sceneryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scenery',
  component: () => <AddonTables scenery />,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, sceneryRoute, settingsRoute]),
  history: createHashHistory(),
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const styles = stylex.create({
  page: {
    minHeight: '100vh',
    padding: 48,
    backgroundColor: '#f8f7f4',
    color: '#242424',
    fontFamily: 'system-ui, sans-serif',
  },
  heading: {fontSize: 32, fontWeight: 600, marginBottom: 16},
  subheading: {fontSize: 24, marginTop: 0, marginBottom: 20},
  section: {
    marginTop: 32,
    padding: 24,
    backgroundColor: '#fff',
    borderRadius: 8,
    border: '1px solid #ddd',
  },
  controls: {display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8},
  input: {
    flexGrow: 1,
    minWidth: 200,
    padding: 10,
    font: 'inherit',
    border: '1px solid #aaa',
    borderRadius: 4,
  },
  button: {padding: 10, font: 'inherit', cursor: 'pointer'},
  feedback: {marginTop: 12, marginBottom: 12, overflowWrap: 'anywhere'},
  scanInfo: {fontSize: 13, color: '#555', marginBottom: 12, overflowWrap: 'anywhere'},
  tableContainer: {overflowX: 'auto'},
  table: {width: '100%', borderCollapse: 'collapse', textAlign: 'left'},
  caption: {textAlign: 'left', fontWeight: 600, marginBottom: 8},
  cell: {padding: 12, borderBottom: '1px solid #ddd', overflowWrap: 'anywhere'},
  folder: {fontFamily: 'monospace'},
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing root element');
}
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
