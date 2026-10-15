import { expect, test } from '@playwright/test';
import { tapMarker } from './tap';

// One end-to-end smoke test: the built site boots cleanly and a real Dice Golf turn
// (roll the die, tap a target) advances the game. reducedMotion is 'reduce' in the config,
// so the shot skips its flight animation, but the input lock is still respected by waiting
// for the UI to come back rather than sleeping.
test('start page loads cleanly and a turn can be played', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  // Start page: the notebook cover with its menu.
  await page.goto('/');
  await expect(page.locator('#cover h1')).toHaveText('GOLF');
  await expect(page.locator('#cover [data-act=new]')).toBeVisible();

  // Deep link straight into a one-player round on course 1, hole 1.
  await page.goto('/?play=0&players=1&hole=1');
  await expect(page.locator('#hud')).toContainText('Hole 1');
  const strokes = page.locator('#hud .chip .hand').first();
  await expect(strokes).toHaveText('0');

  // Roll the die. Buttons are disabled while the die tumbles; targets appear once it settles.
  const rollButton = page.locator('#tray [data-act=roll]');
  await expect(rollButton).toBeEnabled();
  await rollButton.click();
  await expect(page.locator('#tray .status')).toContainText('rolled');

  // Tap a target (prefer a full hit over a putt) at its hit circle's centre, not the group's
  // bounding box, which can include a dashed roll-out line.
  const target = page.locator('g.target.hit').or(page.locator('g.target.putt')).first();
  await expect(target).toBeVisible();
  const label = await target.getAttribute('aria-label');
  expect(label).toMatch(/^(Hit|Putt) \d/);
  await tapMarker(page, target);

  // The shot is recorded: one stroke, and the turn comes back (next roll, or the hole card on a hole-in-one).
  await expect(strokes).toHaveText('1');
  await expect(page.locator('#tray [data-act=roll]:enabled').or(page.locator('.hole-card'))).toBeVisible();

  // A deep-link round is never saved, so it can't overwrite a real round in progress (B8, e2e/playlink.spec.ts).
  expect(await page.evaluate(() => localStorage.getItem('paper-golf:game:v1'))).toBeNull();

  expect(errors).toEqual([]);
});
