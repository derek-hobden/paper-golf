import { expect, test, type Page } from '@playwright/test';
import { newGame } from '../src/game/game';

// On a phone on its side (844x390, 740x360) the cover is only as tall as the viewport and narrow: the GOLF title
// ran off the right edge of the green card and the absolute footer slid over the "How to play" button. Portrait
// (390x844) must stay as it was. The title, pill and buttons sit inside the card and the footer covers no button,
// with and without a round to continue (4 buttons instead of 3; on a short landscape card that hides the footer).
// Build a hole and How to play share a row on a short card, so the fourth button costs it no height.
// Page overflow and the buttons inside the viewport are e2e/fit.spec.ts's job (the cover at every size).

const KEY_GAME = 'paper-golf:game:v1';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface CoverBoxes {
  card: Box;
  /** The ink of the title and pill: their text, not their (card-wide) block boxes. */
  title: Box;
  brand: Box;
  /** Null when the footer is hidden. */
  foot: Box | null;
  buttons: (Box & { name: string })[];
}

/** Waits for the fonts and for layout() to settle (the cover box is the same two frames running). */
async function coverBoxes(page: Page): Promise<CoverBoxes> {
  await page.evaluate(() => document.fonts.ready);
  let last = '';
  await expect
    .poll(async () => {
      const now = await page.evaluate(
        () =>
          new Promise<string>((done) => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                done(JSON.stringify(document.querySelector('#cover')?.getBoundingClientRect()));
              });
            });
          }),
      );
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  return page.evaluate(() => {
    const box = (r: DOMRect) => ({ x: r.x, y: r.y, w: r.width, h: r.height });
    const el = (s: string) => {
      const e = document.querySelector(s);
      if (!e) throw new Error(`no ${s}`);
      return e;
    };
    const ink = (s: string) => {
      const range = document.createRange();
      range.selectNodeContents(el(s));
      return box(range.getBoundingClientRect());
    };
    return {
      card: box(el('#cover').getBoundingClientRect()),
      title: ink('#cover h1'),
      brand: box(el('#cover .brand').getBoundingClientRect()),
      foot: getComputedStyle(el('#cover .foot')).display === 'none' ? null : ink('#cover .foot'),
      buttons: [...document.querySelectorAll('#cover button')].map((b) => ({
        name: b.textContent.trim(),
        ...box(b.getBoundingClientRect()),
      })),
    };
  });
}

const inside = (a: Box, b: Box) =>
  a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
const intersects = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

for (const [width, height] of [
  [844, 390],
  [740, 360],
  [390, 844],
] as const) {
  test.describe(`start screen at ${String(width)}x${String(height)}`, () => {
    test.use({ viewport: { width, height }, isMobile: true, hasTouch: true });

    for (const saved of [false, true]) {
      test(saved ? 'with a round to continue' : 'first visit', async ({ page }) => {
        const errors: string[] = [];
        page.on('console', (m) => {
          if (m.type() === 'error') errors.push(m.text());
        });
        page.on('pageerror', (e) => errors.push(e.message));

        await page.goto('/');
        if (saved) {
          await page.evaluate(([k, v]) => {
            localStorage.setItem(k, v);
          }, [KEY_GAME, JSON.stringify(newGame(0, ['Player 1']))] as const);
          await page.reload();
          await expect(page.locator('#cover [data-act=continue]')).toBeVisible();
        }
        await expect(page.locator('#cover [data-act=new]')).toBeVisible();

        const c = await coverBoxes(page);
        expect(c.buttons.map((b) => b.name)).toEqual(
          saved
            ? ['Continue · Hole 1', 'New round', 'Build a hole', 'How to play']
            : ['New round', 'Build a hole', 'How to play'],
        );
        expect(inside(c.title, c.card), `title ${JSON.stringify(c.title)} in card ${JSON.stringify(c.card)}`).toBe(true);
        expect(inside(c.brand, c.card), 'pill in card').toBe(true);
        const foot = c.foot;
        expect(foot !== null || (saved && height < 500), 'footer shown unless a short card has a Continue row too').toBe(true);
        if (foot) expect(inside(foot, c.card), 'footer in card').toBe(true);
        for (const b of c.buttons) {
          expect(inside(b, c.card), `${b.name} ${JSON.stringify(b)} in card ${JSON.stringify(c.card)}`).toBe(true);
          expect(b.w, `${b.name} width`).toBeGreaterThanOrEqual(44);
          expect(b.h, `${b.name} height`).toBeGreaterThanOrEqual(44);
          if (foot) expect(intersects(foot, b), `footer over ${b.name}`).toBe(false);
        }
        expect(errors).toEqual([]);
      });
    }
  });
}
