import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Tap a shot marker (a `g.target`) at its centre. Neighbouring 44 px hit circles overlap by design and the board plays
 * the marker nearest the finger, but Playwright's `click()` on a hit circle waits forever when a later circle sits on
 * top ("subtree intercepts pointer events"), which made the smoke tests fail on some die rolls. Waits for the marker to
 * show first, as `click()` did. The lint rule in eslint.config.js sends every marker click here.
 */
export async function tapMarker(page: Page, marker: Locator) {
  const hit = marker.locator('circle.hit');
  await expect(hit).toBeVisible();
  const b = await hit.boundingBox();
  expect(b, 'marker hit circle').not.toBeNull();
  if (b) await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
