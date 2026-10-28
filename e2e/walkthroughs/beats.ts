import { writeFileSync } from 'node:fs';

// This file runs in Node, but tsconfig only loads browser types (no @types/node), as in
// playwright.config.ts.
declare const process: { env: Record<string, string | undefined> };

/** Enough of a Playwright page to read its clock. */
interface Clocked {
  evaluate(fn: () => number): Promise<number>;
}

/** The scene starts a walkthrough keeps, in seconds from when its recording began. */
export class Beats {
  private readonly starts: number[] = [];

  private constructor(private readonly origin: number) {}

  /**
   * Starts the clock where the recording starts. Playwright films a page from the moment it
   * is created, before the test body runs, so the clock is the page's own time origin (when
   * that page came to be, on the same machine's wall clock), not the moment this is called:
   * a start counted from the test body would put every scene a little early (PR 73 review).
   */
  static async from(page: Clocked): Promise<Beats> {
    return new Beats(await page.evaluate(() => performance.timeOrigin));
  }

  /** Marks the start of the next scene, now. */
  mark(): void {
    this.starts.push(Math.round((Date.now() - this.origin) / 10) / 100);
  }

  /**
   * Leaves the starts as beats.json beside the recorder's clips (VIDEO_OUT is its clips
   * directory), where pr-video-publish.sh's beat mode reads them to hold each scene for
   * exactly its own paragraph of narration (issue 80). Outside the recorder it does nothing.
   */
  save(): void {
    const out = process.env['VIDEO_OUT'];
    if (out === undefined || out === '') return;
    writeFileSync(`${out.replace(/\/+$/, '').replace(/\/[^/]*$/, '')}/beats.json`, JSON.stringify(this.starts));
  }
}
