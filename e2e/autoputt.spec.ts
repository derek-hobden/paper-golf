import { expect, test, type Page } from '@playwright/test';
import { dotsApart, isLandable, puttMoves } from '../src/engine/rules';
import { DIRS, type P } from '../src/engine/types';
import { currentBall, currentHole, newGame, type GameState } from '../src/game/game';
import { offLineTwoDotSpot, spotNextToCup } from '../tests/helpers';

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

const KEY_GAME = 'paper-golf:game:v1';
const SHOTS = 'docs/autoputt-shots';

/** A one-player round on course 1, hole 1, two strokes in, with the ball resting next to the cup. */
function tapInRound(): GameState {
  const g = newGame(0, ['Player 1']);
  currentBall(g).pos = { ...spotNextToCup(g).pos };
  currentBall(g).strokes = 2;
  return g;
}

const DIR_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

/**
 * The same round with the ball 2 dots out on the green, straight in line with the cup, and `die` already rolled.
 * `aim` is the direction word of the line to the cup.
 */
function greenRound(die: number): { g: GameState; aim: string } {
  const g = newGame(0, ['Player 1']);
  const hole = currentHole(g);
  for (const [i, d] of DIRS.entries()) {
    const p: P = { x: hole.cup.x - 2 * d.x, y: hole.cup.y - 2 * d.y };
    if (dotsApart(p, hole.cup) === 2 && isLandable(hole, p) && puttMoves(hole, p, 2).some((m) => m.result.holed)) {
      currentBall(g).pos = p;
      currentBall(g).strokes = 1;
      g.dice = { value: die, teeRerolled: false };
      return { g, aim: DIR_WORDS[i] ?? '' };
    }
  }
  throw new Error('no 2-dot putt on hole 1');
}

/**
 * The ball 2 dots out on the green but off every line to the cup (a knight's move away), so no putt can hole and
 * the roll's targets are offered (an in-line 2-dot putt on a 2 would hole out by itself).
 */
function offLineGreenRound(die: number): GameState {
  const g = newGame(0, ['Player 1']);
  currentBall(g).pos = offLineTwoDotSpot(g);
  currentBall(g).strokes = 1;
  g.dice = { value: die, teeRerolled: false };
  return g;
}

/** Save `g` as the round in progress and open it with "Continue". */
async function continueRound(page: Page, g: GameState) {
  await page.goto('/');
  await page.evaluate(([k, v]) => {
    localStorage.setItem(k, v);
  }, [KEY_GAME, JSON.stringify(g)] as const);
  await page.reload();
  await page.locator('#cover [data-act=continue]').click();
  await expect(page.locator('#hud')).toContainText('Hole 1');
}

test.describe('phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a ball next to the cup is tapped in without a roll', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    // Count clicks on any Roll button (there should be none).
    await page.addInitScript(() => {
      document.addEventListener(
        'click',
        (e) => {
          if (e.target instanceof Element && e.target.closest('[data-act=roll]')) {
            const root = document.documentElement;
            root.dataset.rolls = String(Number(root.dataset.rolls ?? '0') + 1);
          }
        },
        true,
      );
    });

    await continueRound(page, tapInRound());
    // No tap needed: the putt plays by itself, then the "Tap-in!" banner and the hole card.
    await expect(page.locator('#banner')).toContainText('Tap-in!');
    await expect(page.locator('.hole-card')).toBeVisible();
    await expect(page.locator('#hud .chip .hand').first()).toHaveText('3');
    expect(await page.evaluate(() => document.documentElement.dataset.rolls ?? '0')).toBe('0');
    await expect(page.locator('#tray [data-act=roll]')).toHaveCount(0);

    const last = await page.evaluate((k) => {
      const saved = JSON.parse(localStorage.getItem(k) ?? 'null') as {
        dice: unknown;
        balls: { holed: boolean; shots: { kind: string; dist: number; auto?: boolean }[] }[];
      } | null;
      const ball = saved?.balls[0];
      return { dice: saved?.dice, holed: ball?.holed, shot: ball?.shots.at(-1) };
    }, KEY_GAME);
    expect(last).toEqual({ dice: null, holed: true, shot: expect.objectContaining({ kind: 'putt', dist: 1, auto: true }) });
    expect(errors).toEqual([]);
  });

  test('the green offers a 2-dot putt on a roll of 2 when it cannot hole', async ({ page }) => {
    await continueRound(page, offLineGreenRound(2));
    await expect(page.locator('#tray .status small')).toContainText('On the green: putt 2 or 1');
    await expect(page.locator('g.target.hit')).toHaveCount(0);
    await expect(page.locator('g.target.putt[aria-label^="Putt 2"]').first()).toBeVisible();
    await expect(page.locator('.t-green')).toHaveCount(1);
  });

  // Screenshots for the docs: `npm run build && npm run shots`. Full motion, so "during" shows the putt rolling.
  test.describe('screenshots', () => {
    test.skip(!process.env.SHOTS, 'set SHOTS=1 to refresh docs/autoputt-shots');
    test.use({ reducedMotion: 'no-preference' });

    test('auto-putt and green', async ({ page }) => {
      await continueRound(page, offLineGreenRound(2));
      await expect(page.locator('g.target.putt').first()).toBeVisible();
      await page.waitForTimeout(1500); // let the cover finish swinging open
      await page.screenshot({ path: `${SHOTS}/green-phone.png` });

      // A 4 on the green: only 1-dot putts. Putt toward the cup; the ball stops next to it and the tap-in follows.
      const { g, aim } = greenRound(4);
      await continueRound(page, g);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/0-green-roll-4-phone.png` });
      await page.locator(`g.target.putt[aria-label="Putt 1 ${aim}"] circle.hit`).click();
      await expect(page.locator('#tray .status')).toContainText('tap-in');
      await page.screenshot({ path: `${SHOTS}/1-before-phone.png` });
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${SHOTS}/2-during-phone.png` });
      await expect(page.locator('#banner.show')).toContainText('Tap-in!');
      await page.screenshot({ path: `${SHOTS}/3-after-phone.png` });
      await expect(page.locator('.hole-card')).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/4-hole-card-phone.png` });
    });
  });
});
