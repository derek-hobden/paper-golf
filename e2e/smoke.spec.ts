import { expect, test } from '@playwright/test';

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

  // Tap a target (prefer a full hit over a putt). Click its hit circle, not the group's
  // bounding box, which can include a dashed roll-out line.
  const target = page.locator('g.target.hit').or(page.locator('g.target.putt')).first();
  await expect(target).toBeVisible();
  const label = await target.getAttribute('aria-label');
  expect(label).toMatch(/^(Hit|Putt) \d/);
  await target.locator('circle.hit').click();

  // The shot is recorded: one stroke, and the turn comes back (next roll, or the hole card on a hole-in-one).
  await expect(strokes).toHaveText('1');
  await expect(page.locator('#tray [data-act=roll]:enabled').or(page.locator('.hole-card'))).toBeVisible();

  // The saved round agrees: one shot recorded for player 1.
  const shots = await page.evaluate(() => {
    const raw = localStorage.getItem('paper-golf:game:v1');
    if (!raw) return -1;
    const saved = JSON.parse(raw) as { balls?: { shots?: unknown[] }[] };
    return saved.balls?.[0]?.shots?.length ?? -1;
  });
  expect(shots).toBe(1);

  expect(errors).toEqual([]);
});
