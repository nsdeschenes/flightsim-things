import {test, expect} from '@playwright/test';

test('desktop queries cache reads and publish mutations across routes while offline', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const library = ['msfs2020', 'msfs2024'].map(simulator => ({
      simulator,
      communityPath: null as string | null,
      scannedPath: null,
      scannedAt: null,
      addons: [],
      airports: [],
    }));
    const calls = {health: 0, library: 0, key: 0, saves: 0};
    Object.assign(window, {
      calls,
      desktop: {
        getRuntimeHealth: async () => {
          calls.health++;
          return {status: 'ready', database: 'connected'};
        },
        getAddonLibrary: async () => {
          calls.library++;
          return structuredClone(library);
        },
        getOpenAipKeyStatus: async () => {
          calls.key++;
          return {saved: false, available: true};
        },
        saveCommunityPath: async (simulator: string, path: string) => {
          calls.saves++;
          if (path === 'bad') {
            throw new Error('Folder unavailable');
          }
          const inventory = library.find(item => item.simulator === simulator)!;
          inventory.communityPath = path;
          return structuredClone(inventory);
        },
        scanAddons: async (simulator: string) => ({
          inventory: {
            ...library.find(item => item.simulator === simulator),
            addons: [
              {
                folderName: 'sample',
                folderPath: '/Community/sample',
                name: 'Cached airport',
                contentType: 'SCENERY',
              },
            ],
          },
          warnings: [{folderName: 'broken-addon', message: 'Invalid manifest'}],
        }),
        saveOpenAipKey: async () => ({saved: true, available: true}),
        removeOpenAipKey: async () => ({saved: false, available: true}),
      },
    });
  });
  await page.goto('http://127.0.0.1:5173');
  await expect(page.getByRole('status')).toHaveText('Runtime ready. Database connected.');
  await page.getByRole('link', {name: 'Settings', exact: true}).click();
  await context.setOffline(true);
  const simulator = page.getByRole('region', {name: 'MSFS 2020', exact: true});
  await simulator.getByRole('textbox').fill('bad');
  await simulator.getByRole('button', {name: 'Save path'}).click();
  await expect(simulator.getByRole('alert')).toHaveText('Folder unavailable');
  await simulator.getByRole('textbox').fill('/Community');
  await simulator.getByRole('textbox').press('Enter');
  await expect(simulator.getByText('Community folder saved.')).toBeVisible();
  await simulator.getByRole('button', {name: 'Scan addons'}).click();
  await expect(simulator.getByText('Scan complete.', {exact: false})).toBeVisible();
  const disclosure = simulator.getByRole('button', {name: 'Skipped folders'});
  await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
  await disclosure.focus();
  await page.keyboard.press('Enter');
  await expect(simulator.getByText('broken-addon: Invalid manifest')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(simulator.getByText('broken-addon: Invalid manifest')).toBeHidden();
  await page.getByRole('link', {name: 'Scenery', exact: true}).click();
  await expect(page.getByRole('link', {name: 'Scenery', exact: true})).toHaveAttribute(
    'aria-current',
    'page'
  );
  await page.keyboard.press('Tab');
  await page.getByText('sample', {exact: true}).focus();
  await expect(page.getByRole('tooltip')).toHaveText('/Community/sample');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(
    page.getByRole('cell', {name: 'Cached airport', exact: true})
  ).toBeVisible();
  await page.getByRole('link', {name: 'Settings', exact: true}).click();
  await expect(simulator.getByRole('textbox')).toHaveValue('/Community');
  await page.getByLabel('OpenAIP API key', {exact: true}).fill('session-secret');
  await page.getByRole('button', {name: 'Save API key', exact: true}).click();
  await expect(page.getByText('An API key is saved for both simulators.')).toBeVisible();
  await expect(page.getByLabel('OpenAIP API key', {exact: true})).toHaveValue('');
  await page.getByRole('button', {name: 'Remove saved key'}).click();
  await expect(page.getByText('No API key is saved.')).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as {calls: unknown}).calls)
  ).toEqual({health: 1, library: 1, key: 1, saves: 2});
});

test('browser without the desktop bridge shows connection guidance', async ({page}) => {
  await page.goto('http://127.0.0.1:5173');
  await expect(page.getByRole('status')).toHaveText('Open the desktop app to connect.');
  await page.getByRole('link', {name: 'Settings', exact: true}).click();
  await expect(
    page.getByRole('button', {name: 'Save API key', exact: true})
  ).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Save path'})).toHaveCount(0);
});

