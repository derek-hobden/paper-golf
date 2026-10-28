import { writeFileSync } from 'node:fs';

// This file runs in Node, but tsconfig only loads browser types (no @types/node), as in
// playwright.config.ts.
declare const process: { env: Record<string, string | undefined> };

/** The scene starts a walkthrough keeps, in seconds from when its recording began. */
export class Beats {
  private readonly t0 = performance.now();
  private readonly starts: number[] = [];

  /** Marks the start of the next scene, now. */
  mark(): void {
    this.starts.push(Math.round((performance.now() - this.t0) / 10) / 100);
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
