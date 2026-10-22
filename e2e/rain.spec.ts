import { expect, test, type Page } from '@playwright/test';

// Rain: the HUD reads "Rain" beside the wind reading on a rainy hole and says nothing on a dry one, pencil streaks
// fall over the board while it rains (still under reduced motion), and the hole plays wet and heavy — no slope rolls
// the ball on and every hit is one space shorter.
//
// Deep links play the default weather seeds, so these holes are the same every run: Dune Ridge hole 6 is rainy and
// calm, Thunder Peaks hole 14 rainy in a strong wind, and Meadow Links hole 7 dry and calm.
const RAIN_CALM = '/?play=2&players=1&hole=6';
const RAIN_WIND = '/?play=4&players=1&hole=14';
const DRY = '/?play=0&players=1&hole=7';

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

test.describe('phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the HUD reads Rain beside the wind, and nothing on a dry hole', { tag: '@webkit' }, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(RAIN_WIND);
    await expect(page.locator('#hud')).toContainText('Hole 14');
    const rain = page.locator('#hud .rain');
    await expect(rain).toHaveText('Rain');
    await expect(rain.locator('.hand')).toHaveText('Rain');
    await expect(page.locator('#hud .wind')).toHaveText('Wind E 2');
    // Inside the page, and before the wind reading in the HUD's one line.
    const box = await rain.boundingBox();
    const wind = await page.locator('#hud .wind').boundingBox();
    expect(box && wind && box.x >= 0 && box.x + box.width <= wind.x + 1).toBe(true);

    await page.goto(RAIN_CALM);
    await expect(page.locator('#hud .rain')).toHaveText('Rain');
    await expect(page.locator('#hud .wind')).toHaveText('Calm');

    await page.goto(DRY);
    await expect(page.locator('#hud')).toContainText('Hole 7');
    await expect(page.locator('#hud .rain')).toHaveCount(0);
    await expect(page.locator('#hud')).not.toContainText('Rain');
    expect(errors).toEqual([]);
  });
});

test.describe('phone on its side (844x390)', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('the rain stays in the HUD when the course name is hidden', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(RAIN_WIND);
    await expect(page.locator('#hud .course')).toBeHidden();
    const rain = page.locator('#hud .rain');
    await expect(rain).toBeVisible();
    const box = await rain.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 390 && box.x >= 0 && box.x + box.width <= 844).toBe(true);
    // "Rain · E 2": the wind reads short here, the separator between the two stays, and the one that would sit
    // before the hidden course name goes.
    await expect(page.locator('#hud .wind .hand')).toHaveText('E 2');
    const sep = (selector: string) =>
      page.locator(selector).evaluate((e) => {
        const s = getComputedStyle(e, '::before');
        return s.display === 'none' ? 'none' : s.content;
      });
    expect(await sep('#hud .wind')).toBe('"·"');
    expect(await sep('#hud .rain')).toBe('none');
    expect(errors).toEqual([]);
  });
});
