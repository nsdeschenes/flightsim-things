import {test, expect} from '@playwright/test';

test('scenery links filtered installations and map without moving the camera on selection', async ({
  page,
  context,
}) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  await page.addInitScript(() => {
    const airport = (
      sourceKey: string,
      name: string,
      longitude: number | null,
      latitude: number | null
    ) => ({
      folderName: 'airport-package',
      sourceKey,
      name,
      icaoCode: sourceKey,
      iataCode: null,
      longitude,
      latitude,
      elevationMeters: 0,
    });
    const library = ['msfs2020', 'msfs2024'].map(simulator => ({
      simulator,
      communityPath: '/Community',
      scannedPath: '/Community',
      scannedAt: '2026-01-01',
      addons: [
        {
          simulator,
          folderName: 'airport-package',
          folderPath: '/Community/airport-package',
          name: 'Regional scenery',
          contentType: 'SCENERY',
        },
      ],
      airports:
        simulator === 'msfs2020'
          ? [
              airport('ZERO', 'Zero airport', 0, 0),
              airport('NONE', 'Missing airport', null, null),
              airport('BAD', 'Invalid airport', 181, 45),
              airport('PART', 'Partial airport', 12, null),
              airport('NAN', 'Nonfinite airport', Number.NaN, 45),
              airport('INF', 'Infinite airport', 12, Number.POSITIVE_INFINITY),
              airport('LAT', 'Invalid latitude', 12, 91),
            ]
          : [
              airport('ZERO', 'Coincident airport', 0, 0),
              {...airport('ORPHAN', 'Orphan airport', -73, 45), folderName: 'orphan'},
            ],
    }));
    Object.assign(window, {
      desktop: {
        getRuntimeHealth: async () => ({status: 'ready', database: 'connected'}),
        getAddonLibrary: async () => library,
      },
    });
  });
  await page.goto('http://127.0.0.1:5173/#/scenery');
  const map = page.getByTestId('scenery-map');
  await expect(map.locator('svg').first()).toBeVisible();
  await expect(
    page.getByText(
      '11 installations · 3 mapped · 8 without coordinates · 2 map locations',
      {exact: true}
    )
  ).toBeVisible();
  const markers = map.locator('g[data-ts-key="airports"] path');
  await expect(markers).toHaveCount(2);
  await markers.first().click({force: true});
  await expect(
    page
      .getByRole('region', {name: 'Installation details'})
      .getByRole('group', {name: 'Installations at this location'})
  ).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('button', {name: 'Zoom in', exact: true}).click();
  await expect(map).toHaveAttribute('data-camera', /,1.5$/);
  const camera = await map.getAttribute('data-camera');
  const coastline = map.locator('g[data-ts-key="land"] path').first();
  const coastlinePath = await coastline.getAttribute('d');
  await page.getByRole('button', {name: 'Zero airport', exact: true}).click();
  await expect(map).toHaveAttribute('data-camera', camera!);
  await expect(coastline).toHaveAttribute('d', coastlinePath!);
  const details = page.getByRole('region', {name: 'Installation details'});
  await expect(details.getByText('0, 0', {exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Focus airport'})).toBeEnabled();
  await expect(
    details.getByRole('group', {name: 'Installations at this location'})
  ).toBeVisible();
  await details.getByRole('button', {name: /Coincident airport/}).click();
  await expect(details.getByRole('heading', {name: 'Coincident airport'})).toBeVisible();
  await expect(map).toHaveAttribute('data-camera', camera!);
  await page.getByRole('button', {name: 'Focus airport'}).click();
  await expect(map).toHaveAttribute('data-camera', /,6$/);
  await expect(coastline).not.toHaveAttribute('d', coastlinePath!);
  await page.getByRole('button', {name: 'World overview'}).click();
  await expect(map).toHaveAttribute('data-camera', '0,0,1');
  const box = await map.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2 + 20, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(map).not.toHaveAttribute('data-camera', '0,0,1');
  const panned = await map.getAttribute('data-camera');
  await page.mouse.wheel(0, 100);
  await expect(map).toHaveAttribute('data-camera', panned!);
  await page.getByRole('combobox', {name: 'Simulator', exact: true}).click();
  await page.getByRole('option', {name: 'MSFS 2020', exact: true}).click();
  await expect(
    details.getByText(
      'The selected installation is outside this view or no longer installed. Select an installation below.'
    )
  ).toBeVisible();
  await page.getByRole('combobox', {name: 'Location', exact: true}).click();
  await page.getByRole('option', {name: 'With coordinates', exact: true}).click();
  await expect(page.getByRole('table', {name: 'MSFS 2020 Airports (1)'})).toBeVisible();
  await expect(
    page.getByRole('button', {name: 'Missing airport', exact: true})
  ).toHaveCount(0);
  await page.getByRole('button', {name: 'Clear filters'}).click();
  await page.getByLabel('Search scenery').fill('Missing');
  await page.getByRole('button', {name: 'Missing airport', exact: true}).click();
  await expect(page.getByRole('button', {name: 'Focus airport'})).toBeDisabled();
  await expect(details.getByText(/Unavailable. Enrich airports/)).toBeVisible();
  await page.getByLabel('Search scenery').fill('no-match');
  await expect(page.getByText(/No scenery matches these filters/)).toBeVisible();
  await page.getByRole('button', {name: 'Clear filters'}).click();
  await page.getByRole('button', {name: 'Regional scenery', exact: true}).first().click();
  await expect(details.getByText(/Scenery package/)).toBeVisible();
  await expect(page.getByRole('button', {name: 'Focus airport'})).toBeDisabled();
  await page.getByRole('button', {name: 'Orphan airport', exact: true}).click();
  await expect(details.getByText('Package metadata unavailable')).toBeVisible();
  await page.getByRole('button', {name: 'Zoom in', exact: true}).click();
  await page.setViewportSize({width: 560, height: 800});
  await expect(map).toHaveAttribute('data-camera', '0,0,1');
  await expect(map.locator('svg').first()).toBeVisible();
  const resizedBox = await map.boundingBox();
  await page.mouse.move(resizedBox!.x + 100, resizedBox!.y + 100);
  await page.mouse.down();
  await page.mouse.move(resizedBox!.x + 120, resizedBox!.y + 110);
  await page.getByRole('link', {name: 'Home', exact: true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', {name: 'Addons', exact: true})).toBeVisible();
  expect(
    await page.evaluate(() => {
      const event = new Event('selectstart', {bubbles: true, cancelable: true});
      document.documentElement.dispatchEvent(event);
      return event.defaultPrevented;
    })
  ).toBe(false);
  await page.mouse.up();
  await page.getByRole('link', {name: 'Scenery', exact: true}).click();
  await expect(map).toHaveAttribute('data-camera', '0,0,1');
  await page.getByRole('button', {name: 'Zoom in', exact: true}).click();
  await expect(map).toHaveAttribute('data-camera', /,1.5$/);
  expect(errors).toEqual([]);
});

test('scenery shows loading and empty scan guidance', async ({page}) => {
  await page.addInitScript(() =>
    Object.assign(window, {
      desktop: {
        getRuntimeHealth: async () => ({status: 'ready', database: 'connected'}),
        getAddonLibrary: () =>
          new Promise(resolve =>
            Object.assign(window, {finishLibrary: () => resolve([])})
          ),
      },
    })
  );
  await page.goto('http://127.0.0.1:5173/#/scenery');
  await expect(page.getByText('Loading scenery library…')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as {finishLibrary: () => void}).finishLibrary()
  );
  await expect(
    page.getByText(/No scenery found. Save your Community folder/)
  ).toBeVisible();
});
