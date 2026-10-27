import { expect, type Page } from '@playwright/test';
import { tapMarker } from '../tap';
import { planFor, type Step } from './plan';

// The generic explainer walkthrough, for review-first.spec.ts to fall back to on every
// pull request that is not the review-first one. The recorder (scripts/ship/pr-video-record.sh,
// as main has it) films a pull request's own walkthrough spec instead of default.spec.ts, and a
// spec file may not import another, so this is default.spec.ts's walkthrough copied word for
// word: tests/review-first-walkthrough.test.ts fails the moment the two differ. Once PR 62's
// `walkthrough-covers` selection is on main, the recorder picks the spec by the diff and this
// copy can go.

// This file runs in Node, but tsconfig only loads browser types.
declare const process: { env: Record<string, string | undefined> };

const title = process.env.PR_TITLE ?? 'This pull request';
const files = (process.env.PR_FILES ?? '').split('\n').filter((f) => f !== '');
const plan = planFor(process.env.PR_BODY ?? '', files);

/** How long one step may take before the walkthrough gives up on it and moves on. */
const STEP_MS = 6_000;
/** Long enough to read, short enough that nobody skips the video. */
const CARD_MS = 3_000;

function card(heading: string, lines: readonly string[]): string {
  const items = lines.map((line) => `<li>${line.replace(/[<&]/g, '')}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;display:grid;place-items:center;
    height:100vh;background:#fdfbf4;color:#23324a;font:16px/1.5 system-ui,sans-serif">
    <main style="max-width:46rem;padding:2rem">
      <h1 style="font-size:2rem;margin:0 0 1rem">${heading.replace(/[<&]/g, '')}</h1>
      <ul style="margin:0;padding-left:1.2rem">${items}</ul>
    </main></body>`;
}

/** default.spec.ts's `explainer walkthrough` test body. */
export async function defaultWalkthrough(page: Page): Promise<void> {
  await page.setContent(card(title, plan.kind === 'card' ? files.slice(0, 12) : []));
  await page.waitForTimeout(CARD_MS);

  for (const step of plan.steps) {
    try {
      await follow(page, step);
    } catch {
      // Say so on stdout and keep filming: the narration describes what the
      // video shows, and an unfollowable step is not a broken pull request.
      console.log(`walkthrough: could not follow — ${step.raw}`);
    }
  }

  if (plan.kind !== 'card') await page.waitForTimeout(1_000);
  // The recording is the output. Nothing here is allowed to fail the job.
  expect(plan.kind).toMatch(/^(walkthrough|tour|card)$/);
}

async function follow(page: import('@playwright/test').Page, step: Step): Promise<void> {
  switch (step.kind) {
    case 'open':
      await page.goto(step.path, { timeout: STEP_MS });
      await page.waitForTimeout(800);
      return;
    case 'click': {
      const target = await named(page, step.text);
      await target.click({ timeout: STEP_MS });
      await page.waitForTimeout(800);
      return;
    }
    case 'type': {
      const field = page
        .getByLabel(step.into, { exact: false })
        .or(page.getByPlaceholder(step.into, { exact: false }))
        .first();
      await field.fill(step.text, { timeout: STEP_MS });
      await page.waitForTimeout(500);
      return;
    }
    case 'expect':
      await expect(page.getByText(step.text, { exact: false }).first()).toBeVisible({ timeout: STEP_MS });
      await page.waitForTimeout(500);
      return;
    case 'wait':
      await page.waitForTimeout(step.seconds * 1_000);
      return;
    case 'shot': {
      const marker = page.locator('g.target.hit').or(page.locator('g.target.putt')).first();
      await marker.waitFor({ state: 'visible', timeout: STEP_MS });
      await tapMarker(page, marker);
      await page.waitForTimeout(1_200);
      return;
    }
    case 'beat':
      await page.waitForTimeout(1_200);
      return;
  }
}

/**
 * A control by the words on it. A button wins over a link, and a link over
 * plain text, because a page that says "Roll the die" above a Roll button has
 * two matches and only one of them does anything when it is clicked.
 */
async function named(page: import('@playwright/test').Page, text: string) {
  const candidates = [
    page.getByRole('button', { name: text, exact: false }),
    page.getByRole('link', { name: text, exact: false }),
    page.getByText(text, { exact: false }),
  ];
  for (const candidate of candidates) {
    const first = candidate.first();
    try {
      await first.waitFor({ state: 'visible', timeout: 2_000 });
      return first;
    } catch {
      // Try the next kind of match.
    }
  }
  // Nothing matched; let the click report the miss with the words asked for.
  return page.getByText(text, { exact: false }).first();
}
