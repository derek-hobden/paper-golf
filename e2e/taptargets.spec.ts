import { expect, test, type Page } from '@playwright/test';
import { dotsApart, isLandable, puttMoves } from '../src/engine/rules';
import { DIRS, type P } from '../src/engine/types';
import { currentBall, currentHole, newGame, type GameState } from '../src/game/game';
import { spotNextToCup } from '../tests/helpers';

// B1: every tap target is at least 44x44 CSS px on a phone (upright and on its side, 1 and 4 players), and a tap
// where neighbouring hit areas overlap plays the marker nearest the finger. B2: the viewport lets the player
// pinch-zoom.

const KEY_GAME = 'paper-golf:game:v1';
const MIN = 44;

/** Hole 1, one player, ball 2 dots out on the green in line with the cup, `die` already rolled. */
function greenRound(die: number): GameState {
  const g = newGame(0, ['Player 1']);
  const hole = currentHole(g);
  for (const d of DIRS) {
    const p: P = { x: hole.cup.x - 2 * d.x, y: hole.cup.y - 2 * d.y };
    if (dotsApart(p, hole.cup) === 2 && isLandable(hole, p) && puttMoves(hole, p, 2).some((m) => m.result.holed)) {
      currentBall(g).pos = p;
      currentBall(g).strokes = 1;
      g.dice = { value: die, teeRerolled: false };
      return g;
    }
  }
  throw new Error('no 2-dot putt on hole 1');
}

