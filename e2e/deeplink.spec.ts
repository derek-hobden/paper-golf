import { expect, test } from '@playwright/test';

// B7: a ?hole= deep link above 12 (or 0, negative, junk) used to spin forever in the boot loop and freeze the tab.
test.describe('phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  const cases: [query: string, hole: number][] = [
    ['?play=0&players=1&hole=13', 12],
    ['?play=9&players=1&hole=99', 12],
    ['?play=0&players=1&hole=0', 1],
    ['?play=0&players=1&hole=-4', 1],
    ['?play=0&players=1&hole=abc', 1],
  ];

  for (const [query, hole] of cases) {
    test(`deep link ${query} opens hole ${String(hole)} and stays responsive`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
      });
      page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

      await page.goto(query, { timeout: 5_000 });
      await expect(page.locator('#hud')).toContainText(`Hole ${String(hole)}`, { timeout: 5_000 });
      // The main thread answers: a frozen tab never resolves this.
      const frame = await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            requestAnimationFrame(() => {
              resolve(1);
            });
          }),
      );
      expect(frame).toBe(1);
      await expect(page.locator('#tray [data-act=roll]')).toBeEnabled({ timeout: 5_000 });
      expect(errors).toEqual([]);
    });
  }
});
