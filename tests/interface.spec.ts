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
