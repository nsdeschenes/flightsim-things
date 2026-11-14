import {mkdtemp, rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {test, expect, _electron as electron} from '@playwright/test';

test('desktop loads the isolated preload and typed health IPC', async () => {
  const testInfo = test.info();
  const directory = await mkdtemp(join(tmpdir(), 'flightsim-desktop-'));
  try {
    const app = await electron.launch({
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
        methods: ['getRuntimeHealth'],
      });
      expect(
        await page
          .getByRole('heading')
          .evaluate(element => getComputedStyle(element).fontSize)
      ).toBe('32px');
      await page.evaluate(() => window.open('https://example.com'));
      expect(
        await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)
      ).toBe(1);
    } finally {
      await app.close();
    }
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
