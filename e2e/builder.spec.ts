import { expect, test, type Page } from '@playwright/test';
import { GRID_H, GRID_W } from '../src/engine/generator';
import { watchConsole } from './console';
import { tapMarker } from './tap';

// Draw a hole, share it, open the link, and play it. A broken link opens an empty builder.

const KEY_GAME = 'paper-golf:game:v1';
const KEY_BEST = 'paper-golf:best:v1';

async function cellPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('svg.board-play').boundingBox();
  expect(box, 'board').not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return {
    x: box.x + ((x + 0.5) / GRID_W) * box.width,
    y: box.y + ((y + 0.5) / GRID_H) * box.height,
  };
}

async function paint(page: Page, x: number, y: number, x2 = x, y2 = y) {
  const a = await cellPoint(page, x, y);
  const b = await cellPoint(page, x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** Roll and tap until the hole card. A putt is always on offer on this fairway, and a hole-out plays itself. */
async function playToCard(page: Page) {
  const roll = page.locator('#tray [data-act=roll]:enabled');
  const card = page.locator('.hole-card');
  for (let turn = 0; turn < 12; turn += 1) {
    await expect(roll.or(card)).toBeVisible({ timeout: 10_000 });
    if (await card.isVisible()) return;
    await roll.click();
    await expect(page.locator('#tray .status')).toContainText('rolled');
    const targets = page.locator('g.target');
    await expect(targets.first().or(card)).toBeVisible({ timeout: 10_000 });
    if (await card.isVisible()) return;
    await tapMarker(page, targets.first());
  }
  await expect(card).toBeVisible();
}

test.describe('course builder', { tag: '@webkit' }, () => {
  test('build a hole, share it, open the link and play it', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.reload();
    await page.locator('#cover [data-act=new]').click();
    await page.locator('[data-act=build]').click();
    await expect(page.locator('#hud')).toContainText('Build a hole');

    await page.locator('[data-tool=fairway]').click();
    await paint(page, 6, 16, 6, 12);
    await page.locator('[data-tool=tee]').click();
    await paint(page, 6, 16);
    await page.locator('[data-tool=pin]').click();
    await paint(page, 6, 12);
    await expect(page.locator('.cup-rim')).toBeVisible();
    await expect(page.locator('svg .t-fairway')).toHaveAttribute('d', /.+/u);

    await page.locator('[data-act=share]').click();
    await expect(page.locator('#builder-note')).toHaveText(/Link copied|address bar/u);
    const hash = await page.evaluate(() => location.hash);
    expect(hash.startsWith('#h=')).toBe(true);
    expect(hash.slice(3)).not.toMatch(/[+/=]/u);

    // A new query forces a full load. A hash-only change would not run boot again.
    await page.goto(`/?shared=1${hash}`);
    await expect(page.locator('#hud')).toContainText('Build a hole');
    await expect(page.locator('#builder-note')).toHaveText('');
    await expect(page.locator('.cup-rim')).toBeVisible();
    await expect(page.locator('svg .t-fairway')).toHaveAttribute('d', /.+/u);

    const saved = await page.evaluate((k) => localStorage.getItem(k), KEY_GAME);
    const best = await page.evaluate((k) => localStorage.getItem(k), KEY_BEST);
    await page.locator('[data-act=play]').click();
    await expect(page.locator('#hud')).toContainText('Hole 1');
    await expect(page.locator('#hud')).toContainText('Your hole');
    await playToCard(page);
    await expect(page.locator('.hole-card h2')).toHaveText('Hole 1 done');
    await page.locator('.hole-card [data-act=next]').click();
    await expect(page.locator('.sheet h2')).toContainText('Your hole');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY_GAME)).toBe(saved);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY_BEST)).toBe(best);
    expect(errors).toEqual([]);
  });

  test('a broken hole link opens an empty builder', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/#h=nope');
    await expect(page.locator('#hud')).toContainText('Build a hole');
    await expect(page.locator('#builder-note')).toHaveText('That hole link is broken');
    await expect(page.locator('.cup-rim')).toHaveCount(0);
    await expect(page.locator('#tray [data-act=play]')).toBeVisible();
    await page.locator('[data-act=play]').click();
    await expect(page.locator('#builder-note')).toHaveText('Place a tee and a pin.');
    await expect(page.locator('#hud')).toContainText('Build a hole');
    expect(errors).toEqual([]);
  });
});
