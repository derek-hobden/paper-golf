import { expect, test, type Page } from '@playwright/test';
import { diceDistance, inBounds, movesForRoll, rollSlopes } from '../src/engine/rules';
import { CALM } from '../src/engine/types';
import { currentBall, currentHole, holeRain, holeWind, newGame, skipToHole } from '../src/game/game';
import { queueDice, rigDice } from './rig';
import { tapMarker } from './tap';

// Rain: the HUD reads "Rain" beside the wind reading on a rainy hole and says nothing on a dry one, pencil streaks
// fall over the board while it rains (still under reduced motion), and the hole plays wet and heavy — no slope rolls
// the ball on and every hit is one space shorter.
//
// Deep links play the default weather seeds, so these holes are the same every run: Dune Ridge hole 6 is rainy and
// calm, Thunder Peaks hole 14 rainy in a strong wind, and Meadow Links hole 7 dry and calm.
const RAIN_CALM = '/?play=2&players=1&hole=6';
const RAIN_WIND = '/?play=4&players=1&hole=14';
const DRY = '/?play=0&players=1&hole=7';

/**
 * What a weather canvas has drawn right now: how many pixels, where (so two reads can be compared), how much of the
 * canvas they cover, and how blue they are (blue minus red, averaged over them).
 */
const drawn = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const c = document.querySelector(sel);
    if (!(c instanceof HTMLCanvasElement)) return { n: -1, where: -1, share: -1, blue: -1 };
    const g = c.getContext('2d');
    if (!g) return { n: -1, where: -1, share: -1, blue: -1 };
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let where = 0;
    let blue = 0;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3] ?? 0;
      if (a > 0) {
        n++;
        where = (where + (i + 3) * a) % 1_000_003;
        blue += (d[i + 2] ?? 0) - (d[i] ?? 0);
      }
    }
    return { n, where, share: n / (c.width * c.height), blue: n > 0 ? blue / n : 0 };
  }, selector);

/** What the rain has pencilled on the board's canvas. */
const inked = (page: Page) => drawn(page, 'canvas.board-rain');

/** What the droplets have drawn on the lens over the whole game view. */
const lensInk = (page: Page) => drawn(page, 'canvas#lens');

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

/**
 * The rainy hole the play test uses: Dune Ridge hole 6 at the default weather seeds (rainy and calm), where a rolled
 * 4 has a hit that comes down on a slope — one space shorter than the dry hole's hit, and left where it lands.
 */
function rainyTeeShot() {
  const g = newGame(2, ['Player 1']);
  skipToHole(g, 5);
  expect(holeRain(g), 'Dune Ridge hole 6 is rainy at the default seed').toBe(true);
  expect(holeWind(g)).toEqual(CALM);
  const hole = currentHole(g);
  const tee = currentBall(g).pos;
  const die = 4;
  const wet = movesForRoll(hole, tee, die, CALM, true);
  const dry = movesForRoll(hole, tee, die);
  // The hit the slope would have rolled on in the dry.
  const onSlope = wet.find(
    (m) => m.kind === 'hit' && inBounds(hole, m.result.end) && rollSlopes(hole, m.result.end).path.length > 0,
  );
  expect(onSlope, 'a rainy hit that comes to rest on a slope').toBeDefined();
  return { hole, tee, die, wet, dry, onSlope };
}

const dot = (p: { x: number; y: number }) => `${String(p.x + 0.5)},${String(p.y + 0.5)}`;

