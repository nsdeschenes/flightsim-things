import {test, expect} from '@playwright/test';

function contrastRatio(first: string, second: string): number {
  function luminance(color: string): number {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(value => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  }
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

test.beforeEach(async ({page}) => {
  await page.addInitScript(() => {
    const inventory = {
      simulator: 'msfs2024',
      communityPath: '/Community',
      scannedPath: '/Community',
      scannedAt: '2026-11-16',
      addons: [
        {
          simulator: 'msfs2024',
          folderName: 'orbx-lowi',
          folderPath: '/Community/orbx-lowi',
          name: 'Innsbruck scenery',
          creator: 'Orbx',
          version: '1.0',
          contentType: 'SCENERY',
        },
      ],
      airports: [
        {
          folderName: 'orbx-lowi',
          sourceKey: 'LOWI',
          name: 'Innsbruck',
          icaoCode: 'LOWI',
          iataCode: 'INN',
          longitude: 11.344,
          latitude: 47.2602,
          elevationMeters: 581,
        },
      ],
    };
    Object.assign(window, {
      desktop: {
        getRuntimeHealth: async () => ({status: 'ready', database: 'connected'}),
        getAddonLibrary: async () => [inventory],
        getOpenAipKeyStatus: async () => ({saved: false, available: true}),
        saveCommunityPath: async (_simulator: string, path: string) => ({
          ...inventory,
          communityPath: path,
        }),
      },
    });
  });
});

test('flat controls retain their theme, focus and disabled states', async ({page}) => {
  await page.emulateMedia({colorScheme: 'dark'});
  await page.goto('http://127.0.0.1:5173/#/settings');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await expect(page.getByRole('heading', {name: 'Flightsim Things'})).toHaveCSS(
    'color',
    'rgb(28, 7, 112)'
  );
  const simulator = page.getByRole('region', {name: 'MSFS 2024', exact: true});
  const button = simulator.getByRole('button', {name: 'Save path', exact: true});
  await expect(button).toBeEnabled();
  await expect(button).toHaveCSS('background-color', 'rgb(38, 28, 193)');
  await expect(button).toHaveCSS('box-shadow', 'none');
  await expect(button).toHaveCSS('border-top-width', '0px');
  await button.focus();
  await expect(button).toHaveCSS('outline-style', 'solid');
  await expect(button).toHaveCSS('outline-width', '2px');
  const input = simulator.getByRole('textbox');
  await expect(input).toHaveCSS('border-top-width', '1px');
  const inputColors = await input.evaluate(element => {
    const style = getComputedStyle(element);
    return {border: style.borderTopColor, background: style.backgroundColor};
  });
  expect(
    contrastRatio(inputColors.border, inputColors.background)
  ).toBeGreaterThanOrEqual(3);
  await input.fill('');
  await expect(button).toBeDisabled();
  await expect(button).not.toHaveCSS('background-color', 'rgb(38, 28, 193)');
});

test('portaled menus, tooltips and map markers inherit the shared palette', async ({
  page,
}) => {
  await page.goto('http://127.0.0.1:5173/#/scenery');
  const simulator = page.getByRole('combobox', {name: 'Simulator', exact: true});
  await simulator.click();
  const option = page.getByRole('option', {name: 'MSFS 2024', exact: true});
  await expect(option).toHaveCSS('color', 'rgb(28, 7, 112)');
  await option.click();
  await expect(simulator).toBeFocused();
  await page.keyboard.press('Tab');
  await page.getByText('orbx-lowi', {exact: true}).first().focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveText('/Community/orbx-lowi');
  await expect(tooltip).toHaveCSS('background-color', 'rgb(28, 7, 112)');
  await page.keyboard.press('Escape');
  const marker = page
    .getByTestId('scenery-map')
    .locator('g[data-ts-key="airports"] path')
    .first();
  await expect(marker).toHaveCSS('fill', 'rgb(58, 154, 255)');
  const mapColors = await page.getByTestId('scenery-map').evaluate(element => {
    const marker = element.querySelector('g[data-ts-key="airports"] path')!;
    const land = element.querySelector('g[data-ts-key="land"] path')!;
    return {
      stroke: getComputedStyle(marker).stroke,
      land: getComputedStyle(land).fill,
      water: getComputedStyle(element).backgroundColor,
    };
  });
  expect(contrastRatio(mapColors.stroke, mapColors.land)).toBeGreaterThanOrEqual(3);
  expect(contrastRatio(mapColors.stroke, mapColors.water)).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('link', {name: 'Natural Earth'})).toHaveCSS(
    'text-decoration-line',
    'underline'
  );
  await page.getByRole('button', {name: 'Innsbruck', exact: true}).click();
  await expect(marker).toHaveCSS('fill', 'rgb(241, 255, 94)');
});

for (const width of [390, 1280]) {
  test(`production routes fit a ${width}px viewport`, async ({page}, testInfo) => {
    await page.setViewportSize({width, height: 900});
    for (const route of ['/', '/scenery', '/settings']) {
      await page.goto(`http://127.0.0.1:5173/#${route}`);
      await expect(page.getByRole('status')).toHaveText(
        'Runtime ready. Database connected.'
      );
      if (route === '/scenery') {
        await expect(
          page.getByTestId('scenery-map').locator('svg').first()
        ).toBeVisible();
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth)
      ).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: testInfo.outputPath(`${route.replaceAll('/', '') || 'home'}-${width}.png`),
        fullPage: true,
      });
    }
  });
}
