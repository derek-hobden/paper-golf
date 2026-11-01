import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

declare const process: { env: Record<string, string | undefined> };

// The generic walkthrough defines only the test its plan films. A test that skips itself inside
// its body has already opened a page, so Playwright films an empty clip for it: on PR 105 that
// second clip took the recording out of beat mode, the narration was voiced as one take, and its
// own pause between two paragraphs failed the audio gate (0.9 s at 14.7 s, publish run 41263664161).
const list = (body: string, files: string): string => {
  const was = { body: process.env.PR_BODY, files: process.env.PR_FILES };
  process.env.PR_BODY = body;
  process.env.PR_FILES = files;
  try {
    return execFileSync('npx', ['playwright', 'test', '-c', 'e2e/walkthroughs/playwright.config.ts', '--list', 'e2e/walkthroughs/default.spec.ts'], {
      encoding: 'utf8',
    });
  } finally {
    if (was.body === undefined) delete process.env.PR_BODY;
    else process.env.PR_BODY = was.body;
    if (was.files === undefined) delete process.env.PR_FILES;
    else process.env.PR_FILES = was.files;
  }
};

describe('the generic walkthrough', () => {
  it('defines only the motion explainer for a change with no screen to show', () => {
    const out = list('## How to see it\n\n- before: "One thing", "Two things"\n- after: "Three things"\n', 'scripts/ship/x.sh');
    expect(out).toContain('motion explainer');
    expect(out).not.toContain('explainer walkthrough');
  });

  it('defines only the walkthrough for a change to the app', () => {
    const out = list('## How to see it\n\n- open /\n- click Roll\n', 'src/main.ts');
    expect(out).toContain('explainer walkthrough');
    expect(out).not.toContain('motion explainer');
  });
}, 60_000);
