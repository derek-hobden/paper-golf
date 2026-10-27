import { test } from '@playwright/test';
import { filmGenericWalkthrough } from './generic';

// The explainer walkthrough. CI records this against the production build and
// narrates the recording afterwards (AGENTS.md "PR explainer videos"). It takes
// its steps from the pull request's own `## How to see it` section, so it is
// different on every pull request and cannot be written as a fixed test.
//
// It never fails. A step that cannot be followed is noted on stdout and the
// walkthrough carries on, because a video the narration can talk over is worth
// more than a red job: the pull request's real checks are check and smoke.
//
// A pull request that wants something specific on film adds its own spec file
// next to this one; the recorder runs those instead.

// The steps, the tour and the title card are in ./generic.ts.
test('explainer walkthrough', async ({ page }) => {
  await filmGenericWalkthrough(page);
});
