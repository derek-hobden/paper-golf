import { expect, test, type Page } from '@playwright/test';
import { PROPER_PARS, generateProperHole } from '../src/engine/generator';
import { OLD_12_HOLE_SAVE } from '../tests/legacy-saves';

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

// Proper golf is the only game: no Dice Golf / Proper golf choice on the New round sheet, every round 18 holes of
// par 72, ?hole= clamps to 1-18 (an old golf= is ignored), and an old 12-hole round saved in localStorage is
// discarded cleanly instead of crashing the page.

const KEY_GAME = 'paper-golf:game:v1';

/** Set PROPER_SHOTS=<dir> to also save the Proper golf phone screenshots there. */
const SHOTS = process.env.PROPER_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/** The New round sheet has courses and players, and no round/mode selector at all. */
async function noModeSelector(page: Page) {
  await expect(page.locator('.sheet [data-course]').first()).toBeVisible();
  await expect(page.locator('[data-golf]')).toHaveCount(0);
  await expect(page.locator('.golf-modes')).toHaveCount(0);
  await expect(page.locator('.sheet')).not.toContainText('Dice Golf');
  await expect(page.locator('.sheet')).not.toContainText('12 holes');
  await expect(page.locator('.sheet .round-info')).toHaveText('18 holes of par 3, 4 and 5 · par 72');
}

async function noHorizontalOverflow(page: Page) {
  const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(scroll).toBeLessThanOrEqual(inner);
}

/**
 * Play the current hole out with whatever the die gives: roll, then tap the marker that holes out, or else the one
 * nearest the cup (`cup` in board units: cell centres are at +0.5). Tap-ins play by themselves.
 */
