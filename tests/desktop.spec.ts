import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {test, expect, _electron as electron, type Page} from '@playwright/test';

async function expectInventoryCell(
  page: Page,
  name: string,
  route: 'Home' | 'Scenery' = 'Home'
) {
  await page.getByRole('link', {name: route, exact: true}).click();
  await expect(page.getByRole('cell', {name, exact: true}).first()).toBeVisible();
  await page.getByRole('link', {name: 'Settings', exact: true}).click();
}

test('desktop scans and persists simulator inventories through the isolated preload', async () => {
  test.setTimeout(60_000);
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
    await mkdir(join(community2024, 'sample-addon', 'scenery'), {recursive: true});
    await writeFile(
      join(community2024, 'sample-addon', 'layout.json'),
      JSON.stringify({content: [{path: 'scenery/airport.xml'}]})
    );
    await writeFile(
      join(community2024, 'sample-addon', 'scenery/airport.xml'),
      '<FSData><Airport ident="KAAA" name="Scanned airport" /></FSData>'
    );
    await writeFile(
      join(community2024, 'sample-addon', 'manifest.json'),
      JSON.stringify({
        title: 'Desktop Airport',
        content_type: 'SCENERY',
        creator: 'Desktop Test',
        package_version: '2.0.0',
      })
    );
    for (const [folder, title, contentType] of [
      ['zulu-scenery', 'Zulu scenery', 'SCENERY'],
      ['alpha-scenery', 'Alpha scenery', 'SCENERY'],
    ]) {
      await mkdir(join(community2024, folder));
      await writeFile(
        join(community2024, folder, 'manifest.json'),
        JSON.stringify({title, content_type: contentType})
      );
    }
    await mkdir(join(community2020, 'broken-addon'));
    await writeFile(join(community2020, 'broken-addon', 'manifest.json'), '{');
    const launch = async () => {
      const launched = await electron.launch({
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
      await launched.evaluate(async ({safeStorage}) => {
        const {createCipheriv, createDecipheriv, randomBytes} =
          process.getBuiltinModule('node:crypto');
        const testKey = Buffer.alloc(32, 7);
        safeStorage.isEncryptionAvailable = () => true;
        safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret';
        safeStorage.encryptString = value => {
          const iv = randomBytes(12);
          const cipher = createCipheriv('aes-256-gcm', testKey, iv);
          const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
          return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
        };
        safeStorage.decryptString = value => {
          const decipher = createDecipheriv(
            'aes-256-gcm',
            testKey,
            value.subarray(0, 12)
          );
          decipher.setAuthTag(value.subarray(12, 28));
          return Buffer.concat([
            decipher.update(value.subarray(28)),
            decipher.final(),
          ]).toString('utf8');
        };
      });
      const window = await launched.firstWindow();
      await expect(window.getByRole('status')).toHaveText(
        'Runtime ready. Database connected.'
      );
      await window.reload();
      return launched;
    };
    let app = await launch();
    try {
      const page = await app.firstWindow();
      const rendererErrors: string[] = [];
      page.on('pageerror', error => rendererErrors.push(error.message));
      page.on('console', message => {
        if (message.text().includes('Refused to')) {
          rendererErrors.push(message.text());
        }
      });
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
          'getOpenAipKeyStatus',
          'saveOpenAipKey',
          'removeOpenAipKey',
          'getRuntimeHealth',
          'getAddonLibrary',
          'saveCommunityPath',
          'scanAddons',
          'enrichAirports',
        ],
      });
      expect(
        await page
          .getByRole('heading', {name: 'Flightsim Things'})
          .evaluate(element => getComputedStyle(element).fontSize)
      ).toBe('16px');
      expect(
        await page.evaluate(async () => {
          const fonts = [
            '400 13px "B612"',
            '700 13px "B612"',
            'italic 400 13px "B612"',
            'italic 700 13px "B612"',
            '400 13px "Share Tech Mono"',
          ];
          return Promise.all(
            fonts.map(async font => {
              const faces = await document.fonts.load(font, 'Airport KAAA 2.0.0');
              return (
                faces.length > 0 &&
                faces.every(face => face.status === 'loaded') &&
                document.fonts.check(font, 'Airport KAAA 2.0.0')
              );
            })
          );
        })
      ).toEqual([true, true, true, true, true]);
      await expect(page.getByRole('heading', {name: 'Flightsim Things'})).toHaveCSS(
        'font-family',
        /^"?B612"?,/
      );
      await page.evaluate(() => window.open('https://example.com'));
      expect(
        await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)
      ).toBe(1);

      await page.getByRole('link', {name: 'Settings', exact: true}).click();
      const msfs2020 = page.getByRole('region', {name: 'MSFS 2020', exact: true});
      const msfs2024 = page.getByRole('region', {name: 'MSFS 2024', exact: true});
      await expect(msfs2020.locator('label', {hasText: 'Community folder'})).toHaveCSS(
        'font-family',
        /^"Share Tech Mono",/
      );
      await expect(msfs2020.getByLabel('Community folder')).toHaveCSS(
        'font-family',
        /^"Share Tech Mono",/
      );
      await msfs2020.getByLabel('Community folder').fill(community2020);
      const savePath = msfs2020.getByRole('button', {name: 'Save path'});
      await expect(savePath).toHaveCSS('background-color', 'rgb(38, 28, 193)');
      await expect(savePath).toHaveCSS('border-top-width', '0px');
      await expect(savePath).toHaveCSS('box-shadow', 'none');
      await msfs2020.getByRole('button', {name: 'Save path'}).click();
      await expect(msfs2020.getByText('Community folder saved.')).toBeVisible();
      await msfs2020.getByRole('button', {name: 'Scan addons'}).click();
      await expect(
        msfs2020.getByText('Scan complete. Found 1 addons. Skipped 1 folders.')
      ).toBeVisible();
      await msfs2020.getByText('Skipped folders', {exact: true}).click();
      await expect(msfs2020.getByRole('listitem')).toContainText('broken-addon');
      await expectInventoryCell(page, 'Desktop Aircraft');
      await expectInventoryCell(page, 'sample-addon');
      await msfs2024.getByLabel('Community folder').fill(community2024);
      await msfs2024.getByRole('button', {name: 'Save path'}).click();
      await msfs2024.getByRole('button', {name: 'Scan addons'}).click();
      await expectInventoryCell(page, 'Desktop Airport', 'Scenery');
      await expectInventoryCell(page, 'KAAA', 'Scenery');
      await page.getByRole('link', {name: 'Scenery', exact: true}).click();
      await expect(page.getByRole('cell', {name: 'KAAA', exact: true})).toHaveCSS(
        'font-family',
        /^"Share Tech Mono",/
      );
      await expect(page.getByRole('columnheader', {name: 'Code', exact: true})).toHaveCSS(
        'font-family',
        /^"Share Tech Mono",/
      );
      await page.getByRole('link', {name: 'Home', exact: true}).click();
      await expect(
        page.getByRole('cell', {name: 'Desktop Airport', exact: true})
      ).toHaveCSS('font-family', /^"?B612"?,/);
      await expect(
        page
          .getByRole('table', {name: 'MSFS 2024 Addons (3)'})
          .locator('tbody tr td:first-child')
      ).toHaveText(['Alpha scenery', 'Desktop Airport', 'Zulu scenery']);
      await page.getByRole('link', {name: 'Scenery', exact: true}).click();
      await expect(
        page.getByRole('cell', {name: 'Desktop Aircraft', exact: true})
      ).toHaveCount(0);
      await expect(
        page
          .getByRole('table', {name: 'MSFS 2024 Scenery (3)'})
          .locator('tbody tr td:first-child')
      ).toHaveText(['Alpha scenery', 'Desktop Airport', 'Zulu scenery']);
      await page.reload();
      await expect(
        page.getByRole('heading', {name: 'Scenery', exact: true})
      ).toBeVisible();
      await page.getByRole('link', {name: 'Settings', exact: true}).click();
      await app.evaluate(() => {
        globalThis.fetch = async () =>
          new Response(
            JSON.stringify({
              items: [
                {
                  _id: 'desktop-airport',
                  icaoCode: 'KAAA',
                  name: 'Enriched airport',
                  geometry: {type: 'Point', coordinates: [-73, 45]},
                  elevation: {value: 25, unit: 0, referenceDatum: 1},
                },
              ],
              page: 1,
              limit: 100,
              totalCount: 1,
              totalPages: 1,
            }),
            {status: 200}
          );
      });
      await app.evaluate(({safeStorage}) => {
        safeStorage.isEncryptionAvailable = () => false;
      });
      await page.reload();
      await expect(
        page.getByText(
          'Secure storage is unavailable. Enter a key to use while Settings is open.'
        )
      ).toBeVisible();
      await page.getByLabel('OpenAIP API key').fill('desktop-test-key');
      await page.getByRole('link', {name: 'Home', exact: true}).click();
      await page.getByRole('link', {name: 'Settings', exact: true}).click();
      await expect(page.getByLabel('OpenAIP API key')).toHaveValue('');
      await page.getByLabel('OpenAIP API key').fill('desktop-test-key');
      await expect(
        page.getByRole('button', {name: 'Save API key', exact: true})
      ).toBeDisabled();
      await msfs2024.getByRole('button', {name: 'Enrich airports'}).click();
      await expect(
        msfs2024.getByText('Updated 1 airports.', {exact: false})
      ).toBeVisible();
      await app.evaluate(({safeStorage}) => {
        safeStorage.isEncryptionAvailable = () => true;
      });
      await page.reload();
      await page.getByLabel('OpenAIP API key').fill('desktop-test-key');
      await page.getByRole('button', {name: 'Save API key', exact: true}).click();
      await expect(page.getByText('API key saved.', {exact: true})).toBeVisible();
      await expect(page.getByLabel('OpenAIP API key')).toHaveValue('');
      await msfs2024.getByRole('button', {name: 'Enrich airports'}).click();
      await expect(
        msfs2024.getByText('Updated 1 airports.', {exact: false})
      ).toBeVisible();
      await page.getByRole('link', {name: 'Scenery', exact: true}).click();
      const map = page.getByTestId('scenery-map');
      await expect(map.locator('svg').first()).toBeVisible();
      await expect(
        page.getByText(
          '4 installations · 1 mapped · 3 without coordinates · 1 map locations',
          {exact: true}
        )
      ).toBeVisible();
      await page.getByRole('button', {name: 'Enriched airport', exact: true}).click();
      await expect(
        page
          .getByRole('region', {name: 'Installation details'})
          .getByText('45, -73', {exact: true})
      ).toBeVisible();
      await expect(map).toHaveAttribute('data-camera', '0,0,1');
      await page.getByRole('button', {name: 'Focus airport'}).click();
      await expect(map).toHaveAttribute('data-camera', /,6$/);
      await page.getByRole('link', {name: 'Settings', exact: true}).click();
      await msfs2020.getByRole('button', {name: 'Scan addons'}).click();
      await expect(msfs2020.getByText('Scan complete.', {exact: false})).toBeVisible();
      await msfs2020.getByLabel('Community folder').fill(join(directory, 'missing'));
      await msfs2020.getByRole('button', {name: 'Save path'}).click();
      await msfs2020.getByRole('button', {name: 'Scan addons'}).click();
      await expect(msfs2020.getByRole('alert')).toContainText(
        'Could not read Community folder'
      );
      await expectInventoryCell(page, 'Desktop Aircraft');
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
        [
          {name: 'Alpha scenery', version: null, creator: null},
          {name: 'Desktop Airport', version: '2.0.0', creator: 'Desktop Test'},
          {name: 'Zulu scenery', version: null, creator: null},
        ],
      ]);

      expect(rendererErrors).toEqual([]);
      await app.close();
      app = await launch();
      const reopened = await app.firstWindow();
      await reopened.getByRole('link', {name: 'Settings', exact: true}).click();
      await expect(
        reopened
          .getByRole('region', {name: 'MSFS 2020', exact: true})
          .getByLabel('Community folder')
      ).toHaveValue(join(directory, 'missing'));
      await expectInventoryCell(reopened, 'Desktop Aircraft');
      await reopened.getByRole('link', {name: 'Scenery', exact: true}).click();
      await reopened.getByRole('button', {name: 'Enriched airport', exact: true}).click();
      await expect(
        reopened
          .getByRole('region', {name: 'Installation details'})
          .getByText('45, -73', {exact: true})
      ).toBeVisible();
      await expect(
        reopened.getByTestId('scenery-map').locator('svg').first()
      ).toBeVisible();
      await reopened.getByRole('link', {name: 'Settings', exact: true}).click();
      await expect(reopened.getByLabel('OpenAIP API key')).toHaveValue('');
      await expect(
        reopened.getByText('An API key is saved for both simulators.')
      ).toBeVisible();
      await app.evaluate(() => {
        globalThis.fetch = async (_url, init) => {
          if (
            new Headers(init?.headers).get('x-openaip-api-key') !== 'desktop-test-key'
          ) {
            throw new Error('Saved API key was not reused');
          }
          return new Response(
            JSON.stringify({items: [], page: 1, limit: 100, totalCount: 0, totalPages: 0})
          );
        };
      });
      await reopened
        .getByRole('region', {name: 'MSFS 2024', exact: true})
        .getByRole('button', {name: 'Enrich airports'})
        .click();
      await expect(
        reopened.getByText('Updated 0 airports.', {exact: false})
      ).toBeVisible();
      await reopened.getByRole('button', {name: 'Remove saved key'}).click();
      await expect(
        reopened.getByText('Saved API key removed.', {exact: true})
      ).toBeVisible();
      await expect(reopened.getByText('No API key is saved.')).toBeVisible();
      await expect(
        reopened
          .getByRole('region', {name: 'MSFS 2024', exact: true})
          .getByRole('button', {name: 'Enrich airports'})
      ).toBeDisabled();
      await expect(
        reopened
          .getByRole('region', {name: 'MSFS 2024', exact: true})
          .getByLabel('Community folder')
      ).toHaveValue(community2024);
      await expectInventoryCell(reopened, 'Desktop Airport', 'Scenery');
    } finally {
      await app.close();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
