import { expect, test, type Page } from '@playwright/test';
import { dotsApart, isLandable, legalMoves, movesForRoll, onGreen, step } from '../src/engine/rules';
import type { Dir, P } from '../src/engine/types';
import { currentHole, newGame, type GameState } from '../src/game/game';
import { dirs, spotNextToCup } from '../tests/helpers';
import { queueDice, rigDice } from './rig';

// Golf etiquette in a 3-player round over two holes: the ball furthest away plays (the same player twice running),
// players tap in by distance, then the winner of hole 1 has the honour on hole 2. The round is a save from the old
// round-robin turns (current = Player 1), so it also checks a saved round picks up with the player who is away.

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

const KEY_GAME = 'paper-golf:game:v1';
/** Set to a directory to save away.png and honour.png there. */
const SHOTS = process.env.TURN_SHOTS;
const DIR_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** A straight line into the cup: spots 4, 3 and 2 dots out, where a rolled 1 only putts and 1-dot putts walk it in. */
function lineToCup(g: GameState): { spots: P[]; dir: Dir } {
  const hole = currentHole(g);
  for (const dir of dirs) {
    const back = ((dir + 4) % 8) as Dir;
    const spots = [4, 3, 2].map((k) => step(hole.cup, back, k));
    if (!spots.every((p, i) => isLandable(hole, p) && dotsApart(p, hole.cup) === 4 - i)) continue;
    const [far, mid, near] = spots;
    if (!far || !mid || !near || onGreen(hole, far) || onGreen(hole, mid) || !onGreen(hole, near)) continue;
    const onlyPutts = (p: P) => movesForRoll(hole, p, 1).every((m) => m.kind === 'putt' && !m.result.holed);
    const puttsTo = (p: P, q: P) => legalMoves(hole, p, 1).some((m) => m.dir === dir && m.result.end.x === q.x && m.result.end.y === q.y);
    const twoHoles = movesForRoll(hole, near, 2).some((m) => m.dir === dir && m.result.holed);
    if (onlyPutts(far) && onlyPutts(mid) && puttsTo(far, mid) && puttsTo(mid, near) && twoHoles) return { spots, dir };
  }
  throw new Error('no straight line into the cup');
}

/** Calm round (no wind seed), everyone off the tee: Player 2 is 4 dots out, Players 1 and 3 next to the cup. */
function awayRound(): { g: GameState; dir: Dir } {
  const g = newGame(0, ['Player 1', 'Player 2', 'Player 3']);
  delete g.windSeed;
  delete g.wind;
  const { spots, dir } = lineToCup(g);
  const tapIn = spotNextToCup(g).pos;
  const [b1, b2, b3] = g.balls;
  if (!b1 || !b2 || !b3 || !spots[0]) throw new Error('setup');
  Object.assign(b1, { pos: { ...tapIn }, strokes: 2 });
  Object.assign(b2, { pos: { ...spots[0] }, strokes: 1 });
  Object.assign(b3, { pos: { ...tapIn }, strokes: 1 });
  g.current = 0; // where round-robin turns left it
  return { g, dir };
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

const status = (page: Page) => page.locator('#tray .status');

test.describe('3 players on a 390x844 phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('away plays next, twice running; the hole winner has the honour on the next tee', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await rigDice(page);
    const { g, dir } = awayRound();
    await page.goto('/');
    await page.evaluate(([k, v]) => {
      localStorage.setItem(k, v);
    }, [KEY_GAME, JSON.stringify(g)] as const);
    await page.reload();
    await page.locator('#cover [data-act=continue]').click();
    await expect(page.locator('#hud')).toContainText('Hole 1');

    // Every ball carries its player's mark; Player 2 is furthest from the cup, so Player 2 is away.
    await expect(page.locator('.ball-mark')).toHaveCount(3);
    expect((await page.locator('.ball-mark').allTextContents()).sort()).toEqual(['1', '2', '3']);
    await expect(status(page)).toContainText('Player 2 · away');
    await shot(page, 'away');

    const putt = `g.target[aria-label="Putt 1 ${DIR_WORDS[dir]}"] circle.hit`;
    await queueDice(page, 1, 1, 2);
    await page.locator('#tray [data-act=roll]').click();
    await page.locator(putt).click({ force: true });
    // 3 dots out, still furthest: Player 2 plays again.
    await expect(page.locator('#banner')).toContainText('Player 2 · away');
    await expect(status(page)).toContainText('Player 2 · away');
    await page.locator('#tray [data-act=roll]').click();
    await page.locator(putt).click({ force: true });
    await expect(status(page)).toContainText('Player 2 · away');
    // 2 dots out on the green: a rolled 2 putts it in by itself (4 strokes).
    await page.locator('#tray [data-act=roll]').click();

    // Players 1 and 3 tap in, nearest-last ties going by the tee order (Player 1 first): 3 and 2 strokes.
    await expect(page.locator('.hole-card')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.hole-card .rows')).toContainText('Player 3');
    await expect(page.locator('.hole-card .tee-order')).toHaveText('Next tee: Player 3 · Player 1 · Player 2');
    const scores = await page.evaluate((k) => {
      const s = JSON.parse(localStorage.getItem(k) ?? 'null') as { players: { scores: (number | null)[] }[] } | null;
      return s?.players.map((p) => p.scores[0]);
    }, KEY_GAME);
    expect(scores).toEqual([3, 4, 2]);

    // Hole 2: Player 3 won hole 1 and has the honour.
    await page.locator('.hole-card [data-act=next]').click();
    await expect(page.locator('#hud')).toContainText('Hole 2');
    await expect(page.locator('#banner')).toContainText('Player 3 · honour');
    await expect(status(page)).toContainText('Player 3 · honour');
    await expect(page.locator('.leaf')).toHaveCount(0); // the old page has turned away
    await shot(page, 'honour');

    // Player 3 tees off; Player 1 (next lowest on hole 1) is next on the tee.
    await queueDice(page, 1);
    await page.locator('#tray [data-act=roll]').click();
    await page.locator('g.target.putt circle.hit').first().click({ force: true });
    await expect(status(page)).toContainText('Player 1 · on the tee');
    expect(errors).toEqual([]);
  });
});
