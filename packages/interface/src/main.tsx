import {Button} from '@base-ui/react/button';
import {Collapsible} from '@base-ui/react/collapsible';
import {Field} from '@base-ui/react/field';
import {Form} from '@base-ui/react/form';
import {NavigationMenu} from '@base-ui/react/navigation-menu';
import {Tooltip} from '@base-ui/react/tooltip';
import * as stylex from '@stylexjs/stylex';
import {StrictMode, createContext, useContext, useState} from 'react';
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
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {desktopQueries} from './queries';

import type {
  EnrichmentSummary,
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
  apiKey,
  canUseSavedKey,
}: {
  inventory: SimulatorInventory;
  apiKey: string;
  canUseSavedKey: boolean;
}) {
  const [path, setPath] = useState(inventory.communityPath ?? '');
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (action: 'saving' | 'scanning' | 'enriching') => {
      const desktop = window.desktop!;
      if (action === 'saving') {
        const updated = await desktop.saveCommunityPath(inventory.simulator, path);
        return {inventory: updated, activity: {kind: 'saved'} satisfies Activity};
      }
      if (action === 'scanning') {
        const result = await desktop.scanAddons(inventory.simulator);
        return {
          inventory: result.inventory,
          activity: {kind: 'scanned', warnings: result.warnings} satisfies Activity,
        };
      }
      const result = await desktop.enrichAirports(
        inventory.simulator,
        apiKey.trim() ? apiKey : undefined
      );
      return {
        inventory: result.inventory,
        activity: {kind: 'enriched', summary: result.summary} satisfies Activity,
      };
    },
    onSuccess: async result => {
      await queryClient.cancelQueries({queryKey: desktopQueries.library.queryKey});
      queryClient.setQueryData(
        desktopQueries.library.queryKey,
        (current: SimulatorInventory[] | undefined) =>
          current?.map(item =>
            item.simulator === result.inventory.simulator ? result.inventory : item
          )
      );
    },
  });
  const busy = mutation.isPending;
  const activity: Activity = mutation.isPending
    ? {kind: mutation.variables}
    : mutation.isError
      ? {kind: 'error', message: mutation.error.message}
      : (mutation.data?.activity ?? {kind: 'idle'});
  const dirty = path !== (inventory.communityPath ?? '');
  const label = inventory.simulator === 'msfs2020' ? 'MSFS 2020' : 'MSFS 2024';

  return (
    <section aria-label={label} {...stylex.props(styles.section)}>
      <h2 {...stylex.props(styles.subheading)}>{label}</h2>
      <Form
        onSubmit={event => {
          event.preventDefault();
          mutation.mutate('saving');
        }}
      >
        <Field.Root disabled={busy}>
          <Field.Label htmlFor={`${inventory.simulator}-path`}>
            Community folder
          </Field.Label>
          <div {...stylex.props(styles.controls)}>
            <Field.Control
              id={`${inventory.simulator}-path`}
              type="text"
              value={path}
              onChange={event => {
                setPath(event.target.value);
                mutation.reset();
              }}
              disabled={busy}
              placeholder="Enter the full Community folder path"
              {...stylex.props(styles.input)}
            />
            <Button
              type="submit"
              disabled={busy || !path.trim()}
              {...stylex.props(styles.button)}
            >
              {activity.kind === 'saving' ? 'Saving…' : 'Save path'}
            </Button>
            <Button
              type="button"
              onClick={() => mutation.mutate('scanning')}
              disabled={busy || dirty || !inventory.communityPath}
              {...stylex.props(styles.button)}
            >
              {activity.kind === 'scanning' ? 'Scanning…' : 'Scan addons'}
            </Button>
          </div>
        </Field.Root>
      </Form>
      <Form
        onSubmit={event => {
          event.preventDefault();
          mutation.mutate('enriching');
        }}
      >
        <div {...stylex.props(styles.controls)}>
          <Button
            type="submit"
            disabled={
              busy ||
              (!apiKey.trim() && !canUseSavedKey) ||
              inventory.airports.length === 0
            }
            {...stylex.props(styles.button)}
          >
            {activity.kind === 'enriching' ? 'Enriching…' : 'Enrich airports'}
          </Button>
        </div>
      </Form>
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
          <Collapsible.Root>
            <Collapsible.Trigger {...stylex.props(styles.button)}>
              Skipped folders
            </Collapsible.Trigger>
            <Collapsible.Panel>
              <ul>
                {activity.warnings.map(warning => (
                  <li key={warning.folderName}>
                    {warning.folderName}: {warning.message}
                  </li>
                ))}
              </ul>
            </Collapsible.Panel>
          </Collapsible.Root>
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
  const queryClient = useQueryClient();
  const health = useQuery(desktopQueries.health);
  const inventories = useQuery(desktopQueries.library);
  const savedKey = useQuery(desktopQueries.keyStatus);
  const keyMutation = useMutation({
    gcTime: 0,
    mutationFn: (action: 'save' | 'remove') =>
      action === 'save'
        ? window.desktop!.saveOpenAipKey(apiKey)
        : window.desktop!.removeOpenAipKey(),
    onSuccess: async value => {
      await queryClient.cancelQueries({queryKey: desktopQueries.keyStatus.queryKey});
      queryClient.setQueryData(desktopQueries.keyStatus.queryKey, value);
      setApiKey('');
    },
  });
  const keyStatus = savedKey.data;
  const keyBusy = keyMutation.isPending;
  const keyActivity: KeyActivity = keyMutation.isPending
    ? {kind: keyMutation.variables === 'save' ? 'saving' : 'removing'}
    : keyMutation.isError
      ? {kind: 'error', message: keyMutation.error.message}
      : keyMutation.isSuccess
        ? {kind: keyMutation.variables === 'save' ? 'saved' : 'removed'}
        : savedKey.isError
          ? {kind: 'error', message: 'Could not read the saved API key status.'}
          : {kind: 'idle'};
  const status = !window.desktop
    ? 'Open the desktop app to connect.'
    : health.isError || inventories.isError
      ? 'Desktop connection failed. Restart the app to try again.'
      : health.data && inventories.data
        ? `Runtime ${health.data.status}. Database ${health.data.database}.`
        : 'Connecting to desktop…';
  const library = inventories.data ?? [];

  return {
    apiKey,
    setApiKey,
    keyStatus,
    keyActivity,
    resetKeyActivity: keyMutation.reset,
    keyBusy,
    updateKey: keyMutation.mutate,
    status,
    library,
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
        <NavigationMenu.Root aria-label="Main navigation">
          <NavigationMenu.List {...stylex.props(styles.controls, styles.navigationList)}>
            <NavigationMenu.Item>
              <NavigationMenu.Link render={<Link to="/" activeOptions={{exact: true}} />}>
                Home
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link render={<Link to="/scenery" />}>
                Scenery
              </NavigationMenu.Link>
            </NavigationMenu.Item>
            <NavigationMenu.Item>
              <NavigationMenu.Link render={<Link to="/settings" />}>
                Settings
              </NavigationMenu.Link>
            </NavigationMenu.Item>
          </NavigationMenu.List>
        </NavigationMenu.Root>
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
    resetKeyActivity,
    keyBusy,
    updateKey,
    library,
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
        <Form
          onSubmit={event => {
            event.preventDefault();
            void updateKey('save');
          }}
        >
          <Field.Root disabled={keyBusy}>
            <Field.Label htmlFor="openaip-key">OpenAIP API key</Field.Label>
            <div {...stylex.props(styles.controls)}>
              <Field.Control
                id="openaip-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={event => {
                  setApiKey(event.target.value);
                  resetKeyActivity();
                }}
                disabled={keyBusy}
                {...stylex.props(styles.input)}
              />
              <Button
                type="submit"
                disabled={keyBusy || !keyStatus?.available || !apiKey.trim()}
                {...stylex.props(styles.button)}
              >
                {keyActivity.kind === 'saving' ? 'Saving…' : 'Save API key'}
              </Button>
              <Button
                type="button"
                onClick={() => void updateKey('remove')}
                disabled={keyBusy || !keyStatus?.saved}
                {...stylex.props(styles.button)}
              >
                {keyActivity.kind === 'removing' ? 'Removing…' : 'Remove saved key'}
              </Button>
            </div>
          </Field.Root>
        </Form>
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
                        <td {...stylex.props(styles.cell, styles.folder)}>
                          <Tooltip.Root>
                            <Tooltip.Trigger
                              render={<span />}
                              tabIndex={0}
                              aria-describedby={`${inventory.simulator}-${encodeURIComponent(addon.folderName)}-path`}
                            >
                              {addon.folderName}
                            </Tooltip.Trigger>
                            <Tooltip.Portal>
                              <Tooltip.Positioner sideOffset={8}>
                                <Tooltip.Popup
                                  id={`${inventory.simulator}-${encodeURIComponent(addon.folderName)}-path`}
                                  role="tooltip"
                                  {...stylex.props(styles.tooltip)}
                                >
                                  {addon.folderPath}
                                </Tooltip.Popup>
                              </Tooltip.Positioner>
                            </Tooltip.Portal>
                          </Tooltip.Root>
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
  navigationList: {listStyle: 'none', padding: 0, marginBottom: 0},
  tooltip: {
    padding: 8,
    backgroundColor: '#242424',
    color: '#fff',
    borderRadius: 4,
    maxWidth: 400,
    overflowWrap: 'anywhere',
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

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {staleTime: Infinity, retry: false, networkMode: 'always'},
    mutations: {retry: false, networkMode: 'always'},
  },
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing root element');
}
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider>
        <RouterProvider router={router} />
      </Tooltip.Provider>
    </QueryClientProvider>
  </StrictMode>
);
