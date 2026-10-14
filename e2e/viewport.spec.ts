import { expect, test, type Locator, type Page } from '@playwright/test';

// B4: phones on their side got the desktop layout, taller than the screen, with the tray cut off and no way to
// scroll. On a phone, in either orientation, the board and the tray (die and buttons) must sit fully inside the
// viewport and a roll must work.

async function expectInside(page: Page, el: Locator) {
  const vp = page.viewportSize();
  const box = await el.boundingBox();
  expect(vp).not.toBeNull();
  expect(box).not.toBeNull();
  if (!vp || !box) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
}

async function rollFitsTheScreen(page: Page) {
  await page.goto('/?play=0&players=1&hole=1');
  await expect(page.locator('#hud')).toContainText('Hole 1');

  const tray = page.locator('#tray');
  const board = page.locator('#board-wrap');
  await expectInside(page, tray);
  await expectInside(page, board);
  await expectInside(page, page.locator('#tray .die-slot'));
  // Nothing hidden below the fold of a page that cannot scroll.
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
    page.viewportSize()?.height ?? 0,
  );

  const rollButton = page.locator('#tray [data-act=roll]');
  await expectInside(page, rollButton);
  await rollButton.tap();
  await expect(page.locator('#tray .status')).toContainText('rolled');
  const target = page.locator('g.target.hit').or(page.locator('g.target.putt')).first();
  await expect(target).toBeVisible();
  await expectInside(page, target);
  await expectInside(page, tray);
}

for (const [width, height] of [
  [844, 390],
  [852, 393],
  [390, 844],
] as const) {
  test.describe(`phone ${String(width)}x${String(height)}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });

    test('board and tray fit the viewport and a roll can be made', async ({ page }) => {
      await rollFitsTheScreen(page);
    });
  });
}
