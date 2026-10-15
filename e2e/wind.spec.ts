import { expect, test, type Page } from '@playwright/test';
import { movesForRoll } from '../src/engine/rules';
import { CALM, type Wind } from '../src/engine/types';
import { windLabel, windReading } from '../src/engine/wind';
import { currentBall, currentHole, newGame, type GameState } from '../src/game/game';
import { dirs, windOnlyHoleOut } from '../tests/helpers';
import { queueDice, rigDice } from './rig';

// Wind: the HUD reads the hole's wind ("Wind N 2", or Calm; no arrows anywhere), every blown shot's line curves from
// the ball onto its marker on the wind-adjusted square, and a roll whose wind-blown hit ends in the cup plays itself.

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

const KEY_GAME = 'paper-golf:game:v1';
/** Set to a directory to save wind-hud.png and wind-curves.png there. */
const SHOTS = process.env.WIND_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function continueRound(page: Page, g: GameState) {
  await page.goto('/');
  await page.evaluate(([k, v]) => {
    localStorage.setItem(k, v);
  }, [KEY_GAME, JSON.stringify(g)] as const);
  await page.reload();
  await page.locator('#cover [data-act=continue]').click();
  await expect(page.locator('#hud')).toContainText('Hole 1');
}

/** A round on its tee with the strength-2 crosswind that bends the most hits of a rolled 4 (at least two). */
function windyTee(): { g: GameState; die: number } {
  const g = newGame(0, ['Player 1']);
  const hole = currentHole(g);
  const tee = currentBall(g).pos;
  // The crosswind that bends the most tee shots (a tail- or headwind blows a shot along its own line).
  const bent = (wind: Wind) =>
    movesForRoll(hole, tee, 4, wind).filter((m) => m.kind === 'hit' && m.result.blown && !m.result.holed && m.dir % 4 !== wind.dir % 4).length;
  const winds = dirs.map((dir): Wind => ({ strength: 2, dir }));
  const best = winds.reduce((a, b) => (bent(b) > bent(a) ? b : a));
  if (bent(best) < 2) throw new Error('no wind that bends the tee shots');
  g.wind = best;
  return { g, die: 4 };
}

test.describe('phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the HUD shows the wind, or Calm', async ({ page }) => {
    const errors = watchErrors(page);
    const calm = newGame(0, ['Player 1']);
    calm.wind = CALM;
    await continueRound(page, calm);
    await expect(page.locator('#hud .wind')).toHaveText('Calm');

    const { g } = windyTee();
    const w = g.wind ?? CALM;
    await continueRound(page, g);
    const hud = page.locator('#hud .wind');
    await expect(hud).toBeVisible();
    await expect(hud).toHaveText(windLabel(w));
    await expect(hud.locator('.hand')).toHaveText(windReading(w));
    await expect(hud.locator('svg')).toHaveCount(0);
    await expect(page.locator('#page')).not.toContainText(/[↑↗→↘↓↙←↖]/);
    const box = await hud.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 390).toBe(true);
    await page.waitForTimeout(900); // let the cover finish opening for the screenshot
    await shot(page, 'wind-hud');
    expect(errors).toEqual([]);
  });

  test('blown shot lines curve from the ball onto markers on the wind-adjusted squares', async ({ page }) => {
    const errors = watchErrors(page);
    await rigDice(page);
    const { g, die } = windyTee();
    const hole = currentHole(g);
    const key = (p: { x: number; y: number }) => `${String(p.x + 0.5)},${String(p.y + 0.5)}`;
    const hits = movesForRoll(hole, currentBall(g).pos, die, g.wind).filter((m) => m.kind === 'hit');
    const expected = hits.map((m) => key(m.result.end)).sort();
    const blownEnds = [...new Set(hits.filter((m) => m.result.blown).map((m) => key(m.result.end)))].sort();
    expect(blownEnds.length).toBeGreaterThanOrEqual(2);
    await continueRound(page, g);
    await queueDice(page, die);
    await page.locator('#tray [data-act=roll]').click();
    await expect(page.locator('g.target.hit').first()).toBeVisible();
    const shown = await page
      .locator('g.target.hit circle.hit')
      .evaluateAll((cs) => cs.map((c) => `${String(Number(c.getAttribute('cx')))},${String(Number(c.getAttribute('cy')))}`));
    expect(shown.sort()).toEqual([...new Set(expected)]);
    // One curve per blown marker: a quadratic from the ball's centre that ends exactly on that marker.
    const ball = key(currentBall(g).pos);
    const curves = await page
      .locator('.targets path.wind-curve')
      .evaluateAll((ps) => ps.map((p) => (p.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []));
    expect(curves.length).toBe(blownEnds.length);
    let bent = 0;
    for (const n of curves) {
      expect(n.length).toBe(6);
      expect(`${String(n[0])},${String(n[1])}`).toBe(ball);
      expect(blownEnds).toContain(`${String(n[4])},${String(n[5])}`);
      // Bent: the control point is off the straight line from the ball to the end (a tail- or headwind stays straight).
      const [x0 = 0, y0 = 0, cx = 0, cy = 0, x1 = 0, y1 = 0] = n;
      if (Math.abs((x1 - x0) * (cy - y0) - (y1 - y0) * (cx - x0)) > 0.1) bent++;
    }
    expect(bent).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#board-wrap')).not.toContainText(/[↑↗→↘↓↙←↖]/);
    await page.waitForTimeout(300);
    await shot(page, 'wind-curves');
    expect(errors).toEqual([]);
  });

  test('a roll the wind blows into the cup plays itself, no tap', async ({ page }) => {
    const errors = watchErrors(page);
    await rigDice(page);
    await page.addInitScript(() => {
      document.addEventListener(
        'click',
        (e) => {
          if (e.target instanceof Element && e.target.closest('g.target')) {
            const root = document.documentElement;
            root.dataset.taps = String(Number(root.dataset.taps ?? '0') + 1);
          }
        },
        true,
      );
    });
    const g = newGame(0, ['Player 1']);
    const s = windOnlyHoleOut(g);
    currentBall(g).pos = { ...s.pos };
    currentBall(g).strokes = 1;
    g.wind = s.wind;
    await continueRound(page, g);
    await queueDice(page, s.die);
    await page.locator('#tray [data-act=roll]').click();
    await expect(page.locator('#banner')).toContainText('Player 1 · 2 strokes');
    await expect(page.locator('.hole-card')).toBeVisible();
    const saved = await page.evaluate((k) => {
      const st = JSON.parse(localStorage.getItem(k) ?? 'null') as { balls: { holed: boolean; strokes: number }[] } | null;
      return st?.balls[0];
    }, KEY_GAME);
    expect(saved).toEqual(expect.objectContaining({ holed: true, strokes: 2 }));
    expect(await page.evaluate(() => document.documentElement.dataset.taps ?? '0')).toBe('0');
    expect(errors).toEqual([]);
  });
});

test.describe('phone on its side (844x390)', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('the wind stays in the HUD when the course name is hidden', async ({ page }) => {
    const errors = watchErrors(page);
    const { g } = windyTee();
    await continueRound(page, g);
    await expect(page.locator('#hud .course')).toBeHidden();
    const wind = page.locator('#hud .wind');
    await expect(wind).toBeVisible();
    const box = await wind.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= 390 && box.x + box.width <= 844).toBe(true);
    expect(errors).toEqual([]);
  });
});
