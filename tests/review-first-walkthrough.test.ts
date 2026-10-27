import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filmsReviewFirst, REVIEW_FIRST_FILES, SCENE_SECONDS, SCENES_HTML } from '../e2e/walkthroughs/review-first-scenes';

// The review-first explainer plays its scenes only for a diff that touches a file of that
// change, and every other pull request gets exactly the generic walkthrough: the recorder on
// main films a pull request's own walkthrough spec instead of default.spec.ts, so
// review-first.spec.ts has to stand in for it, word for word.

const DEFAULT = readFileSync('e2e/walkthroughs/default.spec.ts', 'utf8');
const FALLBACK = readFileSync('e2e/walkthroughs/review-first-fallback.ts', 'utf8');
const SPEC = readFileSync('e2e/walkthroughs/review-first.spec.ts', 'utf8');

/** From the first line that starts with `from` up to (not including) the one that starts with `to`. */
function between(text: string, from: string, to?: string): string {
  const start = text.indexOf(from);
  if (start < 0) throw new Error(`no ${from}`);
  const end = to === undefined ? text.length : text.indexOf(to, start);
  if (end < 0) throw new Error(`no ${to ?? ''}`);
  return text.slice(start, end);
}

describe('the review-first walkthrough', () => {
  it('plays the scenes only for a diff that touches this change', () => {
    expect(filmsReviewFirst(['scripts/ship/review-findings.sh', 'AGENTS.md'])).toBe(true);
    expect(filmsReviewFirst(['e2e/walkthroughs/review-first-scenes.ts'])).toBe(true);
    expect(filmsReviewFirst(['src/main.ts', 'scripts/ship/paid-trigger.sh'])).toBe(false);
    expect(filmsReviewFirst([])).toBe(false);
    // The spec takes that path, and names the same files for the recorder's own selection.
    expect(SPEC).toContain('const scenes = filmsReviewFirst(files);');
    for (const file of REVIEW_FIRST_FILES) expect(SPEC.split('\n')).toContain(`// walkthrough-covers: ${file}`);
  });

  it('otherwise films exactly what default.spec.ts films', () => {
    expect(SPEC).toContain("test('explainer walkthrough', async ({ page }) => {\n    await defaultWalkthrough(page);");
    // The same settings, the same test body and the same step handling, word for word.
    expect(between(FALLBACK, 'const title =', '/** default.spec.ts')).toBe(between(DEFAULT, 'const title =', "test('explainer walkthrough'"));
    const body = between(DEFAULT, "test('explainer walkthrough', async ({ page }) => {\n", '\n});\n')
      .slice("test('explainer walkthrough', async ({ page }) => {\n".length);
    expect(FALLBACK).toContain(`export async function defaultWalkthrough(page: Page): Promise<void> {\n${body}\n}\n`);
    expect(between(FALLBACK, 'async function follow(')).toBe(between(DEFAULT, 'async function follow('));
  });

  it('runs inside the 30 to 60 second video a narration fits, one scene per step', () => {
    const seconds = SCENE_SECONDS.reduce((a, b) => a + b, 0);
    expect(seconds).toBeGreaterThanOrEqual(30);
    expect(seconds).toBeLessThanOrEqual(60);
    SCENE_SECONDS.forEach((_, i) => {
      expect(SCENES_HTML).toContain(`<svg id="s${String(i)}" class="scene"`);
    });
  });
});