test.describe('playing a rainy hole', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('offers the shorter hits and leaves the ball where it lands', { tag: '@webkit' }, async ({ page }) => {
    const errors = watchErrors(page);
    const { hole, die, wet, dry, onSlope } = rainyTeeShot();
    if (!onSlope) throw new Error('no rainy hit resting on a slope');
    await rigDice(page);
    await page.goto(RAIN_CALM);
    await expect(page.locator('#hud .rain')).toHaveText('Rain');
    // The tray reads the lie and the rain together before the roll.
    await expect(page.locator('#tray')).toContainText('rain: −1');
    await queueDice(page, die);
    await page.locator('#tray [data-act=roll]').click();
    await expect(page.locator('g.target.hit').first()).toBeVisible();
    // Heavy air: the hits on the page are the rain's, one space shorter than the dry hole's, and the tray says so.
    const hits = wet.filter((m) => m.kind === 'hit');
    expect(hits.every((m) => m.dist === diceDistance(hole, hole.tee, die) - 1)).toBe(true);
    const shown = await page
      .locator('g.target.hit circle.hit')
      .evaluateAll((cs) => cs.map((c) => `${String(Number(c.getAttribute('cx')))},${String(Number(c.getAttribute('cy')))}`));
    expect(shown.sort()).toEqual([...new Set(hits.map((m) => dot(m.result.end)))].sort());
    expect(shown.sort()).not.toEqual([...new Set(dry.filter((m) => m.kind === 'hit').map((m) => dot(m.result.end)))].sort());
    await expect(page.locator('#tray')).toContainText(`Hit ${String(diceDistance(hole, hole.tee, die) - 1)}`);

    // Wet ground: tap the hit that comes down on a slope; it stays on that dot, with no dashed roll line behind it.
    const rolledTo = rollSlopes(hole, onSlope.result.end).path;
    expect(rolledTo.length).toBeGreaterThan(0);
    await tapMarker(page, page.locator(`g.target.hit:has(circle.hit[cx="${String(onSlope.result.end.x + 0.5)}"][cy="${String(onSlope.result.end.y + 0.5)}"])`));
    await expect(page.locator('#hud .chip .hand').first()).toHaveText('1');
    const ball = await page
      .locator('.balls g.ball circle')
      .evaluateAll((cs) => cs.map((c) => `${String(Number(c.getAttribute('cx')))},${String(Number(c.getAttribute('cy')))}`));
    expect(ball).toEqual([dot(onSlope.result.end)]);
    expect(ball).not.toContain(dot(rolledTo[rolledTo.length - 1] ?? onSlope.result.end));
    expect(await page.locator('.shots path[stroke-dasharray]').count()).toBe(0);
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
    // Rain blue, not pencil grey: the streaks are drawn well on the blue side of neutral.
    expect((await inked(page)).blue).toBeGreaterThan(30);
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

// Droplets on the camera lens: on a rainy hole the occasional bead lands on one canvas over the whole game view, sits
// still for a moment and runs down the screen. Never on a dry hole, never on a menu, never under reduced motion, and
// never in the way of a tap.
test.describe('droplets on the lens', { tag: '@webkit' }, () => {
  test.use({ reducedMotion: 'no-preference' });

  test('bead the lens on a rainy hole and run down it; a dry hole has none', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(RAIN_WIND);
    await expect(page.locator('#hud .rain')).toHaveText('Rain');
    await expect.poll(async () => (await lensInk(page)).n, { timeout: 15_000 }).toBeGreaterThan(20);
    // Subtle: a few small beads, never a sheet of water over the game.
    expect((await lensInk(page)).share).toBeLessThan(0.03);
    // They run: a bead clings for a moment, then the lens looks different.
    const a = await lensInk(page);
    await expect.poll(async () => (await lensInk(page)).where, { timeout: 15_000 }).not.toBe(a.where);

    await page.goto(DRY);
    await expect(page.locator('#hud')).toContainText('Hole 7');
    await page.waitForTimeout(1200);
    expect((await lensInk(page)).n).toBe(0);
    expect(errors).toEqual([]);
  });

  test('never on the scorecard, the rules or the cover', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(RAIN_CALM);
    await expect.poll(async () => (await lensInk(page)).n, { timeout: 15_000 }).toBeGreaterThan(20);
    for (const act of ['card', 'rules'] as const) {
      await page.locator(`#tray [data-act=${act}]`).click();
      await expect(page.locator('.sheet [data-act=back]')).toBeVisible();
      await page.waitForTimeout(700);
      expect((await lensInk(page)).n, `no droplets on the ${act} screen`).toBe(0);
      await page.locator('.sheet [data-act=back]').click();
      await expect(page.locator('#hud')).toBeVisible();
    }
    await page.locator('#tray [data-act=home]').click();
    await expect(page.locator('#cover [data-act=new]')).toBeVisible();
    await page.waitForTimeout(700);
    expect((await lensInk(page)).n, 'no droplets on the cover').toBe(0);
    expect(errors).toEqual([]);
  });

  test('never take a tap: the lens is over the game but not in front of it', async ({ page }) => {
    const errors = watchErrors(page);
    await rigDice(page);
    await page.goto(RAIN_CALM);
    await expect.poll(async () => (await lensInk(page)).n, { timeout: 15_000 }).toBeGreaterThan(20);
    const lens = page.locator('canvas#lens');
    expect(await lens.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    // Nothing on the screen is behind it, wherever the beads are: the roll button still takes the tap.
    expect(
      await page.evaluate(() =>
        [
          [window.innerWidth / 2, window.innerHeight / 2],
          [window.innerWidth / 2, window.innerHeight * 0.2],
          [window.innerWidth / 2, window.innerHeight * 0.8],
        ].map(([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.id ?? ''),
      ),
    ).not.toContain('lens');
    await queueDice(page, 4);
    await page.locator('#tray [data-act=roll]').click();
    await expect(page.locator('g.target.hit').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('reduced motion: the lens stays clear', async ({ page }) => {
    const errors = watchErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(RAIN_CALM);
    await expect(page.locator('#hud .rain')).toHaveText('Rain');
    // The rain itself is still drawn (one still shower), the lens is not.
    await expect.poll(async () => (await inked(page)).n).toBeGreaterThan(200);
    await page.waitForTimeout(2000);
    expect((await lensInk(page)).n).toBe(0);
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
