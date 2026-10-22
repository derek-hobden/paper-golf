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

/** What the rain has pencilled on its canvas right now: how many pixels, and where (so two reads can be compared). */
const inked = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('canvas.board-rain');
    if (!(c instanceof HTMLCanvasElement)) return { n: -1, where: -1 };
    const g = c.getContext('2d');
    if (!g) return { n: -1, where: -1 };
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let where = 0;
    for (let i = 3; i < d.length; i += 4) {
      const a = d[i] ?? 0;
      if (a > 0) {
        n++;
        where = (where + i * a) % 1_000_003;
      }
    }
    return { n, where };
  });

/** Wait until the rain canvas has stopped resizing: the same size four reads (400ms) running. */
async function settled(page: Page) {
  const size = () =>
    page.locator('canvas.board-rain').evaluate((c) => (c instanceof HTMLCanvasElement ? `${String(c.width)}x${String(c.height)}` : ''));
  let last = '';
  for (let stable = 0; stable < 4; ) {
    const now = await size();
    stable = now !== '' && now === last ? stable + 1 : 0;
    last = now;
    await page.waitForTimeout(100);
  }
}

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

test.describe('full motion', { tag: '@webkit' }, () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a rainy hole streaks the board and keeps falling; a dry one is blank', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(RAIN_WIND);
    await expect(page.locator('#hud .rain')).toHaveText('Rain');
    await expect.poll(async () => (await inked(page)).n).toBeGreaterThan(200);
    // It falls: two reads a moment apart have the streaks somewhere else.
    const a = await inked(page);
    await page.waitForTimeout(300);
    expect((await inked(page)).where).not.toBe(a.where);
    // The streaks are over the board but never in the way of a tap: the canvas is last and takes no pointer events.
    expect(await page.locator('canvas.board-rain').evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    expect(await page.evaluate(() => document.querySelector('#board-wrap')?.lastElementChild?.className)).toBe('board-rain');

    await page.goto(DRY);
    await expect(page.locator('#hud')).toContainText('Hole 7');
    await page.waitForTimeout(400);
    expect((await inked(page)).n).toBe(0);
    expect(errors).toEqual([]);
  });
});

test('reduced motion: the shower is drawn, and stands still', { tag: '@webkit' }, async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(RAIN_CALM);
  await expect(page.locator('#hud .rain')).toHaveText('Rain');
  await expect.poll(async () => (await inked(page)).n).toBeGreaterThan(200);
  // A still shower is redrawn whenever the board is re-fitted (late web fonts move the layout), so wait for the
  // canvas to stop resizing first; after that nothing moves it.
  await settled(page);
  const a = await inked(page);
  await page.waitForTimeout(500);
  expect(await inked(page)).toEqual(a);
  expect(errors).toEqual([]);
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
