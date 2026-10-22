import { writeFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

// This file runs in Node; tsconfig loads browser types only, so declare the one global it reads.
declare const process: { env: Record<string, string | undefined> };

/** A Playwright attempt that passed after a failed try. `retry` is 0 on the first attempt. */
export function passedOnRetry(status: string, retry: number): boolean {
  return status === 'passed' && retry > 0;
}

/**
 * Where the retry record goes. CI runs the suite as one project per step (each inside the
 * 8-minute step limit), so each step names its own file and neither overwrites the other.
 */
export function recordPath(name: string | undefined): string {
  return name === undefined || name === '' ? 'flaky-playwright.json' : name;
}

class FlakyReporter implements Reporter {
  private readonly names: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!passedOnRetry(result.status, result.retry)) return;
    this.names.push(test.titlePath().filter((part) => part !== '').join(' > '));
  }

  onEnd(): void {
    writeFileSync(recordPath(process.env.FLAKY_PLAYWRIGHT_FILE), JSON.stringify(this.names));
  }
}

export default FlakyReporter;
