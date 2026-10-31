import { readFileSync, writeFileSync } from 'node:fs';
import { test } from '@playwright/test';
import { Beats } from '../beats';
import { pageHtml, parseFacts, scenes, storyMarkdown } from './dependency-update-scenes';

// The dependency update explainer, filmed by main's copy for a Dependabot or Renovate pull
// request (scripts/ship/pr-video-deps.sh film, in .github/workflows/pr-video-deps.yml). It draws
// facts.json — the pull request's diff and CI run, read through the API as data — and nothing
// from the pull request's head. It lives outside e2e/walkthroughs/*.spec.ts, so the recorder of an
// ordinary pull request (scripts/ship/pr-video-record.sh) never films it.

// This file runs in Node, but tsconfig only loads browser types (no @types/node).
declare const process: { env: Record<string, string | undefined> };

test('dependency update explainer', async ({ page }) => {
  const file = process.env['FACTS_FILE'] ?? '';
  const out = process.env['VIDEO_OUT'] ?? '';
  test.skip(file === '' || out === '', 'filmed only by pr-video-deps.sh film');
  const facts = parseFacts(JSON.parse(readFileSync(file, 'utf8')));
  // Facts that do not read are no film at all: the run fails, and nothing is bought.
  if (facts === undefined) throw new Error(`${file} is not a dependency update's facts`);
  // The clock first, from the page's own creation: that is when its recording began.
  const beats = await Beats.from(page);
  await page.setContent(pageHtml(facts));
  for (const [i, scene] of scenes(facts).entries()) {
    await page.evaluate((n) => {
      document.body.dataset['scene'] = String(n);
    }, i);
    beats.mark();
    await page.waitForTimeout(scene.seconds * 1_000);
  }
  beats.save();
  // The spec and the steps the narration reads, one step per scene, beside beats.json.
  writeFileSync(`${out.replace(/\/+$/, '').replace(/\/[^/]*$/, '')}/story.md`, storyMarkdown(facts));
});
