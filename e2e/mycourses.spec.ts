import { expect, test, type Page } from '@playwright/test';
import { GRID_H, GRID_W } from '../src/engine/generator';
import { newGame } from '../src/game/game';
import { watchConsole } from './console';
import { tapMarker } from './tap';

// Saving the holes you draw, putting a course of 18 together out of built-in and saved holes, and practising one
// hole: My holes & courses and Practice from the title screen. A practice round counts towards nothing — it leaves
// the round in progress and the course bests exactly as they were.

const KEY_GAME = 'paper-golf:game:v1';
const KEY_BEST = 'paper-golf:best:v1';
const KEY_LIB = 'paper-golf:library:v1';

async function cellPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('svg.board-play').boundingBox();
  expect(box, 'board').not.toBeNull();
  if (!box) return { x: 0, y: 0 };
  return { x: box.x + ((x + 0.5) / GRID_W) * box.width, y: box.y + ((y + 0.5) / GRID_H) * box.height };
}

async function paint(page: Page, x: number, y: number, x2 = x, y2 = y) {
  const a = await cellPoint(page, x, y);
  const b = await cellPoint(page, x2, y2);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
}

/** A clean first visit on the title screen. */
async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(page.locator('#cover [data-act=new]')).toBeVisible();
}

/** Draw a playable par-5 hole in the builder and save it as `name`. */
async function drawAndSave(page: Page, name: string) {
  await page.locator('#cover [data-act=build]').click();
  await expect(page.locator('#hud')).toContainText('Build a hole');
  await page.locator('[data-par="5"]').click();
  await page.locator('[data-tool=fairway]').click();
  await paint(page, 6, 16, 6, 12);
  await page.locator('[data-tool=tee]').click();
  await paint(page, 6, 16);
  await page.locator('[data-tool=pin]').click();
  await paint(page, 6, 12);
  await expect(page.locator('#builder-step')).toHaveText('Ready — tap Play this hole');

  await page.locator('#tray [data-act=save]').click();
  const ask = page.locator('.hole-card.ask');
  await expect(ask).toBeVisible();
  await ask.locator('#ask-name').fill(name);
  await ask.locator('[data-act=ok]').click();
  await expect(ask).toHaveCount(0);
  await expect(page.locator('#banner')).toContainText('Saved');
}

