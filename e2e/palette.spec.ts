import { expect, test, type Page } from '@playwright/test';
import { KEY_PALETTE } from '../src/game/palette';

// The greyscale / full-colour setting: greyscale by default, switches instantly, saved in localStorage except in a
// ?play= round, and the toggle is a real phone tap target.

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
    await expectTapTarget(page, '#cover [data-act=palette]');
    await expect(page.locator('#cover [data-act=palette]')).toHaveAttribute('aria-pressed', 'false');
    await noOverflow(page);

    // A ?play= round (water and sand on this hole): the toggle recolours the board instantly but never saves.
    await page.goto('/?play=3&players=4&hole=5');
    await expect(page.locator('#hud')).toContainText('Hole 5');
    const toggle = page.locator('#tray [data-act=palette]');
    await expectTapTarget(page, '#tray [data-act=palette]');
    const grey = await colours(page);
    await noOverflow(page);
    const navigations: string[] = [];
    page.on('framenavigated', (f) => navigations.push(f.url()));
    await toggle.click();
    await expect(root).toHaveAttribute('data-palette', 'colour');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // SVG fills pick up the new custom properties on the next style pass (within a frame), so poll briefly.
    await expect.poll(async () => (await colours(page))['fairway'], { timeout: 1000 }).not.toBe(grey['fairway']);
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
    await toggle.click();
    await expect(root).toHaveAttribute('data-palette', 'grey');
    await expect.poll(() => colours(page), { timeout: 1000 }).toEqual(grey);
    expect(await stored()).toBeNull();

    // A normal visit saves the choice, and it survives a reload.
    await page.goto('/');
    await page.locator('#cover [data-act=palette]').click();
    await expect(root).toHaveAttribute('data-palette', 'colour');
    await expect(page.locator('#cover .palette-state')).toHaveText('on');
    expect(await stored()).toBe('colour');
    await page.reload();
    await expect(root).toHaveAttribute('data-palette', 'colour');

    // A ?play= round starts from the saved choice and switching back there leaves it saved.
    await page.goto('/?play=3&players=4&hole=5');
    await expect(root).toHaveAttribute('data-palette', 'colour');
    await page.locator('#tray [data-act=palette]').click();
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
