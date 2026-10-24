import { test } from '@playwright/test';
import { fitCases } from './fitcases';

// Every screen fits a phone on its side (844x390, 740x360) and a desktop (1440x900); the upright phone sizes are
// `e2e/fit.spec.ts`. Both files are the same cases from `e2e/fitcases.ts`, split in two because Playwright shards
// whole files and one file of them outgrew its 8-minute step.

// A failing case leaves a screenshot of the screen next to its trace (test-results/). A control pushed off the
// screen fails its click in seconds, not at the 60 s test timeout.
test.use({ screenshot: 'only-on-failure', actionTimeout: 10_000 });

fitCases('wide');