/** Roll and tap until the hole card. A putt is always on offer, and a hole-out plays itself. */
async function playToCard(page: Page) {
  const roll = page.locator('#tray [data-act=roll]:enabled');
  const card = page.locator('.hole-card');
  for (let turn = 0; turn < 14; turn += 1) {
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

test.describe('saved holes', { tag: '@webkit' }, () => {
  test('saves a hole from the builder, re-opens it, renames it and deletes it', async ({ page }) => {
    const errors = watchConsole(page);
    await fresh(page);
    await drawAndSave(page, 'Windy corner');

    // Back from a hole opened out of My holes returns to that list; from the builder itself, to the title screen.
    await page.locator('#tray [data-act=back]').click();
    await page.locator('#tray [data-act=back]').click();
    await page.locator('#cover [data-act=library]').click();
    await expect(page.locator('.sheet h2')).toHaveText('My holes & courses');
    await expect(page.locator('.list-row')).toHaveCount(1);
    await expect(page.locator('.list-name')).toContainText('Windy corner');
    await expect(page.locator('.list-name')).toContainText('Par 5');

    // Open puts the hole back in the builder, par and all, and saving again keeps one hole, not two.
    await page.locator('[data-open]').click();
    await expect(page.locator('#hud')).toContainText('Par 5');
    await expect(page.locator('.cup-rim')).toBeVisible();
    await page.locator('#tray [data-act=save]').click();
    await page.locator('.hole-card.ask [data-act=ok]').click();
    await expect(page.locator('#banner')).toContainText('Saved');
    await page.locator('#tray [data-act=back]').click();
    await expect(page.locator('.sheet h2')).toHaveText('My holes & courses');
    await expect(page.locator('.list-row')).toHaveCount(1);

    await page.locator('[data-rename-hole]').click();
    await page.locator('.hole-card.ask #ask-name').fill('Dog leg');
    await page.locator('.hole-card.ask [data-act=ok]').click();
    await expect(page.locator('.list-name')).toContainText('Dog leg');

    // Delete asks once, then does it.
    await page.locator('[data-del]').click();
    await expect(page.locator('#library-note')).toContainText('Tap Delete again');
    await expect(page.locator('[data-del]')).toHaveText('Sure?');
    await page.locator('[data-del]').click();
    await expect(page.locator('.sheet .empty')).toContainText('No saved holes yet');
    expect(errors).toEqual([]);
  });
});

test.describe('custom courses', { tag: '@webkit' }, () => {
  test('builds an 18-hole course from built-in and saved holes and plays it as a round', async ({ page }) => {
    const errors = watchConsole(page);
    await fresh(page);
    await drawAndSave(page, 'My par 5');
    await page.locator('#tray [data-act=back]').click();
    await page.locator('#tray [data-act=back]').click();

    await page.locator('#cover [data-act=library]').click();
    await page.locator('[data-tab=courses]').click();
    await expect(page.locator('.sheet .empty')).toContainText('No courses yet');
    await page.locator('[data-act=new-course]').click();
    await expect(page.locator('.sheet h2')).toHaveText('New course');
    await expect(page.locator('.course-slot')).toHaveCount(18);
    await expect(page.locator('#course-step')).toContainText('Pick 18 holes — 18 to go');

    // Fill all 18 from one built-in course, then swap hole 1 for the saved one and move it to third.
    await page.locator('[data-act=fill]').click();
    await page.locator('.list-row', { hasText: 'Meadow Links' }).locator('[data-pick]').click();
    await expect(page.locator('#course-step')).toContainText('Ready');
    await expect(page.locator('[data-slot="0"]')).toContainText('Meadow Links 1');

    await page.locator('[data-slot="0"]').click();
    await expect(page.locator('.sheet h2')).toHaveText('Hole 1');
    await page.locator('[data-group]', { hasText: 'My holes' }).click();
    await page.locator('[data-pick]', { hasText: 'My par 5' }).click();
    await expect(page.locator('[data-slot="0"]')).toContainText('My par 5');
    await page.locator('[data-down="0"]').click();
    await page.locator('[data-down="1"]').click();
    await expect(page.locator('[data-slot="2"]')).toContainText('My par 5');
    await expect(page.locator('[data-slot="0"]')).toContainText('Meadow Links 2');

    await page.locator('#course-name').fill('Pick & mix');
    await page.locator('[data-act=save-course]').click();
    await expect(page.locator('.sheet h2')).toHaveText('My holes & courses');
    await expect(page.locator('.list-name')).toContainText('Pick & mix');

    // It plays from New round, like any other course, and its card is its own 18 holes.
    await page.locator('.sheet [data-act=back]').click();
    await page.locator('#cover [data-act=new]').click();
    await page.locator('[data-custom]').click();
    await page.locator('[data-act=go]').click();
    await expect(page.locator('#hud')).toContainText('Hole 1');
    await expect(page.locator('#hud')).toContainText('of 18');
    await expect(page.locator('#hud .course')).toHaveText('Pick & mix');
    await page.locator('#tray [data-act=card]').click();
    await expect(page.locator('.card-table th').first()).toHaveText('Pick & mix');
    // Hole 3 is the saved par 5; Proper golf's third hole is a par 3, so this card is the course's own.
    await expect(page.locator('.card-table tbody tr').nth(2)).toContainText('/5');
    await page.locator('.sheet [data-act=back]').click();

    const saved: unknown = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY_GAME)) ?? 'null');
    expect(saved).toMatchObject({ customName: 'Pick & mix' });

    // The round carries on after a reload, and the course still reads as one course in My courses.
    await page.reload();
    await page.locator('#cover [data-act=continue]').click();
    await expect(page.locator('#hud .course')).toHaveText('Pick & mix');
    expect(errors).toEqual([]);
  });

  test('will not play a course whose saved hole has gone', async ({ page }) => {
    const errors = watchConsole(page);
    await fresh(page);
    await page.evaluate(
      ([key, lib]) => {
        localStorage.setItem(key, lib);
      },
      [
        KEY_LIB,
        JSON.stringify({
          version: 1,
          holes: [],
          courses: [
            {
              id: 'c:1',
              name: 'Half a course',
              saved: 1,
              holes: ['s:gone', ...Array.from({ length: 17 }, (_, i) => `b:0:${String(i + 2)}`)],
            },
          ],
        }),
      ] as const,
    );
    await page.reload();
    await page.locator('#cover [data-act=library]').click();
    await page.locator('[data-tab=courses]').click();
    await expect(page.locator('.list-name')).toContainText('1 hole gone');
    await expect(page.locator('[data-play-course]')).toBeDisabled();

    // The setup screen says the same and will not select it.
    await page.locator('.sheet [data-act=back]').click();
    await page.locator('#cover [data-act=new]').click();
    await expect(page.locator('[data-custom]')).toBeDisabled();
    await expect(page.locator('[data-custom]')).toContainText('1 hole gone');

    // Picking a hole for the gone slot makes it playable.
    await page.locator('.sheet [data-act=back]').click();
    await page.locator('#cover [data-act=library]').click();
    await page.locator('[data-tab=courses]').click();
    await page.locator('[data-edit-course]').click();
    await expect(page.locator('[data-slot="0"]')).toContainText('That hole is gone');
    await expect(page.locator('#course-step')).toContainText('A hole in this course is gone');
    await page.locator('[data-slot="0"]').click();
    await page.locator('[data-pick]').first().click();
    await expect(page.locator('#course-step')).toContainText('Ready');
    await page.locator('[data-act=save-course]').click();
    await expect(page.locator('[data-play-course]')).toBeEnabled();
    expect(errors).toEqual([]);
  });
});

