import { expect, test } from '@playwright/test';

// B3 + B4 together: on a phone on its side the HUD keeps the player chips on one scrolling row. With 4 players the
// row is wider than the page, and with `justify-content: flex-end` it overflowed to the left, where it can't be
// scrolled: players 1-3 were cut off. Every chip must be reachable by scrolling the row, starting with player 1.

test.describe('4 players on an 844x390 phone', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('every player chip can be scrolled into view', async ({ page }) => {
    await page.goto('/?play=0&players=4&hole=1');
    await expect(page.locator('#hud')).toContainText('Hole 1');
    const chips = page.locator('#hud .chips');
    await expect(page.locator('#hud .chip')).toHaveCount(4);
    for (const i of [0, 1, 2, 3]) {
      const chip = page.locator('#hud .chip').nth(i);
      await chip.scrollIntoViewIfNeeded();
      const row = await chips.boundingBox();
      const box = await chip.boundingBox();
      expect(row).not.toBeNull();
      expect(box).not.toBeNull();
      if (!row || !box) return;
      expect(box.x, `chip ${String(i + 1)}`).toBeGreaterThanOrEqual(row.x - 0.5);
      expect(box.x + box.width, `chip ${String(i + 1)}`).toBeLessThanOrEqual(row.x + row.width + 0.5);
    }
  });
});
