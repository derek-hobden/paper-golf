import { expect, test } from '@playwright/test';
import { currentBall, newGame, nextHole, type GameState } from '../src/game/game';

const KEY_GAME = 'paper-golf:game:v1';

/** A real round in progress: course 3, hole 3, two strokes in. */
function savedRound(): GameState {
  const g = newGame(2, ['Ann']);
  while (g.holeIndex < 2) {
    g.holeDone = true;
    nextHole(g);
  }
  currentBall(g).strokes = 2;
  return g;
}

test.describe('phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('a ?play= link never overwrites the saved round', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    const saved = JSON.stringify(savedRound());
    await page.goto('/');
    await page.evaluate(([k, v]) => {
      localStorage.setItem(k, v);
    }, [KEY_GAME, saved] as const);

    // Deep-link into a fresh round and roll: the roll would save the game.
    await page.goto('/?play=0&players=1');
    await expect(page.locator('#hud')).toContainText('Hole 1');
    await page.locator('#tray [data-act=roll]').click();
    await expect(page.locator('#tray [data-act=roll]')).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY_GAME)).toBe(saved);

    // Back without the param: the original round is still there to continue.
    await page.goto('/');
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY_GAME)).toBe(saved);
    await expect(page.locator('#cover [data-act=continue]')).toHaveText('Continue · Hole 3');
    await page.locator('#cover [data-act=continue]').click();
    await expect(page.locator('#hud')).toContainText('Hole 3');
    await expect(page.locator('#hud .chip .hand').first()).toHaveText('2');
    expect(errors).toEqual([]);
  });

  test('the first painted frame of a ?play= link is the built hole, not a bare cover', async ({ page }) => {
    // rAF callbacks run just before a frame is painted: record what the very first frame would show.
    await page.addInitScript(() => {
      requestAnimationFrame(() => {
        const desk = document.getElementById('desk');
        const shown = desk !== null && getComputedStyle(desk).visibility !== 'hidden';
        document.documentElement.dataset.firstFrame = shown ? (document.getElementById('hud')?.textContent ?? 'no hud') : 'hidden';
      });
    });
    // A slow phone network: the stylesheet is in, the app script arrives late.
    await page.route('**/assets/*.js', async (route) => {
      await new Promise((r) => setTimeout(r, 400));
      await route.continue();
    });
    await page.goto('/?play=0&players=1');
    await expect(page.locator('#hud')).toContainText('Hole 1');
    const first = await page.evaluate(() => document.documentElement.dataset.firstFrame ?? '');
    // Either the desk is held back until main.ts has built the screen, or the frame already shows the right header.
    expect(first === 'hidden' || /Hole 1\s+of 12/.test(first)).toBe(true);
  });
});
