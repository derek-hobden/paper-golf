import { expect, test, type Page } from '@playwright/test';
import { applyTool, blankDraft, decodeHole, draftToHole, encodeHole, type Draft, type Tool } from '../src/engine/builder';
import { GRID_H, GRID_W, generateProperHole } from '../src/engine/generator';
import { heightAt } from '../src/engine/rules';
import type { Height } from '../src/engine/types';
import { watchConsole } from './console';
import { queueDice, rigDice } from './rig';

// Raised and low ground, option B (the paper cut-out): drawn on the board as merged regions, the aim preview's moved
// markers with their dashed level ring and tag, the tray's one line when every hit moves alike, and the builder's
// Height tool. Built holes come in by `#h=` link and play calm and dry (`Math.random` pinned to a calm seed), with
// the die rigged.

function rect(d: Draft, x0: number, y0: number, x1: number, y1: number, tool: Tool, h?: Height): Draft {
  let out = d;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out = applyTool(out, x, y, tool, h);
  return out;
}

function token(d: Draft): string {
  const hole = draftToHole(d);
  const t = hole === null ? null : encodeHole(hole);
  if (t === null) throw new Error('the test hole does not encode');
  return t;
}

/** A level fairway up the middle with a plateau across it ahead of the tee: north is uphill, the diagonals level. */
const UPHILL = token(applyTool(applyTool(rect(rect(blankDraft(), 4, 2, 8, 18, 'fairway'), 3, 10, 9, 13, 'height', 1), 6, 17, 'tee'), 6, 3, 'pin'));

/** The tee on a small plateau with level ground all round it: every hit goes one further. */
const PLATEAU_TEE = token(applyTool(applyTool(rect(rect(blankDraft(), 4, 2, 8, 18, 'fairway'), 5, 14, 7, 16, 'height', 1), 6, 15, 'tee'), 6, 3, 'pin'));

/** `windForHole(1, 0, 0)` is calm and `rainForHole(1, 0, 0)` dry: `weatherSeed()` is `floor(Math.random() * 2 ** 32)`. */
async function calm(page: Page) {
  await page.addInitScript(() => {
    Math.random = () => 1.5 / 2 ** 32;
  });
}

async function playLink(page: Page, tok: string) {
  await page.goto(`/?elevation=1#h=${tok}`);
  await page.locator('[data-act=play]').click();
  await expect(page.locator('#tray [data-act=roll]')).toBeEnabled();
}

async function roll(page: Page, die: number) {
  await queueDice(page, die);
  await page.locator('#tray [data-act=roll]').click();
  await expect(page.locator('.target').first()).toBeVisible();
}

test.describe('elevation', () => {
  test.beforeEach(async ({ page }) => {
    await rigDice(page);
    await calm(page);
  });

  test('draws raised and low ground on a generated hole, and nothing on a level one', async ({ page }) => {
    const errors = watchConsole(page);
    // Lakeside hole 13 has a plateau and a dip; Meadow Links hole 3 is level.
    expect(generateProperHole(3, 13).cells.some((c) => c.height === 1)).toBe(true);
    expect(generateProperHole(3, 13).cells.some((c) => c.height === -1)).toBe(true);
    await page.goto('/?play=3&players=1&hole=13');
    await expect(page.locator('.terrain .e-raised path')).toHaveCount(4);
    await expect(page.locator('.terrain .e-low path')).toHaveCount(3);
    // Under the hazards: both come before the sand and water paths.
    const order = await page.locator('.terrain > *').evaluateAll((els) => els.map((e) => e.getAttribute('class') ?? ''));
    expect(order.indexOf('elevation e-raised')).toBeLessThan(order.indexOf('t-sand'));
    expect(order.indexOf('elevation e-low')).toBeLessThan(order.indexOf('t-water'));
    expect(generateProperHole(0, 3).cells.every((c) => c.height === undefined)).toBe(true);
    await page.goto('/?play=0&players=1&hole=3');
    await expect(page.locator('.terrain .t-fairway')).toHaveCount(1);
    await expect(page.locator('.terrain .elevation')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('an uphill hit sits short of its level spot, rung there, and its tag says why', async ({ page }) => {
    const errors = watchConsole(page);
    await playLink(page, UPHILL);
    // A 3 off the fairway is a hit of 4: north lands on the plateau, so it goes 3; the diagonals stay level.
    await roll(page, 3);
    await expect(page.locator('#tray .status')).toContainText('Hit 4 (3+1) or putt 1');
    const up = page.locator('.target[aria-description*="uphill"]');
    await expect(up).toHaveCount(1);
    await expect(up).toHaveAttribute('aria-label', 'Hit 3 north');
    await expect(up).toHaveAttribute('aria-description', '+1 uphill · 1 shorter');
    await expect(page.locator('.guides .level-ring')).toHaveCount(1);
    const tag = up.locator('.elev-tag.full');
    await expect(tag).toHaveText('+1 uphill · 1 shorter');
    // Desktop: the tag shows on the focused marker only.
    await expect(tag).toBeHidden();
    const box = await up.locator('.mark').boundingBox();
    if (!box) throw new Error('no marker box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(tag).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('from a plateau every hit goes one further, and the tray says it once', async ({ page }) => {
    const errors = watchConsole(page);
    await playLink(page, PLATEAU_TEE);
    await roll(page, 2);
    await expect(page.locator('#tray .status')).toContainText('Downhill all round · 1 longer · Hit 4 (2+1+1) or putt 1');
    expect(await page.locator('.target.hit').count()).toBeGreaterThan(1);
    await expect(page.locator('.elev-tag')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the builder raises and lowers ground, and the link carries it', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto(`/?build=1#h=${UPHILL}`);
    await page.locator('[data-tool=height]').click();
    await expect(page.locator('#builder-note')).toHaveText('Pencil: Height · tap: raised, low, level');
    // A plateau square steps on to low, and the drag paints low along the row.
    const box = await page.locator('svg.board-play').boundingBox();
    if (!box) throw new Error('no board');
    const at = (x: number, y: number) => ({ x: box.x + ((x + 0.5) / GRID_W) * box.width, y: box.y + ((y + 0.5) / GRID_H) * box.height });
    const a = at(3, 11);
    const b = at(5, 11);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator('.terrain .e-low')).toHaveCount(1);
    await page.locator('[data-act=share]').click();
    const hash = await page.evaluate(() => location.hash);
    const hole = decodeHole(hash.slice(3));
    if (!hole) throw new Error('the shared link does not decode');
    expect([3, 4, 5].map((x) => heightAt(hole, { x, y: 11 }))).toEqual([-1, -1, -1]);
    expect(heightAt(hole, { x: 6, y: 12 })).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('elevation on a phone', { tag: '@webkit' }, () => {
  // A touch screen with no hover, in Chrome as in the WebKit iPhone project.
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await rigDice(page);
    await calm(page);
  });

  test('every moved marker carries its compact tag', async ({ page }) => {
    const errors = watchConsole(page);
    await playLink(page, UPHILL);
    await roll(page, 3);
    const tag = page.locator('.target[aria-description*="uphill"] .elev-tag.short');
    await expect(tag).toHaveText('1 shorter');
    await expect(tag).toBeVisible();
    await expect(page.locator('.elev-tag.full')).toBeHidden();
    expect(errors).toEqual([]);
  });
});
