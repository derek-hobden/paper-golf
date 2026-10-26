import { expect, test, type Page } from '@playwright/test';
import { MAX_STROKES, dotsApart, elevationNote } from '../src/engine/rules';
import { availableMoves, autoHoleMove, currentHole, loadState, type GameState, type MoveOption } from '../src/game/game';
import { defined } from '../tests/helpers';
import { watchConsole } from './console';
import { tapMarker } from './tap';

// The solo journey a player takes, the way they take it: cover → New round → Tee off, then roll and tap until the
// hole is done, and the scorecard shows the score. Real dice and a fresh round's random wind, so every run plays a
// different hole 1; each roll's dots are checked against the engine's legal moves for the saved state. Runs in Chrome
// and WebKit as an iPhone 14 (playwright.config.ts); the verify-paper-golf skill (`npm run verify`) runs it.

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

const KEY_GAME = 'paper-golf:game:v1';
/** Set to a directory to save <project>-targets.png, <project>-hole-card.png and <project>-scorecard.png there. */
const SHOTS = process.env.VERIFY_SHOTS;
const DIR_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** The marker label the board draws for a move (`Board.setTargets`), the ground's note on a hit it moved included. */
const label = (m: MoveOption) =>
  `${m.kind === 'putt' ? 'Putt' : 'Hit'} ${String(m.dist)} ${DIR_WORDS[m.dir]}` +
  `${m.result.elev ? ` — ${elevationNote(m.result.elev)}` : ''}${m.result.holed ? ' — holes out' : ''}`;

/** The moves the board marks: hits before putts, one marker per end dot (`Board.setTargets`). */
function markedMoves(moves: MoveOption[]): MoveOption[] {
  const seen = new Set<string>();
  return [...moves]
    .sort((a, b) => (a.kind === 'putt' ? 1 : 0) - (b.kind === 'putt' ? 1 : 0))
    .filter((m) => {
      const key = `${String(m.result.end.x)},${String(m.result.end.y)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function savedGame(page: Page): Promise<GameState> {
  const raw = await page.evaluate((k) => localStorage.getItem(k), KEY_GAME);
  return defined(loadState(JSON.parse(raw ?? 'null')), 'saved round');
}

test('solo round: tee off, roll, the legal dots, shots until the hole is done, the scorecard has the score', { tag: ['@webkit', '@quick'] }, async ({ page }, info) => {
  const errors = watchConsole(page);
  const shot = async (name: string) => {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${info.project.name}-${name}.png` });
  };

  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
  });
  await page.reload();
  await expect(page.locator('#cover h1')).toHaveText('GOLF');
  await page.locator('#cover [data-act=new]').click();
  await expect(page.locator('#page h2')).toContainText('New round');
  await expect(page.locator('#page [data-name]')).toHaveCount(1);
  await page.locator('#page [data-act=go]').click();
  await expect(page.locator('#hud')).toContainText('Hole 1');
  const strokes = page.locator('#hud .chip .hand').first();
  await expect(strokes).toHaveText('0');

  const card = page.locator('.hole-card');
  const roll = page.locator('#tray [data-act=roll]:enabled');
  const status = page.locator('#tray .status');
  for (let turn = 0; turn < MAX_STROKES + 6 && !(await card.isVisible()); turn++) {
    // Next: the Roll button, or (a tap-in plays itself, no Roll) the hole card.
    await expect(roll.or(card)).toBeVisible();
    if (await card.isVisible()) break;
    await roll.click();
    await expect(status).toContainText('rolled');
    let g = await savedGame(page);
    let marked = markedMoves(availableMoves(g));
    // Nowhere to go (boxed in): mulligans until a roll offers a dot.
    while (g.dice && !autoHoleMove(g) && marked.length === 0 && (g.players[0]?.mulligans ?? 0) > 0) {
      await page.locator('#tray [data-act=mull]').click();
      await expect.poll(async () => (await savedGame(page)).players[0]?.mulligans).toBe((g.players[0]?.mulligans ?? 0) - 1);
      g = await savedGame(page);
      marked = markedMoves(availableMoves(g));
    }
    if (!g.dice || autoHoleMove(g)) {
      // A roll that can reach the cup plays itself: no dots, no tap.
      await expect(card).toBeVisible();
      break;
    }
    // The dots on the board are exactly the engine's legal moves for this lie, roll and wind.
    const shown = await page.locator('g.target').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    expect(shown.sort(), `dots for a ${String(g.dice.value)} from ${JSON.stringify(g.balls[0]?.pos)}`).toEqual(marked.map(label).sort());
    if (turn === 0) await shot('targets');
    // Play towards the cup: the marked dot nearest to it.
    const cup = currentHole(g).cup;
    const best = defined(marked.reduce<MoveOption | undefined>((a, m) => (a && dotsApart(a.result.end, cup) <= dotsApart(m.result.end, cup) ? a : m), undefined), 'a dot to play');
    const before = await strokes.textContent();
    await tapMarker(page, page.locator(`g.target[aria-label="${label(best)}"]`));
    // The shot counts: one more stroke on the HUD, or the hole is done.
    await expect.poll(async () => (await card.isVisible()) || (await strokes.textContent()) !== before).toBe(true);
  }

  // The hole is done: the hole card and the scorecard both show the saved score.
  await expect(card).toBeVisible();
  await expect(card.locator('h2')).toHaveText('Hole 1 done');
  const g = await savedGame(page);
  const score = defined(g.players[0]?.scores[0], 'hole 1 score');
  expect(score).toBeGreaterThan(0);
  expect(score).toBeLessThanOrEqual(MAX_STROKES);
  await expect(card.locator('.rows .hand')).toHaveText(String(score));
  await shot('hole-card');
  await card.locator('[data-act=card]').click();
  await expect(page.locator('#page h2')).toHaveText('Scorecard');
  const hole1 = page.locator('.card-table tbody tr').first();
  await expect(hole1.locator('td').first()).toContainText('Hole 1');
  await expect(hole1.locator('td').nth(1)).toHaveText(String(score));
  await expect(page.locator('.card-table tfoot tr[data-total="Total"] td').nth(1)).toContainText(String(score));
  await shot('scorecard');

  // Back to the hole, on to hole 2.
  await page.locator('#page [data-act=back]').click();
  await page.locator('.hole-card [data-act=next]').click();
  await expect(page.locator('#hud')).toContainText('Hole 2');
  expect(errors).toEqual([]);
});
