import { expect, test, type Page } from '@playwright/test';
import { KEY_PALETTE } from '../src/game/palette';

// The greyscale / full-colour setting: greyscale by default, switches instantly, saved in localStorage except in a
// ?play= round, and the toggle (How to play and setup sheets) is a real phone tap target.

/** Computed colours of real board and UI elements, read in one go. */
async function colours(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const css = (sel: string, prop: 'fill' | 'color' | 'backgroundColor') => {
      const e = document.querySelector(sel);
      if (!e) throw new Error(`missing ${sel}`);
      return getComputedStyle(e)[prop];
    };
    const stipple = document.querySelector('#pg-stipple rect');
    if (!stipple) throw new Error('missing rough pattern');
    return {
      fairway: css('path.t-fairway', 'fill'),
      green: css('path.t-green', 'fill'),
      rough: getComputedStyle(stipple).fill,
      water: css('#pg-water rect', 'fill'),
      sand: css('#pg-hatch rect', 'fill'),
      tree: css('.icons g', 'fill'),
      player2: css('.chips .chip:nth-child(2) i', 'backgroundColor'),
      hudText: css('.hud .title', 'color'),
    };
  });
}

/** Computed colours on the How to play sheet: legend swatches and the toggle itself. */
async function legendColours(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const swatch = (token: string) => {
      const e = document.querySelector(`.legend rect[style^="fill:var(--t-${token})"]`);
      if (!e) throw new Error(`missing legend swatch ${token}`);
      return getComputedStyle(e).fill;
    };
    const toggle = document.querySelector('[data-act=palette]');
    if (!toggle) throw new Error('missing toggle');
    return {
      rough: swatch('rough'),
      fairway: swatch('fairway'),
      water: swatch('water'),
      toggle: getComputedStyle(toggle).backgroundColor,
    };
  });
}

async function noOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, 'horizontal overflow').toBeLessThanOrEqual(iw);
}

async function expectTapTarget(page: Page, sel: string) {
  const box = await page.locator(sel).boundingBox();
  expect(box, sel).not.toBeNull();
  expect(box?.width ?? 0, `${sel} width`).toBeGreaterThanOrEqual(44);
  expect(box?.height ?? 0, `${sel} height`).toBeGreaterThanOrEqual(44);
}

test.describe('phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('colour toggle: greyscale by default, instant switch, saved, never by a ?play= round', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    const root = page.locator('html');
    const stored = () => page.evaluate((k) => localStorage.getItem(k), KEY_PALETTE);

    // Fresh player: greyscale, nothing stored.
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await expect(root).toHaveAttribute('data-palette', 'grey');
    await noOverflow(page);

    // A ?play= round (water and sand on this hole). The toggle is on the How to play sheet, one tap from the tray.
    await page.goto('/?play=3&players=4&hole=5');
    await expect(page.locator('#hud')).toContainText('Hole 5');
    const grey = await colours(page);
    await noOverflow(page);
    const navigations: string[] = [];
    page.on('framenavigated', (f) => navigations.push(f.url()));
    await page.locator('#tray [data-act=rules]').click();
    const toggle = page.locator('#page [data-act=palette]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expectTapTarget(page, '#page [data-act=palette]');
    const greyLegend = await legendColours(page);
    await toggle.click();
    await expect(root).toHaveAttribute('data-palette', 'colour');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toContainText('Colour: on');
    // Instant: the legend on the same sheet recolours (SVG fills pick up custom properties within a frame).
    await expect.poll(() => legendColours(page), { timeout: 1000 }).not.toEqual(greyLegend);
    const colourLegend = await legendColours(page);
    for (const [k, v] of Object.entries(greyLegend)) expect(colourLegend[k], `legend ${k} changes colour`).not.toBe(v);
    await noOverflow(page);
    await page.locator('#page [data-act=back]').click();
    await expect(page.locator('#hud')).toContainText('Hole 5');
    const colour = await colours(page);
    expect(Object.keys(colour)).toEqual(Object.keys(grey));
    for (const [k, v] of Object.entries(grey)) expect(colour[k], `${k} changes colour`).not.toBe(v);
    // Greyscale really is grey; colour has a green fairway and blue water.
    expect(grey['fairway']).toBe('rgb(246, 244, 236)');
    expect(colour['fairway']).toBe('rgb(211, 236, 169)');
    expect(colour['water']).toBe('rgb(79, 147, 218)');
    await expect(page.locator('.flag')).toBeVisible();
    await noOverflow(page);
    expect(navigations, 'switching never reloads').toEqual([]);
    expect(await stored()).toBeNull();
    await page.locator('#tray [data-act=rules]').click();
    await toggle.click();
    await expect(root).toHaveAttribute('data-palette', 'grey');
    await page.locator('#page [data-act=back]').click();
    await expect.poll(() => colours(page), { timeout: 1000 }).toEqual(grey);
    expect(await stored()).toBeNull();

    // A real round saves the choice (toggled on the setup sheet here), and it survives a reload.
    await page.goto('/');
    await page.locator('#cover [data-act=new]').click();
    await expectTapTarget(page, '#page [data-act=palette]');
    await page.locator('#page [data-act=palette]').click();
    await expect(root).toHaveAttribute('data-palette', 'colour');
    expect(await stored()).toBe('colour');
    await noOverflow(page);
    await page.locator('#page [data-act=go]').click();
    await expect(page.locator('#hud')).toContainText('Hole 1');
    await page.reload();
    await expect(root).toHaveAttribute('data-palette', 'colour');
    await page.locator('#cover [data-act=continue]').click();
    await page.locator('#tray [data-act=rules]').click();
    await expect(page.locator('#page [data-act=palette]')).toHaveAttribute('aria-pressed', 'true');

    // A ?play= round starts from the saved choice and switching back there leaves it saved.
    await page.goto('/?play=3&players=4&hole=5');
    await expect(root).toHaveAttribute('data-palette', 'colour');
    await page.locator('#tray [data-act=rules]').click();
    await page.locator('#page [data-act=palette]').click();
    await expect(root).toHaveAttribute('data-palette', 'grey');
    expect(await stored()).toBe('colour');

    // Junk in storage falls back to greyscale.
    await page.evaluate((k) => {
      localStorage.setItem(k, 'purple');
    }, KEY_PALETTE);
    await page.goto('/');
    await expect(root).toHaveAttribute('data-palette', 'grey');
    expect(errors).toEqual([]);
  });
});
