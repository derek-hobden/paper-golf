import { describe, expect, it } from 'vitest';
import { passedOnRetry, recordPath } from './flaky-playwright-reporter';
import { flakyTitle } from './flaky-reporter';

describe('flaky retry', () => {
  it('names a vitest pass that needed a retry', () => {
    expect(flakyTitle('passed', 1, 'rules > wind')).toBe('rules > wind');
    expect(flakyTitle('passed', 0, 'rules > wind')).toBeUndefined();
    expect(flakyTitle('failed', 1, 'rules > wind')).toBeUndefined();
  });

  it('names a playwright pass on a later attempt', () => {
    expect(passedOnRetry('passed', 1)).toBe(true);
    expect(passedOnRetry('passed', 0)).toBe(false);
    expect(passedOnRetry('failed', 1)).toBe(false);
  });

  // CI runs the suite as one project per step, so each step writes its own record and the
  // second does not overwrite the first. Unset (every local run) keeps the one file.
  it('keeps one retry record per run', () => {
    expect(recordPath(undefined)).toBe('flaky-playwright.json');
    expect(recordPath('')).toBe('flaky-playwright.json');
    expect(recordPath('flaky-playwright-chrome.json')).toBe('flaky-playwright-chrome.json');
    expect(recordPath('flaky-playwright-webkit.json')).not.toBe(recordPath('flaky-playwright-chrome.json'));
  });
});
