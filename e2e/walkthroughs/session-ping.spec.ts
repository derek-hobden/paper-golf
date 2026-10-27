import { readdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { filmGenericWalkthrough } from './generic';
import { SCENE_SECONDS, SCENES_HTML } from './session-ping-scenes';
import { sessionPingFilm } from './sessionping';

// The session ping explainer: a short motion piece of animated diagrams (before, a
// stalled cloud session nobody hears about; after, the hook's one signal, Flo routing
// it to the bot that owns the session, and that bot acting). It is filmed only for a
// pull request that touches the hook. For any other pull request it films exactly
// what default.spec.ts does, or nothing when that pull request checked in its own
// walkthrough, so it never changes what a later pull request gets filmed
// (./sessionping.ts, tests/session-ping.test.ts).

// This file runs in Node, but tsconfig only loads browser types.
declare const process: { env: Record<string, string | undefined> };

const files = (process.env.PR_FILES ?? '').split('\n').filter((f) => f !== '');
const film = sessionPingFilm(files, readdirSync(decodeURIComponent(new URL('.', import.meta.url).pathname)));

test.skip(film === 'none', 'another checked-in walkthrough is filmed instead');
// The scenes are drawn for a 16:9 frame, which is what the finished video is: filmed
// once, at desktop size, rather than twice with the phone copy letterboxed.
test.skip(({ isMobile }) => film === 'explainer' && isMobile, 'the explainer is filmed once, at desktop size');

test('explainer walkthrough', async ({ page }) => {
  if (film === 'default') {
    await filmGenericWalkthrough(page);
    return;
  }
  await page.setContent(SCENES_HTML);
  for (const [i, seconds] of SCENE_SECONDS.entries()) {
    await page.evaluate((n) => {
      document.body.dataset['scene'] = String(n);
    }, i);
    await page.waitForTimeout(seconds * 1_000);
  }
});
