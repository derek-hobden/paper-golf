import { writeFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

/** A Playwright attempt that passed after a failed try. `retry` is 0 on the first attempt. */
export function passedOnRetry(status: string, retry: number): boolean {
  return status === 'passed' && retry > 0;
}

class FlakyReporter implements Reporter {
  private readonly names: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (!passedOnRetry(result.status, result.retry)) return;
    this.names.push(test.titlePath().join(' > '));
  }

  onEnd(): void {
    writeFileSync('flaky-playwright.json', JSON.stringify(this.names));
  }
}

export default FlakyReporter;
