import { expect, test, type Page } from '@playwright/test';

// The notebook's look: twin-loop wire coils (the #coil SVG symbol) across the top of the page and the wood desk
// texture (src/assets/wood.webp). Runs on Chrome and on the iPhone WebKit project (playwright.config.ts).

// This file runs in Node, but tsconfig only loads browser types (no @types/node), so declare the one global we read.
declare const process: { env: Record<string, string | undefined> };

/** Set LOOK_SHOTS=<dir> to also save phone.png / desktop.png and closeup-rings.png there. */
const SHOTS = process.env.LOOK_SHOTS;

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** Every coil is drawn: a laid-out SVG whose <use> resolves to the symbol's wire and hole. */
async function coils(page: Page) {
  return page.evaluate(() => {
    const spiral = document.querySelector('#spiral')?.getBoundingClientRect();
    const page = document.querySelector('#page')?.getBoundingClientRect();
    const drawn = [...document.querySelectorAll<SVGSVGElement>('#spiral .coil svg')].map((svg) => {
      const r = svg.getBoundingClientRect();
      const use = svg.querySelector('use');
      const box = use ? use.getBBox() : { width: 0, height: 0 };
      return { w: r.width, h: r.height, left: r.left, useW: box.width, useH: box.height };
    });
    return {
      count: drawn.length,
      drawn,
      symbol: document.querySelectorAll('#coil path').length,
      spiralLeft: spiral?.left ?? NaN,
      spiralRight: spiral?.right ?? NaN,
      pageTop: page?.top ?? NaN,
      spiralTop: spiral?.top ?? NaN,
    };
  });
}

/** The desk texture: the url() layer of the body background, fetched as the browser would. */
async function deskTexture(page: Page) {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
  const url = /url\("?([^")]+)"?\)/.exec(bg)?.[1];
  expect(url, `body background-image: ${bg}`).toMatch(/wood.*\.webp$/);
  const res = await page.request.get(url ?? '');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/webp');
  // Small, and it decodes in this browser (WebKit included) at its full 1.5x size.
  const { bytes, size } = await page.evaluate(async (src) => {
    const blob = await (await fetch(src)).blob();
    const img = new Image();
    img.src = src;
    await img.decode();
    return { bytes: blob.size, size: [img.naturalWidth, img.naturalHeight] };
  }, url ?? '');
  expect(bytes).toBeLessThan(150 * 1024);
  expect(size).toEqual([1536, 1026]);
}

for (const v of [
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test.describe(`look ${v.name}`, () => {
    test.use({ viewport: { width: v.width, height: v.height } });

    test('the wire coils and the wood desk render, with no errors', async ({ page, browserName }) => {
      const errors = watchErrors(page);
      // The cover first: the coils bind it too.
      await page.goto('/');
      await expect(page.locator('[data-act=new]')).toBeVisible();
      const cover = await coils(page);
      expect(cover.count).toBeGreaterThanOrEqual(8);
      await deskTexture(page);

      await page.goto('/?play=3&players=1&hole=4');
      await expect(page.locator('#hud')).toContainText('Hole 4');
      await page.evaluate(() => document.fonts.ready);
      const c = await coils(page);
      expect(c.symbol).toBeGreaterThan(0);
      expect(c.count).toBeGreaterThanOrEqual(8);
      for (const d of c.drawn) {
        expect(d.w).toBe(12);
        expect(d.h).toBe(40);
        // The symbol resolved: the <use> has the wire's geometry, not an empty box.
        expect(d.useW).toBeGreaterThan(5);
        expect(d.useH).toBeGreaterThan(25);
      }
      // Evenly spaced across the page: equal gaps (to a pixel) from the first coil to the last.
      const gaps = c.drawn.slice(1).map((d, i) => d.left - (c.drawn[i]?.left ?? NaN));
      for (const g of gaps) expect(Math.abs(g - (gaps[0] ?? NaN))).toBeLessThanOrEqual(1);
      // The loops rise above the page's top edge and the holes sit on the page.
      expect(c.spiralTop).toBeLessThan(c.pageTop);
      await deskTexture(page);

      if (SHOTS !== undefined && browserName === (v.name === 'phone' ? 'webkit' : 'chromium')) {
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${SHOTS}/${v.name}.png` });
        if (v.name === 'phone') {
          await page.locator('#spiral').screenshot({ path: `${SHOTS}/closeup-rings.png` });
        }
      }
      expect(errors).toEqual([]);
    });
  });
}
