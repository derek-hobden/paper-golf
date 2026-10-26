import { expect, test, type Page } from '@playwright/test';
import { encodeHole } from '../src/engine/builder';
import { GRID_H, GRID_W } from '../src/engine/generator';
import type { Cell, Hole, P } from '../src/engine/types';
import { watchConsole } from './console';

// Elevation on the page, option B (Derek, 26 Oct 2026): raised ground is an extra sheet of paper glued on, low
// ground is the page pressed in. Each height is one merged region under the hazards, the grid dots and everything
// that plays, so a bunker on a plateau stays crisp. A marker elevation moved sits where the ball really stops, with
// a faint dashed ring where it would have landed on the level; a sticker says by how much, unless the whole aim
// climbed the same way, which the tray says once instead.
//
// Every case builds its own hole as a `#h=` link, so the ground is exactly what the case is about, and leaves its
// screenshots in test-results/elevation/ (gitignored) at both sizes.

const SHOTS = 'test-results/elevation';

/** A 13x20 page of fairway with a 3x3 plateau round (6,13), a 3x3 dip round (6,8) and two bunkers on the plateau. */
function hillyHole(tee: P): Hole {
  const cells: Cell[] = [];
  for (let y = 0; y < GRID_H; y += 1)
    for (let x = 0; x < GRID_W; x += 1) {
      const plateau = Math.abs(x - 6) <= 1 && Math.abs(y - 13) <= 1;
      const dip = Math.abs(x - 6) <= 1 && Math.abs(y - 8) <= 1;
      const cell: Cell = { t: plateau && y === 12 && x <= 6 ? 'sand' : 'fairway' };
      if (plateau) cell.e = 1;
      if (dip) cell.e = -1;
      cells.push(cell);
    }
  return { course: 0, number: 1, seed: 1, w: GRID_W, h: GRID_H, par: 4, cells, tee, cup: { x: 6, y: 4 } };
}

/** Open that hole's share link in the builder and play it. */
async function playHilly(page: Page, tee: P): Promise<void> {
  const token = encodeHole(hillyHole(tee));
  expect(token, 'the hole encodes').not.toBeNull();
  await page.goto(`/#h=${token ?? ''}`);
  await expect(page.locator('#builder-step')).toHaveText('Ready — tap Play this hole');
  await page.locator('[data-act=play]').click();
  await expect(page.locator('#hud')).toContainText('Hole 1');
  await expect(page.locator('#tray [data-act=roll]')).toBeEnabled();
}

/** Roll `die` without anything playing itself, and wait for the markers. */
async function rollTo(page: Page, die: number): Promise<void> {
  await page.evaluate((d) => {
    document.documentElement.dataset.dice = String(d);
  }, die);
  await page.locator('#tray [data-act=roll]').click();
  await expect(page.locator('#tray .status')).toContainText('rolled');
  await expect(page.locator('g.target').first()).toBeVisible();
}