async function playToCup(page: Page, cup: { x: number; y: number }) {
  const roll = page.locator('#tray [data-act=roll]:enabled');
  const card = page.locator('.hole-card');
  for (let turn = 0; turn < 12; turn++) {
    await expect(roll.or(card)).toBeVisible({ timeout: 10_000 });
    if (await card.isVisible()) return;
    await roll.click();
    await expect(page.locator('#tray .status')).toContainText('rolled');
    const targets = page.locator('g.target');
    // A roll that can reach the cup (the wind may carry a hit in) plays itself: no targets, the hole card comes up.
    await expect(targets.first().or(card)).toBeVisible({ timeout: 10_000 });
    if (await card.isVisible()) return;
    const best = await targets.evaluateAll((gs, c) => {
      let pick = 0;
      let bestD = Infinity;
      gs.forEach((g, i) => {
        const hit = g.querySelector('circle.hit');
        const d = g.classList.contains('holes')
          ? -1
          : Math.max(Math.abs(Number(hit?.getAttribute('cx')) - c.x - 0.5), Math.abs(Number(hit?.getAttribute('cy')) - c.y - 0.5));
        if (d < bestD) {
          bestD = d;
          pick = i;
        }
      });
      return pick;
    }, cup);
    // Hit circles overlap by design (a tap plays the nearest marker, src/ui/hit.ts), so a neighbour's circle may lie on
    // top of this one and Playwright would wait forever for it to stop "intercepting" the tap. Tap its centre anyway:
    // the nearest marker to that point is this one.
    await targets.nth(best).locator('circle.hit').click({ force: true });
  }
  await expect(card).toBeVisible();
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 844, height: 390 },
]) {
  const size = `${String(viewport.width)}x${String(viewport.height)}`;
  const portrait = viewport.width < viewport.height;

  test.describe(`Proper golf only on a phone (${size})`, () => {
    test.use({ viewport, isMobile: true, hasTouch: true });

    test('the New round sheet has no mode selector; a new round is 18 holes with par shown', async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('/');
      await expect(page.locator('#cover .foot')).toHaveText('90 holes · 5 courses · 18 holes, par 72 · 1–4 players');
      await page.locator('#cover [data-act=new]').click();
      await noModeSelector(page);
      await noHorizontalOverflow(page);
      await page.waitForTimeout(1200); // the cover swings open
      await shot(page, portrait ? 'setup-390x844' : 'setup-844x390');
      await page.locator('[data-act=go]').click();

      // Hole 1 of 18 is a par 4.
      await expect(page.locator('#hud')).toContainText('Hole 1 of 18');
      // The par shows in the score line, or in the HUD on a phone on its side (where the score line is hidden).
      await expect(page.locator(portrait ? '#scoreline' : '#hud .par')).toBeVisible();
      if (portrait) await expect(page.locator('#scoreline')).toHaveText(`Hole 1 · Par ${String(PROPER_PARS[0])} · Strokes 0/4 · Total 0`);
      else await expect(page.locator('#hud .par')).toHaveText(`Par ${String(PROPER_PARS[0])}`);
      await noHorizontalOverflow(page);
      await shot(page, portrait ? 'hole1-390x844' : 'hole1-844x390');
      expect(errors).toEqual([]);
    });

    test('?hole=99 clamps to hole 18, with or without an old golf= param', async ({ page }) => {
      const errors = watchErrors(page);
      for (const q of ['?play=0&players=1&hole=99', '?play=0&players=1&hole=99&golf=proper', '?play=2&players=2&hole=40&golf=default']) {
        await page.goto(q);
        await expect(page.locator('#hud')).toContainText('Hole 18 of 18');
        await expect(page.locator('#hud .par')).toHaveText(`Par ${String(PROPER_PARS[17])}`);
        await expect(page.locator('#tray [data-act=roll]')).toBeEnabled();
        await noHorizontalOverflow(page);
      }
      await page.goto('/?play=0&players=1&hole=3');
      await expect(page.locator('#hud')).toContainText('Hole 3 of 18');
      await expect(page.locator('#hud .par')).toHaveText('Par 3');
      expect(errors).toEqual([]);
    });

    test('an old 12-hole round saved in localStorage loads without a crash and is replaced by an 18-hole round', async ({ page }) => {
      const errors = watchErrors(page);
      await page.addInitScript(
        ([key, save]) => {
          // Plant it once (not on every reload), as the old game left it.
          if (!sessionStorage.getItem('planted')) {
            localStorage.setItem(key, save);
            sessionStorage.setItem('planted', '1');
          }
        },
        [KEY_GAME, JSON.stringify(OLD_12_HOLE_SAVE)] as const,
      );
      await page.goto('/');
      await expect(page.locator('#cover [data-act=new]')).toBeVisible();
      // Discarded: nothing to continue, and the stored round is gone.
      await expect(page.locator('#cover [data-act=continue]')).toHaveCount(0);
      expect(await page.evaluate((k) => localStorage.getItem(k), KEY_GAME)).toBeNull();
      await page.locator('#cover [data-act=new]').click();
      await noModeSelector(page);
      await page.locator('[data-act=go]').click();
      await expect(page.locator('#hud')).toContainText('Hole 1 of 18');
      // The new round is saved as an 18-hole round and resumes after a reload.
      const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? 'null') as { players: { scores: unknown[] }[] } | null, KEY_GAME);
      expect(saved?.players.map((p) => p.scores.length)).toEqual([18]);
      await page.reload();
      await expect(page.locator('#cover [data-act=continue]')).toHaveText('Continue · Hole 1');
      await noHorizontalOverflow(page);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('Proper golf on a phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('play hole 1 to the cup, and read the card', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await page.locator('#cover [data-act=new]').click();
    await page.locator('[data-act=go]').click();
    await expect(page.locator('#hud')).toContainText('Hole 1 of 18');
    await playToCup(page, generateProperHole(0, 1).cup);
    const strokes = Number(await page.locator('#hud .chip .hand').first().textContent());
    expect(strokes).toBeGreaterThanOrEqual(1);
    expect(strokes).toBeLessThanOrEqual(10);

    // The scorecard: every hole's par, Out 36, In 36, Total 72, and hole 1's strokes in the totals.
    await page.locator('.hole-card [data-act=card]').click();
    const table = page.locator('.card-table');
    await expect(table).toBeVisible();
    const holeRows = table.locator('tbody tr:not([data-total])');
    await expect(holeRows).toHaveCount(18);
    for (const [i, par] of PROPER_PARS.entries()) await expect(holeRows.nth(i).locator('td').first()).toHaveText(`Hole ${String(i + 1)} /${String(par)}`);
    await expect(table.locator('tr[data-total=Out] td').first()).toHaveText('Out /36');
    await expect(table.locator('tr[data-total=In] td').first()).toHaveText('In /36');
    await expect(table.locator('tr[data-total=Total] td').first()).toHaveText('Total /72');
    const toPar = strokes - 4;
    const signed = toPar === 0 ? 'E' : toPar > 0 ? `+${String(toPar)}` : String(toPar);
    await expect(table.locator('tr[data-total=Out] td').nth(1)).toHaveText(`${String(strokes)} (${signed})`);
    await expect(table.locator('tr[data-total=In] td').nth(1)).toHaveText('');
    await expect(table.locator('tr[data-total=Total] td').nth(1)).toHaveText(`${String(strokes)} (${signed})`);
    await expect(holeRows.first().locator('td').nth(1)).toHaveText(String(strokes));
    await noHorizontalOverflow(page);
    await shot(page, 'scorecard-390x844');
    const back = page.locator('.sheet [data-act=back]');
    await back.scrollIntoViewIfNeeded();
    const backBox = await back.boundingBox();
    expect(backBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Back on hole 2 the strip carries the round's strokes and the score to par.
    await back.click();
    await page.locator('.hole-card [data-act=next]').click();
    await expect(page.locator('#scoreline')).toHaveText(
      new RegExp(`^Hole 2 · Par 4 · Strokes 0/4 · Total ${String(strokes)} \\(${signed.replace('+', '\\+')}\\)$`),
    );
    expect(errors).toEqual([]);
  });
});