test.describe('practice', { tag: '@webkit' }, () => {
  test('plays one hole and leaves the round in progress and the bests alone', async ({ page }) => {
    const errors = watchConsole(page);
    await fresh(page);
    // A hole of its own, so the round plays out the same way every run, and a round and a best to leave alone.
    await drawAndSave(page, 'Practice pad');
    await page.locator('#tray [data-act=back]').click();
    await page.locator('#tray [data-act=back]').click();
    await page.evaluate(
      ([keys, round]) => {
        localStorage.setItem(keys[0], round);
        localStorage.setItem(keys[1], JSON.stringify({ 'proper:0': 80 }));
      },
      [[KEY_GAME, KEY_BEST] as const, JSON.stringify(newGame(0, ['Player 1']))] as const,
    );
    await page.reload();
    const savedRound = await page.evaluate((k) => localStorage.getItem(k), KEY_GAME);

    await page.locator('#cover [data-act=practice]').click();
    await expect(page.locator('.sheet h2')).toHaveText('Practice');
    // Any number of players, and any hole: a built-in one, or one of your own.
    await page.locator('[data-count="1"]').click();
    await expect(page.locator('.stepper .hand')).toHaveText('2');
    await page.locator('[data-count="-1"]').click();
    await expect(page.locator('.stepper .hand')).toHaveText('1');
    await page.locator('[data-group]', { hasText: 'My holes' }).click();
    await page.locator('[data-pick]', { hasText: 'Practice pad' }).click();

    await expect(page.locator('#hud .course')).toHaveText('Practice pad');
    await expect(page.locator('#hud')).toContainText('of 1');
    await expect(page.locator('#hud')).toContainText('Par 5');
    await playToCard(page);
    await page.locator('.hole-card [data-act=next]').click();
    await expect(page.locator('.sheet .card-table th').first()).toHaveText('Practice pad');

    // Play again deals the same hole afresh; neither the saved round nor the bests have moved.
    await page.locator('.sheet [data-act=replay]').click();
    await expect(page.locator('#hud .course')).toHaveText('Practice pad');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY_GAME)).toBe(savedRound);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY_BEST)).toBe(JSON.stringify({ 'proper:0': 80 }));

    // Closing the notebook brings the real round back, on the hole it was left on.
    await page.locator('#tray [data-act=home]').click();
    await expect(page.locator('#cover [data-act=continue]')).toContainText('Hole 1');

    // A built-in hole practises just the same, from its own course's list.
    await page.locator('#cover [data-act=practice]').click();
    await page.locator('[data-group]', { hasText: 'Thunder Peaks' }).click();
    await page.locator('[data-pick="b:4:11"]').click();
    await expect(page.locator('#hud .course')).toHaveText('Thunder Peaks 11');
    await expect(page.locator('#hud')).toContainText('of 1');
    expect(errors).toEqual([]);
  });
});
