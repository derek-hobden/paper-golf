import { expect, test, type Page } from '@playwright/test';
import { GRID_H, GRID_W, generateProperHole } from '../src/engine/generator';
import { watchConsole } from './console';
import { queueDice, rigDice } from './rig';

// Elevation on the page: a plateau is drawn as a sheet of paper glued on top, a dip as ground pressed into it, both
// under the hazards; a hit the ground moved is drawn where the ball really stops, with a dashed ring where a level
// hit would have come down and a note saying what the ground did. README "Elevation".

/** Meadow Links 11: a dip and a plateau beside the line of play. Meadow Links 2: every dot level. */
const RAISED = 11;
const LEVEL = 2;

async function cellPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('svg.board-play').boundingBox();
  expect(box, 'board').not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + ((x + 0.5) / GRID_W) * box.width, y: box.y + ((y + 0.5) / GRID_H) * box.height };
}

async function paint(page: Page, x: number, y: number, x2 = x, y2 = y, steps = 8) {
  const a = await cellPoint(page, x, y);
  const b = await cellPoint(page, x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

const paintRow = (page: Page, y: number) => paint(page, 0, y, GRID_W - 1, y, GRID_W * 4);

async function openBuilder(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.locator('#cover [data-act=build]').click();
  await expect(page.locator('#hud')).toContainText('Build a hole');
}

test.describe('elevation', { tag: '@webkit' }, () => {
  test('draws a plateau and a dip as paper, under the hazards, and nothing at all on a level hole', async ({ page }) => {
    const errors = watchConsole(page);
    // What this hole is for: if the generator ever stops laying it out with elevation, say so here rather than in a
    // puzzle about missing paths.
    const hole = generateProperHole(0, RAISED);
    expect(hole.cells.some((c) => c.z === 1), 'Meadow Links 11 has a plateau').toBe(true);
    expect(hole.cells.some((c) => c.z === -1), 'Meadow Links 11 has a dip').toBe(true);
    expect(generateProperHole(0, LEVEL).cells.every((c) => c.z === undefined), 'Meadow Links 2 is level').toBe(true);

    await page.goto(`/?play=0&players=1&hole=${String(RAISED)}`);
    await expect(page.locator('.board-terrain .relief')).toHaveCount(1);
    // The sheet: its cast shadow, its paper cut edge, its lighter fill and the highlight inside its top-left.
    await expect(page.locator('.relief .relief-up')).toHaveCount(4);
    // The dip: a darker fill, the press inside its top-left and the highlight inside its bottom-right.
    await expect(page.locator('.relief .relief-down')).toHaveCount(3);
    // One merged outline per height, never one shape per cell.
    await expect(page.locator('.relief .relief-up').first()).toHaveAttribute('d', /.+/u);

    // Drawn over the grass and under the hazards and the dots, so sand and water stay crisp.
    const order = await page
      .locator('.board-terrain .terrain > *')
      .evaluateAll((els) => els.map((e) => e.getAttribute('class') ?? ''));
    expect(order.indexOf('relief')).toBeGreaterThan(order.indexOf('t-fairway'));
    expect(order.indexOf('relief')).toBeLessThan(order.indexOf('t-sand'));
    expect(order.indexOf('relief')).toBeLessThan(order.indexOf('dots'));

    await page.goto(`/?play=0&players=1&hole=${String(LEVEL)}`);
    await expect(page.locator('.board-play')).toBeVisible();
    await expect(page.locator('.relief')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('moves the marker a hit uphill, rings where a level hit would have landed, and keeps the tray’s number', async ({ page }) => {
    const errors = watchConsole(page);
    await rigDice(page);
    await page.goto(`/?play=0&players=1&hole=${String(RAISED)}`);
    await queueDice(page, 1);
    await page.locator('#tray [data-act=roll]').click();
    await expect(page.locator('#tray .status')).toContainText('rolled');

    // One direction of the eight comes down on the plateau, so the number stays the roll's own and that one marker
    // carries the note.
    await expect(page.locator('#tray .status small')).toContainText('Hit 2 (1+1) or putt 1 · tap a spot');
    const moved = page.locator('g.target[aria-label*="uphill"]');
    await expect(moved).toHaveCount(1);
    await expect(moved).toHaveAttribute('aria-label', 'Hit 2 south-west — +1 uphill · 1 shorter');
    await expect(page.locator('.elev-level')).toHaveCount(1);
    const tag = page.locator('.elev-tag');
    await expect(tag).toHaveCount(1);
    await expect(tag.locator('.short')).toHaveText('1 shorter');
    await expect(tag.locator('.long')).toHaveText('+1 uphill · 1 shorter');
    expect(errors).toEqual([]);
  });

  test('raises and lowers ground in the builder, and says it once when every direction is downhill', async ({ page }) => {
    const errors = watchConsole(page);
    await rigDice(page);
    await openBuilder(page);
    await page.locator('[data-tool=fairway]').click();
    for (let y = 9; y <= 17; y += 1) await paintRow(page, y);

    // The height tool walks a square level → up → down → level, and paints one square per tap.
    await page.locator('[data-tool=height]').click();
    await expect(page.locator('#builder-note')).toHaveText('Pencil: Height · tap or drag the page');
    await paint(page, 6, 16);
    await expect(page.locator('.relief .relief-up')).toHaveCount(4);
    await expect(page.locator('.relief .relief-down')).toHaveCount(0);
    await paint(page, 5, 13);
    await paint(page, 5, 13);
    await expect(page.locator('.relief .relief-down')).toHaveCount(3);
    await paint(page, 5, 13);
    await expect(page.locator('.relief .relief-down')).toHaveCount(0);
    // Undo steps back over a height like any other stroke.
    await page.locator('[data-act=undo]').click();
    await expect(page.locator('.relief .relief-down')).toHaveCount(3);

    await page.locator('[data-tool=tee]').click();
    await paint(page, 6, 16);
    await page.locator('[data-tool=pin]').click();
    await paint(page, 6, 10);
    await expect(page.locator('#builder-step')).toHaveText('Ready — tap Play this hole');
    await page.locator('[data-act=play]').click();
    await expect(page.locator('#hud')).toContainText('Your hole');

    // The tee stands on the plateau, so every hit is a level down: the tray says so once and no marker is tagged.
    await queueDice(page, 3);
    await page.locator('#tray [data-act=roll]').click();
    await expect(page.locator('#tray .status small')).toContainText('Downhill all round · 1 longer');
    await expect(page.locator('.elev-tag')).toHaveCount(0);
    await expect(page.locator('.elev-level').first()).toBeAttached();
    await expect(page.locator('g.target[aria-label*="downhill"]').first()).toBeAttached();
    expect(errors).toEqual([]);
  });
});