for (const vp of [
  { name: 'desktop', width: 1280, height: 800, phone: false },
  { name: 'phone', width: 390, height: 844, phone: true },
] as const) {
  test.describe(`elevation ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.phone, hasTouch: vp.phone });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => {
        // A built round takes the weather it is dealt, from `Math.random` (main.ts `weatherSeed`). Weather seed 1
        // is calm and dry, which is the only ground these cases are about: a wind would blow the markers off the
        // dots the heights put them on, and `e2e/wind.spec.ts` already holds that rule.
        Math.random = () => 1.5 / 2 ** 32;
        const real = crypto.getRandomValues.bind(crypto);
        Object.defineProperty(crypto, 'getRandomValues', {
          value: (a: Uint32Array<ArrayBuffer>) => {
            const root = document.documentElement;
            const [next, ...rest] = (root.dataset.dice ?? '').split(',').filter(Boolean);
            if (next === undefined || a.length !== 1) return real(a);
            root.dataset.dice = rest.join(',');
            a[0] = Number(next) - 1;
            return a;
          },
        });
      });
    });

    test('draws a plateau and a dip as paper, under the hazards', async ({ page }) => {
      const errors = watchConsole(page);
      await playHilly(page, { x: 6, y: 16 });

      // One merged region per height, each drawn as its own stack of paper layers: the raised sheet's drop shadow,
      // cut edge, fill and inside highlight, and the dip's fill, press and lip.
      await expect(page.locator('.terrain .heights path')).toHaveCount(7);
      const order = await page.evaluate(() => {
        const kids = [...(document.querySelector('.terrain')?.children ?? [])];
        const index = (sel: string) => kids.findIndex((k) => k.matches(sel));
        return { heights: index('.heights'), sand: index('.t-sand'), water: index('.t-water'), dots: index('.dots') };
      });
      // Under sand, water and the grid dots, so the hazards and the page's dots stay exactly as crisp as they were.
      expect(order.heights).toBeGreaterThan(0);
      expect(order.sand).toBeGreaterThan(order.heights);
      expect(order.water).toBeGreaterThan(order.heights);
      expect(order.dots).toBeGreaterThan(order.heights);
      // Nothing is written on the course: no lines, no hatching, no numbers.
      await expect(page.locator('.terrain .heights text')).toHaveCount(0);

      await page.screenshot({ path: `${SHOTS}/${vp.name}-at-rest.png` });
      expect(errors).toEqual([]);
    });

    test('an uphill aim sits where the ball stops, with a ring where it would have landed', async ({ page }) => {
      const errors = watchConsole(page);
      await playHilly(page, { x: 6, y: 16 });
      // A 2 from the fairway tee carries 3. North is the plateau, so that one hit plays 2 and stops short of it;
      // every other direction is level ground and unchanged.
      await rollTo(page, 2);
      await expect(page.locator('g.target[aria-label="Hit 2 north"]')).toBeVisible();
      await expect(page.locator('g.target[aria-label="Hit 3 east"]')).toBeVisible();
      await expect(page.locator('.guides .level-ghost')).toHaveCount(1);
      // The directions differ, so the tray keeps the base number and the marker carries the difference.
      await expect(page.locator('#tray .status')).toContainText('Hit 3 (2+1)');
      await expect(page.locator('#tray .status')).not.toContainText('all round');
      const tag = page.locator('.lift-tag');
      await expect(tag).toHaveCount(1);
      // `innerText`, so only the wording this screen actually shows is read.
      if (vp.phone) {
        // No hover on a phone: the sticker is up already, and compact.
        await expect(tag).toHaveCSS('opacity', '1');
        await expect(tag).toHaveText('1 shorter', { useInnerText: true });
      } else {
        // A pointer to hover with: the sticker waits for the marker under it, and reads in full.
        await expect(tag).toHaveCSS('opacity', '0');
        await page.locator('g.target[aria-label="Hit 2 north"]').hover();
        await expect(tag).toHaveCSS('opacity', '1');
        await expect(tag).toHaveText('+1 uphill · 1 shorter', { useInnerText: true });
      }
      await page.screenshot({ path: `${SHOTS}/${vp.name}-uphill-aim.png` });
      expect(errors).toEqual([]);
    });

    test('a tee on a plateau says it once in the tray and tags no marker', async ({ page }) => {
      const errors = watchConsole(page);
      await playHilly(page, { x: 6, y: 13 });
      await rollTo(page, 2);
      // Every direction drops off the plateau, so all eight hits carry one space more: one line, no stickers.
      await expect(page.locator('#tray .status')).toContainText('Downhill all round · 1 longer');
      await expect(page.locator('#tray .status')).toContainText('Hit 4 (2+2)');
      await expect(page.locator('.lift-tag')).toHaveCount(0);
      await expect(page.locator('.guides .level-ghost')).toHaveCount(8);
      await expect(page.locator('g.target[aria-label="Hit 4 north"]')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${vp.name}-downhill-all-round.png` });
      expect(errors).toEqual([]);
    });

    test('the builder raises and lowers ground with the Height tool', async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto('/');
      await page.locator('#cover [data-act=build]').click();
      await expect(page.locator('#hud')).toContainText('Build a hole');

      const cell = async (x: number, y: number) => {
        const box = await page.locator('svg.board-play').boundingBox();
        expect(box, 'board').not.toBeNull();
        return { x: (box?.x ?? 0) + ((x + 0.5) / GRID_W) * (box?.width ?? 0), y: (box?.y ?? 0) + ((y + 0.5) / GRID_H) * (box?.height ?? 0) };
      };
      const tapCell = async (x: number, y: number) => {
        const p = await cell(x, y);
        await page.mouse.move(p.x, p.y);
        await page.mouse.down();
        await page.mouse.up();
      };

      await page.locator('[data-tool=height]').click();
      await expect(page.locator('[data-tool=height]')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#builder-note')).toContainText('Pencil: Height');
      // Raise a 2x2 patch: one tap a square, since the tool cycles rather than dragging a trail.
      for (const [x, y] of [[5, 10], [6, 10], [5, 11], [6, 11]] as const) await tapCell(x, y);
      await expect(page.locator('.terrain .heights path')).toHaveCount(4);
      // A second tap on the same square sinks it instead: two squares tapped twice are a dip beside the plateau.
      for (const [x, y] of [[8, 14], [8, 14], [9, 14], [9, 14]] as const) await tapCell(x, y);
      await expect(page.locator('.terrain .heights path')).toHaveCount(7);
      // A third tap puts a square back to level, and round again: the plateau is whole either way.
      for (let n = 0; n < 3; n += 1) await tapCell(5, 10);
      await expect(page.locator('.terrain .heights path')).toHaveCount(7);

      await page.screenshot({ path: `${SHOTS}/${vp.name}-builder-height.png` });
      expect(errors).toEqual([]);
    });
  });
}
