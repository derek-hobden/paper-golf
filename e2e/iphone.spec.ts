import { expect, test, type Page } from '@playwright/test';
import { tapMarker } from './tap';

// iPhone Safari (WebKit, the `iphone-webkit` project in playwright.config.ts). With Safari's toolbars showing, an
// iPhone 14 has only 390x664 of visible viewport: the Roll button sat under the bottom toolbar because the tray's
// status text wrapped past its fixed height, and the strip under the board ran together ("Par 4Strokes: /4Total:").

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

/** Set IPHONE_SHOTS=<dir> to also save iphone-rollbar.png and iphone-strip.png there. */
const SHOTS = process.env.IPHONE_SHOTS;

interface RollMeasure {
  rollTop: number;
  rollBottom: number;
  innerHeight: number;
  visualHeight: number;
  scrollY: number;
  trayBottom: number;
  strip: string;
}

/** Waits for the fonts and for layout() to settle (the Roll button box is the same two frames running). */
async function measure(page: Page): Promise<RollMeasure> {
  await page.evaluate(() => document.fonts.ready);
  let last = '';
  await expect
    .poll(async () => {
      const now = await page.evaluate(
        () =>
          new Promise<string>((done) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                const r = document.querySelector('#tray [data-act=roll]')?.getBoundingClientRect();
                done(r ? JSON.stringify(r) : '');
              });
            });
          }),
      );
      const same = now === last && now !== '';
      last = now;
      return same;
    })
    .toBe(true);
  return page.evaluate(() => {
    const roll = document.querySelector('#tray [data-act=roll]')?.getBoundingClientRect();
    const tray = document.querySelector('#tray')?.getBoundingClientRect();
    return {
      rollTop: roll?.top ?? NaN,
      rollBottom: roll?.bottom ?? NaN,
      innerHeight: window.innerHeight,
      visualHeight: window.visualViewport?.height ?? NaN,
      scrollY: window.scrollY,
      trayBottom: tray?.bottom ?? NaN,
      strip: (document.querySelector('#scoreline')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    };
  });
}

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

const STRIP_BEFORE_ROLL = /^Hole 1 · Par [345] · Strokes 0\/[345] · Total 0$/;

for (const viewport of [
  { width: 390, height: 664 }, // iPhone 14 with Safari's top and bottom toolbars showing
  { width: 390, height: 844 }, // toolbars collapsed
  { width: 375, height: 548 }, // iPhone SE with the toolbars showing: `compact`, the strip is hidden, par in the HUD
]) {
  const size = `${String(viewport.width)}x${String(viewport.height)}`;
  const compact = viewport.height < 600;

  test.describe(`iPhone Safari ${size}`, { tag: '@webkit' }, () => {
    // The project is devices['iPhone 14'] (WebKit, isMobile, hasTouch); only the visible viewport changes here.
    test.use({ viewport });

    test('the Roll button is fully above the bottom toolbar and the strip is spaced', async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto('/');
      await page.locator('[data-act=new]').click();
      await page.locator('[data-act=go]').click();
      await expect(page.locator('#hud')).toContainText('of 18');
      const m = await measure(page);
      console.log(`roll-measure ${size} ${JSON.stringify(m)}`);
      expect(m.rollTop).toBeGreaterThanOrEqual(0);
      expect(m.rollBottom).toBeLessThanOrEqual(m.innerHeight);
      expect(m.rollBottom).toBeLessThanOrEqual(m.visualHeight);
      expect(m.trayBottom).toBeLessThanOrEqual(m.visualHeight);
      expect(m.scrollY).toBe(0);
      expect(m.strip).toMatch(STRIP_BEFORE_ROLL);
      await expect(page.locator('#scoreline')).toBeVisible({ visible: !compact });
      await expect(page.locator('#hud .par')).toBeVisible({ visible: compact });
      if (compact) await expect(page.locator('#hud .par')).toHaveText(/^Par [345]$/);
      // The strip fits the page: one row, or two ("Hole 1 · Par 4" over "Strokes 0/4 · Total 0"), never clipped.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const el = document.querySelector('#scoreline');
            return el ? el.scrollWidth - el.clientWidth : Infinity;
          }),
        )
        .toBeLessThanOrEqual(1);
      // ...and the board refitted to it still leaves the Roll button in view.
      const after = await measure(page);
      expect(after.rollBottom).toBeLessThanOrEqual(after.visualHeight);
      expect(after.scrollY).toBe(0);
      const { scroll, inner } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(scroll).toBeLessThanOrEqual(inner);
      if (SHOTS && size === '390x664') {
        await page.waitForTimeout(1200); // the cover finishes swinging open
        await page.screenshot({ path: `${SHOTS}/iphone-rollbar.png` });
        await page.locator('#scoreline').screenshot({ path: `${SHOTS}/iphone-strip.png` });
      }

      // After a shot the strip counts it: Strokes 1/<par>, and Total (the round's strokes so far) 1.
      await page.locator('#tray [data-act=roll]').click();
      await expect(page.locator('#tray .status')).toContainText('rolled');
      await tapMarker(page, page.locator('g.target').first());
      await expect(page.locator('#scoreline')).toHaveText(/Strokes 1\/[345] · Total 1$/);
      await expect(page.locator('#hud .chip .hand').first()).toHaveText('1');
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(errors).toEqual([]);
    });
  });
}

// The layout ResizeObservers (HUD, score line, tray) must never re-fit synchronously inside their own callback: that
// resizes what they observe and WebKit raises "ResizeObserver loop completed with undelivered notifications" as a
// page error (eee1735, seen on every load of ?play=3&players=1&hole=1 at 390x664).
for (const viewport of [
  { width: 390, height: 664 },
  { width: 390, height: 844 },
]) {
  const size = `${String(viewport.width)}x${String(viewport.height)}`;

  test.describe(`iPhone Safari ${size}: no ResizeObserver loop`, { tag: '@webkit' }, () => {
    // As a real phone loads the deployed site: full motion, and the web fonts arriving after the first layout.
    test.use({ viewport, reducedMotion: 'no-preference' });

    for (const start of ['new round', '/?play=3&players=1&hole=1'] as const) {
      test(`${start} settles with no page or console errors`, async ({ page }) => {
        const errors = watchErrors(page);
        await page.route(/\.woff2?$/, async (route) => {
          await new Promise((r) => setTimeout(r, 300));
          await route.continue();
        });
        if (start === 'new round') {
          await page.goto('/');
          await page.locator('[data-act=new]').click();
          await page.locator('[data-act=go]').click();
        } else {
          await page.goto(start);
        }
        await expect(page.locator('#hud')).toContainText('Hole 1 of 18');
        await page.waitForTimeout(1500); // fonts, observers and re-fits settle
        const m = await measure(page);
        console.log(`settle-measure ${size} ${start} ${JSON.stringify(m)}`);
        expect(m.rollBottom).toBeLessThanOrEqual(m.innerHeight);
        expect(m.rollBottom).toBeLessThanOrEqual(m.visualHeight);
        expect(m.scrollY).toBe(0);
        expect(m.strip).toBe('Hole 1 · Par 4 · Strokes 0/4 · Total 0');
        expect(errors).toEqual([]);
      });
    }
  });
}
