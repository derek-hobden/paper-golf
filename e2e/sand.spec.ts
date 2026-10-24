import { expect, test, type Page } from '@playwright/test';
import { cellAt, diceDistance } from '../src/engine/rules';
import { currentBall, currentHole, holeRain, newGame, type GameState } from '../src/game/game';
import { sandShotDie, shotIntoBunker } from '../tests/helpers';
import { watchConsole } from './console';
import { queueDice, rigDice } from './rig';
import { tapMarker } from './tap';

// Landing in a greenside bunker plays as sand: the corner hint reads the sand lie, the roll offers a sand shot
// (the roll less one) and the 1-dot putt, and never the 2- or 3-dot putt the green earns. The bug (Derek, 24 Oct
// 2026): a bunker inside the green's ring counted as green, so the hint said "On the green" and the ball putted.

const KEY_GAME = 'paper-golf:game:v1';

/** A solo round on Meadow Links hole 1, one stroke in, set up to hit into the hole's greenside bunker. */
function bunkerShot(): { g: GameState; die: number; bunker: { x: number; y: number } } {
  const g = newGame(0, ['Player 1']);
  // Dry, so the tray reads the sand lie alone and the sand shot is exactly the roll less one.
  expect(holeRain(g), 'Meadow Links hole 1 is dry at the default seed').toBe(false);
  const { from, die, bunker } = shotIntoBunker(g);
  currentBall(g).pos = { ...from };
  currentBall(g).strokes = 1;
  expect(cellAt(currentHole(g), bunker).t, 'the shot ends in sand').toBe('sand');
  return { g, die, bunker };
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

const dot = (p: { x: number; y: number }) => `${String(p.x + 0.5)},${String(p.y + 0.5)}`;

test.describe('a ball that comes to rest in sand', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('reads as sand and plays a sand shot, never a putt on the green', async ({ page }) => {
    const errors = watchConsole(page);
    const { g, die, bunker } = bunkerShot();
    const hole = currentHole(g);
    await rigDice(page);
    await continueRound(page, g);

    // Hit into the bunker.
    await queueDice(page, die);
    await page.locator('#tray [data-act=roll]').click();
    await tapMarker(page, page.locator(`g.target.hit:has(circle.hit[cx="${String(bunker.x + 0.5)}"][cy="${String(bunker.y + 0.5)}"])`).first());
    await expect(page.locator('#hud .chip .hand').first()).toHaveText('2');
    const ball = await page
      .locator('.balls g.ball circle')
      .evaluateAll((cs) => cs.map((c) => `${String(Number(c.getAttribute('cx')))},${String(Number(c.getAttribute('cy')))}`));
    expect(ball).toEqual([dot(bunker)]);

    // The corner hint: the sand lie, not the green.
    const hint = page.locator('#tray .status small');
    await expect(hint).toContainText('In the sand: −1');
    await expect(hint).not.toContainText('green');

    // The next roll is a sand shot of the roll less one, plus the 1-dot putt: no 2- or 3-dot putt.
    const sandDie = sandShotDie(g, bunker);
    await queueDice(page, sandDie);
    await page.locator('#tray [data-act=roll]').click();
    await expect(page.locator('#tray .status')).toContainText('rolled');
    const hit = diceDistance(hole, bunker, sandDie);
    expect(hit).toBe(sandDie - 1);
    await expect(page.locator('#tray .status small')).toContainText(`Hit ${String(hit)} (${String(sandDie)}−1)`);
    await expect(page.locator('g.target.hit').first()).toBeVisible();
    const putts = await page.locator('g.target.putt').evaluateAll((gs) => gs.map((el) => el.getAttribute('aria-label') ?? ''));
    expect(putts.every((label) => label.startsWith('Putt 1'))).toBe(true);
    const hits = await page.locator('g.target.hit').evaluateAll((gs) => gs.map((el) => el.getAttribute('aria-label') ?? ''));
    expect(hits.every((label) => label.startsWith(`Hit ${String(hit)}`))).toBe(true);

    // And the sand shot plays: the ball leaves the bunker.
    await tapMarker(page, page.locator('g.target.hit').first());
    await expect(page.locator('#hud .chip .hand').first()).toHaveText('3');
    const after = await page
      .locator('.balls g.ball circle')
      .evaluateAll((cs) => cs.map((c) => `${String(Number(c.getAttribute('cx')))},${String(Number(c.getAttribute('cy')))}`));
    expect(after).not.toEqual([dot(bunker)]);
    expect(errors).toEqual([]);
  });
});