test('path forms validate on submit and keep simulator drafts and pending actions isolated', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const library = ['msfs2020', 'msfs2024'].map(simulator => ({
      simulator,
      communityPath: '/Original',
      scannedPath: null,
      scannedAt: null,
      addons: [],
      airports: [],
    }));
    Object.assign(window, {
      desktop: {
        getRuntimeHealth: async () => ({status: 'ready', database: 'connected'}),
        getAddonLibrary: async () => library,
        getOpenAipKeyStatus: async () => ({saved: false, available: true}),
        saveCommunityPath: async (simulator: string, communityPath: string) => {
          await new Promise<void>(resolve =>
            Object.assign(window, {finishSave: resolve})
          );
          return {...library.find(item => item.simulator === simulator), communityPath};
        },
      },
    });
  });
  await page.goto('http://127.0.0.1:5173/#/settings');
  const first = page.getByRole('region', {name: 'MSFS 2020', exact: true});
  const second = page.getByRole('region', {name: 'MSFS 2024', exact: true});
  const path = first.getByLabel('Community folder');
  await path.fill('   ');
  await path.blur();
  await expect(path).not.toHaveAttribute('aria-invalid', 'true');
  await expect(first.getByRole('button', {name: 'Save path'})).toBeDisabled();
  await expect(first.getByRole('button', {name: 'Scan addons'})).toBeDisabled();
  await path.evaluate(input => input.closest('form')!.requestSubmit());
  await expect(path).toHaveAttribute('aria-invalid', 'true');
  await expect(first.getByText('Enter a Community folder path.')).toBeVisible();
  await path.fill('/New');
  await expect(path).not.toHaveAttribute('aria-invalid', 'true');
  await expect(first.getByText('Enter a Community folder path.')).toBeHidden();
  await second.getByLabel('Community folder').fill('/Other');
  await path.press('Enter');
  await expect(first.getByRole('button', {name: 'Saving…'})).toBeDisabled();
  await expect(path).toBeDisabled();
  await expect(second.getByLabel('Community folder')).toBeEnabled();
  await page.evaluate(() => (window as unknown as {finishSave: () => void}).finishSave());
  await expect(first.getByText('Community folder saved.')).toBeVisible();
  await expect(first.getByRole('button', {name: 'Scan addons'})).toBeEnabled();
  await expect(second.getByLabel('Community folder')).toHaveValue('/Other');
  await expect(second.getByRole('button', {name: 'Scan addons'})).toBeDisabled();
});

