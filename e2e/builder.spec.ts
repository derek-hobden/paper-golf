import { expect, test, type Page } from '@playwright/test';
import { GRID_H, GRID_W } from '../src/engine/generator';
import { watchConsole } from './console';
import { tapMarker } from './tap';

// Draw a hole, share it, open the link, and play it. A broken link opens an empty builder.
// Build a hole is on the title screen (never on the new round screen) and Back from the builder returns there.

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

/** The title screen's Build a hole, from a clean first visit. */
async function openBuilder(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await page.locator('#cover [data-act=build]').click();
  await expect(page.locator('#hud')).toContainText('Build a hole');
}

test.describe('course builder', { tag: '@webkit' }, () => {
  test('is reached from the title screen, not the new round screen, and Back goes home', async ({ page }) => {
    const errors = watchConsole(page);
    await openBuilder(page);
    await expect(page.locator('#tray [data-act=play]')).toBeVisible();

    // Back returns to the title screen (the cover is shut again), not to the new round screen.
    await page.locator('#tray [data-act=back]').click();
    await expect(page.locator('#cover')).not.toHaveClass(/\bopen\b/u);
    await expect(page.locator('#cover [data-act=build]')).toBeVisible();

    // The new round screen has no Build a hole button at all.
    await page.locator('#cover [data-act=new]').click();
    await expect(page.locator('.sheet h2')).toHaveText('New round');
    await expect(page.locator('.sheet [data-act=build]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('build a hole, share it, open the link and play it', async ({ page }) => {
    const errors = watchConsole(page);
    await openBuilder(page);

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
    await expect(page.locator('#builder-note')).toHaveText(/Pencil: Fairway/u);
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

  test('says what the hole still needs, what the pencil is, and why a slope would not paint', async ({ page }) => {
    const errors = watchConsole(page);
    await openBuilder(page);
    const step = page.locator('#builder-step');
    const note = page.locator('#builder-note');

    await expect(step).toHaveText('Place a tee and a pin');
    await expect(note).toHaveText('Pencil: Fairway · tap or drag the page');
    // The par reads in the HUD at every size, where the score line used to hide it.
    await expect(page.locator('#hud')).toContainText('Par 4');
    await page.locator('[data-par="5"]').click();
    await expect(page.locator('#hud')).toContainText('Par 5');

    await page.locator('[data-tool=water]').click();
    await expect(note).toHaveText('Pencil: Water · tap or drag the page');
    await paint(page, 4, 8);
    await page.locator('[data-tool=slope]').click();
    await paint(page, 4, 8);
    await expect(note).toHaveText('A slope needs grass or sand.');

    await page.locator('[data-tool=tee]').click();
    await paint(page, 6, 16);
    await expect(step).toHaveText('Place a pin');
    // Dragging the tee moves it to where the finger lifts, rather than leaving it where the drag began.
    await paint(page, 6, 16, 6, 14);
    await expect(page.locator('svg.board-terrain .icons circle[fill="#fbfaf6"]')).toHaveAttribute('cy', '14.5');
    await paint(page, 6, 14, 6, 16);
    await page.locator('[data-tool=pin]').click();
    await paint(page, 6, 16);
    // The pin took the tee's square, so the tee is gone and the step says so.
    await expect(step).toHaveText('Place a tee');
    await page.locator('[data-tool=tee]').click();
    await paint(page, 6, 12);
    await expect(step).toHaveText('Ready — tap Play this hole');

    // A tee under water is caught before Play is ever tapped.
    await page.locator('[data-tool=water]').click();
    await paint(page, 6, 12);
    await expect(step).toHaveText('Move the tee onto grass or sand');
    expect(errors).toEqual([]);
  });

  test('undoes the par with everything else, and drops a share link the drawing has outgrown', async ({ page }) => {
    const errors = watchConsole(page);
    await openBuilder(page);
    await page.locator('[data-tool=fairway]').click();
    await paint(page, 6, 16, 6, 12);
    await page.locator('[data-par="5"]').click();
    await expect(page.locator('#hud')).toContainText('Par 5');
    await page.locator('[data-tool=sand]').click();
    await paint(page, 5, 14);

    // Undo steps back over the sand, then over the par: the par change is an undo step of its own.
    await page.locator('[data-act=undo]').click();
    await expect(page.locator('#hud')).toContainText('Par 5');
    await page.locator('[data-act=undo]').click();
    await expect(page.locator('#hud')).toContainText('Par 4');

    // Share needs a playable hole, not just a tee and a pin.
    await page.locator('[data-act=share]').click();
    await expect(page.locator('#builder-note')).toHaveText('Place a tee and a pin.');
    expect(await page.evaluate(() => location.hash)).toBe('');

    await page.locator('[data-tool=tee]').click();
    await paint(page, 6, 16);
    await page.locator('[data-tool=pin]').click();
    await paint(page, 6, 12);
    await page.locator('[data-act=share]').click();
    await expect(page.locator('#builder-note')).toHaveText(/Link copied|address bar/u);
    expect(await page.evaluate(() => location.hash)).toMatch(/^#h=/u);

    // The next change makes that link stale, so it leaves the address bar rather than reloading the old hole.
    await page.locator('[data-tool=water]').click();
    await paint(page, 2, 2);
    expect(await page.evaluate(() => location.hash)).toBe('');
    expect(errors).toEqual([]);
  });

  test('asks once before Back throws a drawing away', async ({ page }) => {
    const errors = watchConsole(page);
    await openBuilder(page);
    await page.locator('[data-tool=fairway]').click();
    await paint(page, 6, 16, 6, 12);

    await page.locator('[data-act=back]').click();
    await expect(page.locator('#builder-note')).toHaveText('Tap Back again to leave — the hole is not saved.');
    await expect(page.locator('#hud')).toContainText('Build a hole');
    await page.locator('[data-act=back]').click();
    await expect(page.locator('#cover')).not.toHaveClass(/\bopen\b/u);
    expect(errors).toEqual([]);
  });
});

// The builder's board is painted a square at a time with a finger: the tray may not squeeze it to half the size of
// the one a round is played on. It was 173x267 (a 13.3px square) at 390x844 while the play board was 334x514.
test.describe('builder board on a phone', { tag: '@webkit' }, () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('keeps squares big enough to paint, and every control on the screen', async ({ page }) => {
    const errors = watchConsole(page);
    await openBuilder(page);
    await expect(page.locator('#tray [data-act=play]')).toBeVisible();
    const fit = await page.evaluate(() => {
      const el = (s: string) => {
        const e = document.querySelector(s);
        if (!e) throw new Error(`no ${s}`);
        return e;
      };
      const board = el('#board-wrap').getBoundingClientRect();
      const scroll = el('.builder-scroll');
      const bottom = Math.min(window.innerHeight, window.visualViewport?.height ?? Infinity);
      const small = [...document.querySelectorAll('#tray button')]
        .map((b) => ({ name: b.getAttribute('data-tool') ?? b.getAttribute('data-par') ?? b.getAttribute('data-act') ?? '', r: b.getBoundingClientRect() }))
        .filter(({ r }) => r.width < 44 || r.height < 44 || r.bottom > bottom + 0.5 || r.top < -0.5)
        .map(({ name, r }) => `${name} ${String(Math.round(r.width))}x${String(Math.round(r.height))}@${String(Math.round(r.top))}`);
      return { cell: board.width / 13, hidden: scroll.scrollHeight - scroll.clientHeight, small };
    });
    expect(fit.cell, 'board square in CSS px').toBeGreaterThanOrEqual(18);
    expect(fit.hidden, 'tray panel scrolled out of sight').toBeLessThanOrEqual(0);
    expect(fit.small, 'tray buttons under 44px or off the screen').toEqual([]);
    expect(errors).toEqual([]);
  });
});