/** Hole 1 on the tee with `die` already rolled (full hits plus 1-dot putts). */
function teeRound(die: number): GameState {
  const g = newGame(0, ['Player 1']);
  g.dice = { value: die, teeRerolled: false };
  return g;
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

/**
 * Every control that can be tapped right now is at least 44x44. Controls that are rendered but not tappable (the
 * folded-back cover: opacity 0, pointer-events none) are skipped.
 */
async function expectControlsTappable(page: Page, where: string) {
  const sizes = await page.locator('button:visible, input:visible, [role=button]:visible').evaluateAll((els) =>
    els
      .filter((e) => getComputedStyle(e).pointerEvents !== 'none')
      .map((e) => {
        const b = e.getBoundingClientRect();
        const name = e.getAttribute('aria-label') ?? e.textContent.trim().replace(/\s+/g, ' ');
        return { name, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 };
      }),
  );
  expect(sizes.length, `${where}: controls`).toBeGreaterThan(0);
  expect(sizes.filter((s) => s.w < MIN || s.h < MIN), `${where}: controls under ${String(MIN)} px`).toEqual([]);
}

interface Marker {
  label: string;
  landing: P;
  /** Screen centre and hit-circle size, CSS px. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The shot markers on the board, with their landing dot read back from the SVG (centre = dot + 0.5). */
async function markers(page: Page): Promise<Marker[]> {
  await expect(page.locator('g.target').first()).toBeVisible();
  return page.locator('g.target').evaluateAll((gs) =>
    gs.map((g) => {
      const hit = g.querySelector('circle.hit');
      if (!(hit instanceof SVGCircleElement)) throw new Error('marker without a hit circle');
      const b = hit.getBoundingClientRect();
      return {
        label: g.getAttribute('aria-label') ?? '',
        landing: { x: hit.cx.baseVal.value - 0.5, y: hit.cy.baseVal.value - 0.5 },
        x: b.x + b.width / 2,
        y: b.y + b.height / 2,
        w: b.width,
        h: b.height,
      };
    }),
  );
}

async function lastLanding(page: Page): Promise<P | undefined> {
  return page.evaluate((k) => {
    const saved = JSON.parse(localStorage.getItem(k) ?? 'null') as { balls: { shots: { landing: P }[] }[] } | null;
    return saved?.balls[0]?.shots.at(-1)?.landing;
  }, KEY_GAME);
}

/**
 * Every control on the cover, setup, a round with `players` (before and after the roll: roll, re-roll, mulligan and
 * the tray tools; the HUD chips and the die are display-only), the scorecard, the rules and the hole card.
 */
async function expectEveryButtonTappable(page: Page, players: number) {
  await page.goto('/');
  await expect(page.locator('#cover [data-act=new]')).toBeVisible();
  await expectControlsTappable(page, 'cover');

  await page.locator('#cover [data-act=new]').click();
  await expect(page.locator('.sheet h2')).toHaveText('New round');
  // At least 2 player rows (names, the stepper's both buttons), 4 with the + disabled.
  for (let n = 1; n < Math.max(players, 2); n++) await page.locator('[data-count="1"]').click();
  await expect(page.locator('.player-row')).toHaveCount(Math.max(players, 2));
  await expectControlsTappable(page, 'setup');

  await page.goto(`/?play=0&players=${String(players)}&hole=1`);
  await expect(page.locator('#tray [data-act=roll]')).toBeEnabled();
  await expect(page.locator('#hud .chip')).toHaveCount(players);
  await expectControlsTappable(page, 'play, before the roll');
  await page.locator('#tray [data-act=roll]').click();
  await expect(page.locator('#tray .status')).toContainText('rolled');
  await expectControlsTappable(page, 'play, after the roll');
  const markerSizes = await markers(page);
  expect(markerSizes.filter((m) => m.w < MIN || m.h < MIN), 'shot markers under 44 px').toEqual([]);

  await page.locator('#tray [data-act=card]').click();
  await expect(page.locator('.sheet h2')).toHaveText('Scorecard');
  await expectControlsTappable(page, 'scorecard');
  await page.locator('[data-act=back]').click();

  await page.locator('#tray [data-act=rules]').click();
  await expect(page.locator('.sheet [data-act=back]')).toBeVisible();
  await expectControlsTappable(page, 'rules');

  // The hole card, after an automatic tap-in.
  const g = newGame(0, ['Player 1']);
  currentBall(g).pos = { ...spotNextToCup(g).pos };
  await continueRound(page, g);
  await expect(page.locator('.hole-card')).toBeVisible();
  await expectControlsTappable(page, 'hole card');
}

test.describe('phone tap targets (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the viewport allows pinch-zoom', async ({ page }) => {
    await page.goto('/');
    const content = (await page.locator('meta[name=viewport]').getAttribute('content')) ?? '';
    expect(content).toContain('width=device-width');
    expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/i);
    expect(content).not.toMatch(/maximum-scale\s*=\s*1(\.0*)?(\s|,|$)/i);
  });

  test('every shot and putt marker is at least 44x44 px', async ({ page }) => {
    const rounds: [string, GameState][] = [
      ['green, roll 2', greenRound(2)],
      ['green, roll 4', greenRound(4)],
      ...[1, 2, 3, 4, 5, 6].map((d): [string, GameState] => [`tee, roll ${String(d)}`, teeRound(d)]),
    ];
    for (const [where, g] of rounds) {
      await continueRound(page, g);
      const ms = await markers(page);
      expect(ms.length, where).toBeGreaterThan(0);
      for (const m of ms) {
        expect(m.w, `${where}: ${m.label}`).toBeGreaterThanOrEqual(MIN);
        expect(m.h, `${where}: ${m.label}`).toBeGreaterThanOrEqual(MIN);
      }
    }
  });

  test('a tap where hit areas overlap plays the nearest marker', async ({ page }) => {
    // A 4 on the green: eight 1-dot putts on neighbouring dots, so the 44 px hit areas overlap.
    const g = greenRound(4);
    await continueRound(page, g);
    const ms = await markers(page);
    expect(ms.length).toBeGreaterThanOrEqual(3);
    let overlapped = 0;
    for (const [i, m] of ms.entries()) {
      // Tap 40% of the way toward the closest neighbour: still nearer this marker, but inside the neighbour's area.
      const others = ms.filter((_, j) => j !== i);
      const near = others.reduce((a, b) => (Math.hypot(b.x - m.x, b.y - m.y) < Math.hypot(a.x - m.x, a.y - m.y) ? b : a));
      const x = m.x + 0.4 * (near.x - m.x);
      const y = m.y + 0.4 * (near.y - m.y);
      if (Math.hypot(near.x - x, near.y - y) < near.w / 2) overlapped++;

      if (i > 0) await continueRound(page, g);
      await page.touchscreen.tap(x, y);
      await expect.poll(() => lastLanding(page), m.label).toEqual(m.landing);
    }
    expect(overlapped, 'taps that landed inside a neighbour’s hit area').toBeGreaterThan(0);
  });

});

// Every button in a round with 1 and 4 players, on a phone upright and on its side.
for (const [width, height] of [
  [390, 844],
  [844, 390],
] as const) {
  test.describe(`every button is at least 44x44 px (${String(width)}x${String(height)})`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });
    for (const players of [1, 4]) {
      test(`${String(players)} player${players > 1 ? 's' : ''}`, async ({ page }) => {
        await expectEveryButtonTappable(page, players);
      });
    }
  });
}