test('session key survives navigation, enrichment and failed key mutations, then clears on success', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const library = ['msfs2020', 'msfs2024'].map(simulator => ({
      simulator,
      communityPath: '/Community',
      scannedPath: null,
      scannedAt: null,
      addons: [],
      airports: [{folderName: 'airport', sourceKey: 'airport', icaoCode: 'CYUL'}],
    }));
    let saveAttempts = 0;
    let removeAttempts = 0;
    const enrichments: {simulator: string; key?: string}[] = [];
    Object.assign(window, {
      enrichments,
      desktop: {
        getRuntimeHealth: async () => ({status: 'ready', database: 'connected'}),
        getAddonLibrary: async () => library,
        getOpenAipKeyStatus: async () => ({saved: false, available: true}),
        enrichAirports: async (simulator: string, key?: string) => {
          enrichments.push({simulator, key});
          if (enrichments.length === 1) {
            throw new Error('Enrichment unavailable');
          }
          return {
            inventory: library.find(item => item.simulator === simulator),
            summary: {enriched: 1, unmatched: 0, ambiguous: 0, skipped: 0},
          };
        },
        saveOpenAipKey: async () => {
          saveAttempts++;
          await new Promise<void>(resolve => Object.assign(window, {finishKey: resolve}));
          if (saveAttempts === 1) {
            throw new Error('Key storage failed');
          }
          return {saved: true, available: true};
        },
        removeOpenAipKey: async () => {
          removeAttempts++;
          if (removeAttempts === 1) {
            throw new Error('Key removal failed');
          }
          return {saved: false, available: true};
        },
      },
    });
  });
  await page.goto('http://127.0.0.1:5173/#/settings');
  const key = page.getByLabel('OpenAIP API key', {exact: true});
  const first = page.getByRole('region', {name: 'MSFS 2020', exact: true});
  const second = page.getByRole('region', {name: 'MSFS 2024', exact: true});
  await expect(first.getByRole('button', {name: 'Enrich airports'})).toBeDisabled();
  await key.fill('  ');
  await key.evaluate(input => input.closest('form')!.requestSubmit());
  await expect(key).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('Enter an OpenAIP API key.')).toBeVisible();
  await key.fill(' session-secret ');
  await expect(page.getByText('Enter an OpenAIP API key.')).toBeHidden();
  await page.getByRole('link', {name: 'Scenery', exact: true}).click();
  await page.getByRole('link', {name: 'Settings', exact: true}).click();
  await expect(key).toHaveValue(' session-secret ');
  await first.getByRole('button', {name: 'Enrich airports'}).click();
  await expect(first.getByRole('alert')).toHaveText('Enrichment unavailable');
  await expect(key).toHaveValue(' session-secret ');
  await second.getByRole('button', {name: 'Enrich airports'}).click();
  await expect(second.getByText('Updated 1 airports.', {exact: false})).toBeVisible();
  await expect(key).toHaveValue(' session-secret ');
  await key.press('Enter');
  await expect(key).toBeDisabled();
  await expect(page.getByRole('button', {name: 'Saving…', exact: true})).toBeDisabled();
  await page.evaluate(() => (window as unknown as {finishKey: () => void}).finishKey());
  await expect(
    page.getByRole('alert').filter({hasText: 'Key storage failed'})
  ).toBeVisible();
  await expect(key).toHaveValue(' session-secret ');
  await key.fill('replacement-secret');
  await expect(page.getByText('Key storage failed')).toBeHidden();
  await key.press('Enter');
  await expect(key).toBeDisabled();
  await page.evaluate(() => (window as unknown as {finishKey: () => void}).finishKey());
  await expect(page.getByText('API key saved.', {exact: true})).toBeVisible();
  await expect(key).toHaveValue('');
  await first.getByRole('button', {name: 'Enrich airports'}).click();
  await expect(first.getByText('Updated 1 airports.', {exact: false})).toBeVisible();
  await key.fill('unsaved-secret');
  await page.getByRole('button', {name: 'Remove saved key'}).click();
  await expect(page.getByText('Key removal failed')).toBeVisible();
  await expect(key).toHaveValue('unsaved-secret');
  await page.getByRole('button', {name: 'Remove saved key'}).click();
  await expect(page.getByText('Saved API key removed.')).toBeVisible();
  await expect(key).toHaveValue('');
  await expect(first.getByRole('button', {name: 'Enrich airports'})).toBeDisabled();
  expect(
    await page.evaluate(() => (window as unknown as {enrichments: unknown}).enrichments)
  ).toEqual([
    {simulator: 'msfs2020', key: ' session-secret '},
    {simulator: 'msfs2024', key: ' session-secret '},
    {simulator: 'msfs2020', key: undefined},
  ]);
});

test('unavailable secure storage blocks saving while keeping session input', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let saves = 0;
    const library = [
      {
        simulator: 'msfs2020',
        communityPath: '/Community',
        scannedPath: null,
        scannedAt: null,
        addons: [],
        airports: [],
      },
    ];
    Object.assign(window, {
      getSaveCalls: () => saves,
      desktop: {
        getRuntimeHealth: async () => ({status: 'ready', database: 'connected'}),
        getAddonLibrary: async () => library,
        getOpenAipKeyStatus: async () => ({saved: true, available: false}),
        saveOpenAipKey: async () => {
          saves++;
        },
      },
    });
  });
  await page.goto('http://127.0.0.1:5173/#/settings');
  const key = page.getByLabel('OpenAIP API key', {exact: true});
  await expect(
    page.getByText('Secure storage is unavailable.', {exact: false})
  ).toBeVisible();
  await key.fill('session-secret');
  await expect(
    page.getByRole('button', {name: 'Save API key', exact: true})
  ).toBeDisabled();
  await key.evaluate(input => input.closest('form')!.requestSubmit());
  await expect(key).toHaveValue('session-secret');
  await expect(page.getByRole('button', {name: 'Enrich airports'})).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as unknown as {getSaveCalls: () => number}).getSaveCalls()
    )
  ).toBe(0);
});
