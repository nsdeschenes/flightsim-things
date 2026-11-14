import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {test, expect, _electron as electron} from '@playwright/test';

test('desktop scans and persists simulator inventories through the isolated preload', async () => {
  const testInfo = test.info();
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-desktop-'));
  try {
    const community2020 = join(directory, 'Community 2020');
    const community2024 = join(directory, 'Community 2024');
    for (const [community, title] of [
      [community2020, 'Desktop Aircraft'],
      [community2024, 'Desktop Airport'],
    ]) {
      await mkdir(join(community, 'sample-addon'), {recursive: true});
      await writeFile(
        join(community, 'sample-addon', 'manifest.json'),
        JSON.stringify({title, creator: 'Desktop Test', package_version: '2.0.0'})
      );
    }
    await mkdir(join(community2020, 'broken-addon'));
    await writeFile(join(community2020, 'broken-addon', 'manifest.json'), '{');
    const launch = () =>
      electron.launch({
        executablePath: createRequire(resolve('packages/electron/package.json'))(
          'electron'
        ),
        args: [
          resolve('packages/electron'),
          ...(testInfo.project.name === 'development' ? ['--dev'] : []),
          `--user-data-dir=${directory}`,
          ...(process.env.SMOKE_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
        ],
      });
    let app = await launch();
    try {
      const page = await app.firstWindow();
      await expect(page.getByRole('heading', {name: 'Flightsim Things'})).toBeVisible();
      await expect(page.getByRole('status')).toHaveText(
        'Runtime ready. Database connected.'
      );
      expect(
        await page.evaluate(() => ({
          require: typeof Reflect.get(window, 'require'),
          process: typeof Reflect.get(window, 'process'),
          methods: Object.keys(window.desktop ?? {}),
        }))
      ).toEqual({
        require: 'undefined',
        process: 'undefined',
        methods: [
          'getRuntimeHealth',
          'getAddonLibrary',
          'saveCommunityPath',
          'scanAddons',
        ],
      });
      expect(
        await page
          .getByRole('heading', {name: 'Flightsim Things'})
          .evaluate(element => getComputedStyle(element).fontSize)
      ).toBe('32px');
      await page.evaluate(() => window.open('https://example.com'));
      expect(
        await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)
      ).toBe(1);

      const msfs2020 = page.getByRole('region', {name: 'MSFS 2020', exact: true});
      const msfs2024 = page.getByRole('region', {name: 'MSFS 2024', exact: true});
      await msfs2020.getByLabel('Community folder').fill(community2020);
      await msfs2020.getByRole('button', {name: 'Save path'}).click();
      await expect(msfs2020.getByText('Community folder saved.')).toBeVisible();
      await msfs2020.getByRole('button', {name: 'Scan addons'}).click();
      await expect(
        msfs2020.getByRole('cell', {name: 'Desktop Aircraft', exact: true})
      ).toBeVisible();
      await expect(
        msfs2020.getByRole('cell', {name: 'sample-addon', exact: true})
      ).toBeVisible();
      await expect(
        msfs2020.getByText('Scan complete. Found 1 addons. Skipped 1 folders.')
      ).toBeVisible();
      await msfs2020.getByText('Skipped folders', {exact: true}).click();
      await expect(msfs2020.getByRole('listitem')).toContainText('broken-addon');
      await msfs2024.getByLabel('Community folder').fill(community2024);
      await msfs2024.getByRole('button', {name: 'Save path'}).click();
      await msfs2024.getByRole('button', {name: 'Scan addons'}).click();
      await expect(
        msfs2024.getByRole('cell', {name: 'Desktop Airport', exact: true})
      ).toBeVisible();
      await msfs2020.getByRole('button', {name: 'Scan addons'}).click();
      await expect(msfs2020.getByRole('row')).toHaveCount(2);
      await msfs2020.getByLabel('Community folder').fill(join(directory, 'missing'));
      await msfs2020.getByRole('button', {name: 'Save path'}).click();
      await msfs2020.getByRole('button', {name: 'Scan addons'}).click();
      await expect(msfs2020.getByRole('alert')).toContainText(
        'Could not read Community folder'
      );
      await expect(
        msfs2020.getByRole('cell', {name: 'Desktop Aircraft', exact: true})
      ).toBeVisible();
      expect(
        await page.evaluate(async () => {
          const library = await window.desktop!.getAddonLibrary();
          return library.map(inventory =>
            inventory.addons.map(addon => ({
              name: addon.name,
              version: addon.version,
              creator: addon.creator,
            }))
          );
        })
      ).toEqual([
        [{name: 'Desktop Aircraft', version: '2.0.0', creator: 'Desktop Test'}],
        [{name: 'Desktop Airport', version: '2.0.0', creator: 'Desktop Test'}],
      ]);

      await app.close();
      app = await launch();
      const reopened = await app.firstWindow();
      await expect(
        reopened
          .getByRole('region', {name: 'MSFS 2020', exact: true})
          .getByLabel('Community folder')
      ).toHaveValue(join(directory, 'missing'));
      await expect(
        reopened.getByRole('cell', {name: 'Desktop Aircraft', exact: true})
      ).toBeVisible();
      await expect(
        reopened
          .getByRole('region', {name: 'MSFS 2024', exact: true})
          .getByLabel('Community folder')
      ).toHaveValue(community2024);
      await expect(
        reopened.getByRole('cell', {name: 'Desktop Airport', exact: true})
      ).toBeVisible();
    } finally {
      await app.close();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
