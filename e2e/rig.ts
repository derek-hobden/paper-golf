import type { Page } from '@playwright/test';

/**
 * The die comes from `crypto.getRandomValues`; this replaces it with the values queued in `<html data-dice>`
 * (comma-separated, used in order), so a test decides every roll.
 */
export async function rigDice(page: Page) {
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

export async function queueDice(page: Page, ...dice: number[]) {
  await page.evaluate((d) => {
    document.documentElement.dataset.dice = d.join(',');
  }, dice);
}
