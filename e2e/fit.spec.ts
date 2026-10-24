import { test } from '@playwright/test';
import { fitCases } from './fitcases';

// Every screen fits every phone held upright (390x844, 390x664, 375x548); the sizes a phone on its side and a
// desktop take are `e2e/fitwide.spec.ts`. Both files are the same cases from `e2e/fitcases.ts`, split in two
// because Playwright shards whole files and one file of them outgrew its 8-minute step.

// A failing case leaves a screenshot of the screen next to its trace (test-results/). A control pushed off the
// screen fails its click in seconds, not at the 60 s test timeout.
test.use({ screenshot: 'only-on-failure', actionTimeout: 10_000 });

fitCases('upright');
