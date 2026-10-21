import type { Page } from '@playwright/test';

/**
 * Browser console errors and uncaught page errors.
 * Every `@quick` test expects the list to be empty: production's post-deploy smoke is those tests,
 * and a console error there rolls the deploy back.
 */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}
