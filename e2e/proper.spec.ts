import { expect, test, type Page } from '@playwright/test';
import { PROPER_PARS, generateProperHole } from '../src/engine/generator';

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

/** Set PROPER_SHOTS=<dir> to also save the Proper golf phone screenshots there. */
const SHOTS = process.env.PROPER_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
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
    await expect(targets.first()).toBeVisible();
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
    await targets.nth(best).locator('circle.hit').click();
  }
  await expect(card).toBeVisible();
}

test.describe('Proper golf on a phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('choose Proper golf, play hole 1 to the cup, and read the card', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

    await page.goto('/');
    await page.locator('#cover [data-act=new]').click();
    const proper = page.locator('[data-golf=proper]');
    await expect(proper).toBeVisible();
    const box = await proper.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    await proper.click();
    await expect(page.locator('[data-golf=proper]')).toHaveClass(/\bsel\b/);
    await expect(page.locator('[data-golf=default]')).not.toHaveClass(/\bsel\b/);
    await noHorizontalOverflow(page);
    await page.waitForTimeout(1200); // the cover swings open
    await shot(page, 'proper-setup');
    await page.locator('[data-act=go]').click();

    // Hole 1 of 18 is a par 4.
    await expect(page.locator('#hud')).toContainText('Hole 1 of 18');
    await expect(page.locator('#scoreline')).toContainText(`Par ${String(PROPER_PARS[0])}`);
    await noHorizontalOverflow(page);
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
    await shot(page, 'proper-scorecard');
    const back = page.locator('.sheet [data-act=back]');
    await back.scrollIntoViewIfNeeded();
    const backBox = await back.boundingBox();
    expect(backBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    expect(errors).toEqual([]);
  });

  test('a par 3 deep link, and ?hole= clamps to 18 in Proper golf', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    await page.goto('/?play=0&players=1&hole=3&golf=proper');
    await expect(page.locator('#hud')).toContainText('Hole 3 of 18');
    await expect(page.locator('#scoreline')).toContainText('Par 3');
    await expect(page.locator('#tray [data-act=roll]')).toBeEnabled();
    await noHorizontalOverflow(page);
    await shot(page, 'proper-par3');

    await page.goto('/?play=0&players=1&hole=99&golf=proper');
    await expect(page.locator('#hud')).toContainText('Hole 18 of 18');
    await page.goto('/?play=0&players=1&hole=18');
    await expect(page.locator('#hud')).toContainText('Hole 12 of 12');
    expect(errors).toEqual([]);
  });
});
