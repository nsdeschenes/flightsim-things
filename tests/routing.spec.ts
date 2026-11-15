import {test, expect} from '@playwright/test';

for (const route of [
  {path: '/', heading: 'Addons', link: 'Home'},
  {path: '/scenery', heading: 'Scenery', link: 'Scenery'},
  {path: '/settings', heading: 'Settings', link: 'Settings'},
]) {
  test(`hash route ${route.path} supports direct entry, reload and history`, async ({
    page,
  }) => {
    await page.goto(`http://127.0.0.1:5173/#${route.path}`);
    await expect(
      page.getByRole('heading', {name: route.heading, exact: true})
    ).toBeVisible();
    await expect(page.getByRole('link', {name: route.link, exact: true})).toHaveAttribute(
      'aria-current',
      'page'
    );
    await page.reload();
    await expect(
      page.getByRole('heading', {name: route.heading, exact: true})
    ).toBeVisible();
    const next = route.path === '/settings' ? 'Home' : 'Settings';
    await page.getByRole('link', {name: next, exact: true}).click();
    await expect(
      page.getByRole('heading', {name: next === 'Home' ? 'Addons' : next, exact: true})
    ).toBeVisible();
    await page.goBack();
    await expect(
      page.getByRole('heading', {name: route.heading, exact: true})
    ).toBeVisible();
    await page.goForward();
    await expect(page.getByRole('link', {name: next, exact: true})).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
}
