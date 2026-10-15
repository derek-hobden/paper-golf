import { expect, test, type Page } from '@playwright/test';

// B3: with 4 players the HUD chips wrap to a second row, taller than the one row layout() used to budget, and the
// board ran under the tray. layout() must fit the board to the real HUD and tray heights so the whole page (HUD,
// board, score line) stays on the paper and the board stays visible above the tray.

async function box(page: Page, selector: string) {
  const b = await page.locator(selector).boundingBox();
  expect(b, selector).not.toBeNull();
  return b ?? { x: 0, y: 0, width: 0, height: 0 };
}

async function expectBoardFits(page: Page, vh: number) {
  const hud = await box(page, '#hud');
  const board = await box(page, '#board-wrap');
  const scoreline = await box(page, '#scoreline');
  const paper = await box(page, '#page');
  const tray = await box(page, '#tray');
  const boardBottom = board.y + board.height;
  expect(board.y).toBeGreaterThanOrEqual(hud.y + hud.height);
  expect(boardBottom).toBeLessThanOrEqual(tray.y);
  expect(boardBottom).toBeLessThanOrEqual(vh);
  // The score line under the board stays on the paper too, not spilling over its bottom edge.
  expect(scoreline.y + scoreline.height).toBeLessThanOrEqual(paper.y + paper.height + 0.5);
}

async function playFourPlayerTurn(page: Page, vh: number) {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/?play=0&players=4&hole=1');
  await expect(page.locator('#hud .chip')).toHaveCount(4);
  // The chips really wrap: taller than a single-row HUD (40 px min-height).
  expect((await box(page, '#hud')).height).toBeGreaterThan(44);
  await expectBoardFits(page, vh);

  // Still fits after a shot changes the HUD (stroke counts) and the turn passes on.
  await page.locator('#tray [data-act=roll]').click();
  await expect(page.locator('#tray .status')).toContainText('rolled');
  const target = page.locator('g.target.hit').or(page.locator('g.target.putt')).first();
  // Hit circles overlap by design (a tap plays the nearest marker, src/ui/hit.ts), so a neighbour's circle may lie on
  // top of this one and Playwright would wait forever for it to stop "intercepting" the tap. Tap its centre anyway:
  // the nearest marker to that point is this one.
  await target.locator('circle.hit').click({ force: true });
  await expect(page.locator('#hud .chip .hand').first()).toHaveText('1');
  await expect(page.locator('#tray [data-act=roll]:enabled').or(page.locator('.hole-card'))).toBeVisible();
  await expectBoardFits(page, vh);

  expect(errors).toEqual([]);
}

test.describe('4 players on a 390x844 phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test('the whole board is visible above the tray', async ({ page }) => {
    await playFourPlayerTurn(page, 844);
  });
});

test.describe('4 players on a 390x664 phone (Safari with its toolbars)', () => {
  test.use({ viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true });
  test('the whole board is visible above the tray', async ({ page }) => {
    await playFourPlayerTurn(page, 664);
  });
});
