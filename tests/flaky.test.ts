import { describe, expect, it } from 'vitest';
import { passedOnRetry } from './flaky-playwright-reporter';
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
});
