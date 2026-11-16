import {test, expect} from '@playwright/test';

test('unstyled content and controls start without browser decoration', async ({page}) => {
  await page.goto('http://127.0.0.1:5173');
  const styles = await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.style.font = '17px / 1.6 monospace';
    fixture.innerHTML = `
      <h2>Heading</h2><ul><li>Item</li></ul>
      <button>Action</button><input value="Value"><textarea>Value</textarea>
      <style>#reset-probe::before { content: ''; display: block; width: 20px; padding: 4px; }</style>
      <div id="reset-probe"></div>`;
    document.body.append(fixture);
    const read = (selector: string, pseudo?: string) => {
      const style = getComputedStyle(fixture.querySelector(selector)!, pseudo);
      return {
        border: style.borderTopWidth,
        borderStyle: style.borderTopStyle,
        background: style.backgroundColor,
        font: style.fontFamily,
        fontSize: style.fontSize,
        margin: style.marginTop,
        padding: style.paddingLeft,
        shadow: style.boxShadow,
        boxSizing: style.boxSizing,
      };
    };
    return {
      button: read('button'),
      input: read('input'),
      textarea: read('textarea'),
      heading: read('h2'),
      list: read('ul'),
      pseudo: read('#reset-probe', '::before'),
    };
  });
  for (const control of [styles.button, styles.input, styles.textarea]) {
    expect(control.border).toBe('0px');
    expect(control.background).toBe('rgba(0, 0, 0, 0)');
    expect(control.font).toBe('monospace');
    expect(control.fontSize).toBe('17px');
    expect(control.shadow).toBe('none');
  }
  expect(styles.heading.margin).toBe('0px');
  expect(styles.heading.fontSize).toBe('17px');
  expect(styles.list.margin).toBe('0px');
  expect(styles.list.padding).toBe('0px');
  expect(styles.pseudo.boxSizing).toBe('border-box');

  await page.getByRole('link', {name: 'Settings', exact: true}).click();
  await expect(page.getByRole('textbox').first()).toHaveCSS('border-top-width', '1px');
  await expect(page.getByRole('textbox').first()).toHaveCSS('border-top-style', 'solid');
});
