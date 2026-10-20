import { writeFileSync } from 'node:fs';
import type { Reporter, TestCase } from 'vitest/node';

/** A test that failed and then passed on its automatic retry. */
export function flakyTitle(state: string, retryCount: number, fullName: string): string | undefined {
  if (state === 'passed' && retryCount > 0) return fullName;
  return undefined;
}

/** Writes flaky-vitest.json: names of tests that passed only on a retry. */
export default class FlakyReporter implements Reporter {
  private readonly names: string[] = [];

  onTestCaseResult(testCase: TestCase): void {
    const title = flakyTitle(testCase.result().state, testCase.diagnostic()?.retryCount ?? 0, testCase.fullName);
    if (title !== undefined) this.names.push(title);
  }

  onTestRunEnd(): void {
    writeFileSync('flaky-vitest.json', JSON.stringify(this.names));
  }
}
