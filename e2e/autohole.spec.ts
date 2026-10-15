import { expect, test, type Page } from '@playwright/test';
import { movesForRoll } from '../src/engine/rules';
import { currentBall, currentHole, newGame, type GameState } from '../src/game/game';
import { LEGACY_PALETTE_KEY } from '../src/game/ink';
import { defined, overshootSetup } from '../tests/helpers';

// Colour only (no greyscale toggle anywhere, a stale stored "grey" ignored) and the auto-hole rule: a roll that can
// reach the cup plays itself, without a tap.

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

const KEY_GAME = 'paper-golf:game:v1';
/** Set to a directory to save setup.png, howto.png and auto-hole.png there. */
const SHOTS = process.env.AUTOHOLE_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function noOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, 'horizontal overflow').toBeLessThanOrEqual(iw);
}

async function noToggle(page: Page) {
  await expect(page.locator('[data-act=palette], .palette-btn')).toHaveCount(0);
  await expect(page.locator('#page')).not.toContainText(/Colour:|greyscale|grayscale/i);
}

/**
 * The die comes from `crypto.getRandomValues`; this replaces it with the values queued in `<html data-dice>`
 * (comma-separated, used in order), so a test decides every roll.
 */
async function rigDice(page: Page) {
  await page.addInitScript(() => {
    const real = crypto.getRandomValues.bind(crypto);
    Object.defineProperty(crypto, 'getRandomValues', {
      value: (a: Uint32Array<ArrayBuffer>) => {
        const root = document.documentElement;
        const [next, ...rest] = (root.dataset.dice ?? '').split(',').filter(Boolean);
        if (next === undefined || a.length !== 1) return real(a);
        root.dataset.dice = rest.join(',');
        a[0] = Number(next) - 1; // main.ts: value % 6 + 1
        return a;
      },
    });
  });
}

async function queueDice(page: Page, ...dice: number[]) {
  await page.evaluate((d) => {
    document.documentElement.dataset.dice = d.join(',');
  }, dice);
}

/** A one-player round, one stroke in, the ball off the green where a hit of `die` holes it (overshoot by one). */
function nearCupRound(): { g: GameState; hitDie: number; missDie: number } {
  const g = newGame(0, ['Player 1']);
  const { pos, die } = overshootSetup(g);
  currentBall(g).pos = { ...pos };
  currentBall(g).strokes = 1;
  const hole = currentHole(g);
  const missDie = defined(
    [1, 2, 3, 4, 5, 6].find((v) => !movesForRoll(hole, pos, v).some((m) => m.result.holed)),
    'a roll that cannot reach the cup',
  );
  return { g, hitDie: die, missDie };
}

test.describe('phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('colour only: no toggle on setup or How to play, a stale greyscale choice is ignored', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.evaluate((k) => {
      localStorage.clear();
      localStorage.setItem(k, 'grey');
    }, LEGACY_PALETTE_KEY);
    await page.reload();
    expect(await page.evaluate((k) => localStorage.getItem(k), LEGACY_PALETTE_KEY)).toBeNull();
    await expect(page.locator('html')).not.toHaveAttribute('data-palette', /./);

    await page.locator('#cover [data-act=new]').click();
    await expect(page.locator('#page h2')).toContainText('New round');
    await noToggle(page);
    await noOverflow(page);
    await page.waitForTimeout(600); // let the cover settle for the screenshot
    await shot(page, 'setup');
    await page.locator('#page [data-act=back]').click();

    await page.locator('#cover [data-act=rules]').click();
    await expect(page.locator('#page .legend')).toBeVisible();
    await noToggle(page);
    await noOverflow(page);
    await page.waitForTimeout(600);
    await shot(page, 'howto');
    await page.locator('#page [data-act=back]').click();

    // The board is in colour: green fairway, blue water swatch, flag on the cup.
    await page.goto('/?play=3&players=4&hole=5');
    await expect(page.locator('#hud')).toContainText('Hole 5');
    const fairway = await page.evaluate(() => {
      const e = document.querySelector('path.t-fairway');
      return e ? getComputedStyle(e).fill : '';
    });
    expect(fairway).toBe('rgb(211, 236, 169)');
    await expect(page.locator('.flag')).toBeVisible();
    await page.locator('#tray [data-act=rules]').click();
    await noToggle(page);
    await noOverflow(page);
    expect(errors).toEqual([]);
  });

  test('a roll that can reach the cup plays itself into the hole, no tap', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await rigDice(page);
    // Count every tap on a shot target (there must be none).
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
    const { g, hitDie, missDie } = nearCupRound();
    await page.goto('/');
    await page.evaluate(([k, v]) => {
      localStorage.setItem(k, v);
    }, [KEY_GAME, JSON.stringify(g)] as const);
    await page.reload();
    await page.locator('#cover [data-act=continue]').click();
    await expect(page.locator('#hud')).toContainText('Hole 1');

    // A roll that can't reach the cup: nothing plays, the targets are offered as before.
    await queueDice(page, missDie, hitDie);
    await page.locator('#tray [data-act=roll]').click();
    await expect(page.locator('#tray .status')).toContainText(`rolled ${String(missDie)}`);
    await expect(page.locator('g.target').first()).toBeVisible();
    const saved = () =>
      page.evaluate((k) => {
        const s = JSON.parse(localStorage.getItem(k) ?? 'null') as {
          dice: { value: number } | null;
          balls: { holed: boolean; strokes: number }[];
          players: { scores: (number | null)[] }[];
        } | null;
        return { dice: s?.dice?.value ?? null, ball: s?.balls[0], score: s?.players[0]?.scores[0] };
      }, KEY_GAME);
    expect(await saved()).toEqual({ dice: missDie, ball: expect.objectContaining({ holed: false, strokes: 1 }), score: null });

    // The mulligan rolls a number that holes it: the ball drops in by itself, one more stroke.
    await page.locator('#tray [data-act=mull]').click();
    await expect(page.locator('#banner')).toContainText('Player 1 · 2 strokes');
    await expect(page.locator('#hud .chip .hand').first()).toHaveText('2');
    await page.waitForTimeout(300);
    await shot(page, 'auto-hole');
    await expect(page.locator('.hole-card')).toBeVisible();
    expect(await saved()).toEqual({ dice: null, ball: expect.objectContaining({ holed: true, strokes: 2 }), score: 2 });
    expect(await page.evaluate(() => document.documentElement.dataset.taps ?? '0')).toBe('0');
    await noOverflow(page);
    expect(errors).toEqual([]);
  });
});
