import { expect, test, type Page } from '@playwright/test';
import { queueDice, rigDice } from './rig';
import { tapMarker } from './tap';

// The wind's look: on a windy hole pencil swirls blow across the board (a canvas under the play layer), trees sway and
// the flag flutters downwind; calm and reduced motion keep everything still. Taps still reach the targets on top.
// Deep links play the default wind seed: Meadow Links hole 9 is W 2, hole 7 calm.

const W2 = '/?play=0&players=1&hole=9';
const CALM = '/?play=0&players=1&hole=7';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

/** Pixels the swirls have pencilled on their canvas right now. */
const inked = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas.board-wind');
    if (!(c instanceof HTMLCanvasElement)) return -1;
    const g = c.getContext('2d');
    if (!g) return -1;
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if ((d[i] ?? 0) > 0) n++;
    return n;
  });

const treeTransform = (page: Page) => page.evaluate(() => getComputedStyle(document.querySelector('.sway-tree') ?? document.body).transform);

test.describe('full motion', { tag: '@webkit' }, () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a windy hole blows swirls, sways the trees and flies the flag downwind; targets stay on top', async ({ page }) => {
    const errors = watchErrors(page);
    await rigDice(page);
    await page.goto(W2);
    await expect(page.locator('#hud')).toContainText('Wind W 2');
    await expect.poll(() => inked(page)).toBeGreaterThan(200);
    await expect(page.locator('.board-sway')).toHaveClass(/\bwindy\b/);
    await expect(page.locator('.board-sway')).toHaveClass(/\bwest\b/);
    // The trees move: two reads apart differ.
    const a = await treeTransform(page);
    await page.waitForTimeout(300);
    expect(await treeTransform(page)).not.toBe(a);
    // Clearly visible: over a couple of sways the first tree leans well over, downwind (west: anticlockwise).
    let lean = 0;
    for (let i = 0; i < 12; i++) {
      const m = /matrix\(([^,]+), ([^,]+),/.exec(await treeTransform(page));
      if (m) lean = Math.min(lean, (Math.atan2(Number(m[2]), Number(m[1])) * 180) / Math.PI);
      await page.waitForTimeout(150);
    }
    expect(lean).toBeLessThan(-5);
    // The canvas sits between the course and the play layer and never takes a tap.
    const layers = ['board-terrain', 'board-sway', 'board-wind', 'board-play'];
    const order = await page.evaluate(
      (names) => [...(document.querySelector('#board-wrap')?.children ?? [])].map((e) => names.find((n) => e.classList.contains(n)) ?? ''),
      layers,
    );
    expect(order.slice(0, 4)).toEqual(layers);
    expect(await page.locator('canvas.board-wind').evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    // A target's centre is the target, not the wind, and tapping it plays the shot.
    await queueDice(page, 4);
    await page.locator('#tray [data-act=roll]').click();
    const target = page.locator('g.target.hit').first();
    await expect(target).toBeVisible();
    const box = await target.locator('circle.mark').boundingBox();
    if (!box) throw new Error('no target marker');
    const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.target') !== null, [box.x + box.width / 2, box.y + box.height / 2] as const);
    expect(top).toBe(true);
    await tapMarker(page, target);
    await expect(page.locator('#hud .chip .hand').first()).toHaveText('1');
    expect(errors).toEqual([]);
  });

  test('a calm hole has no swirls and still trees', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(CALM);
    await expect(page.locator('#hud')).toContainText('Calm');
    await page.waitForTimeout(500);
    expect(await inked(page)).toBe(0);
    await expect(page.locator('.board-sway')).not.toHaveClass(/\bwindy\b/);
    expect(await treeTransform(page)).toBe('none');
    expect(errors).toEqual([]);
  });
});

test('reduced motion: no swirls and no sway, even in a strong wind', { tag: '@webkit' }, async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(W2);
  await expect(page.locator('#hud')).toContainText('Wind W 2');
  await page.waitForTimeout(500);
  expect(await inked(page)).toBe(0);
  await expect(page.locator('.board-sway')).not.toHaveClass(/\bwindy\b/);
  expect(await treeTransform(page)).toBe('none');
  // The flag still flies downwind (a still picture, not motion).
  expect(await page.locator('.flag-fly').evaluate((e) => getComputedStyle(e).transform)).toBe('matrix(-1, 0, 0, 1, 0, 0)');
  expect(errors).toEqual([]);
});
