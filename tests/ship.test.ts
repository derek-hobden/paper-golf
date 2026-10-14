import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// The deploy-watch and GitHub mirror scripts are bash; their cases live in
// scripts/ship/test-ship.sh (fake gh / curl / git, temp fixture repos). Each runs here as one test.
const harness = 'scripts/ship/test-ship.sh';

function bash(...args: string[]) {
  return spawnSync('bash', [harness, ...args], { encoding: 'utf8' });
}

const cases = bash('--list').stdout.split('\n').filter((name) => name !== '');

describe('scripts/ship', () => {
  it('has the deploy-watch and mirror cases', () => {
    expect(cases.filter((name) => name.startsWith('wait_')).length).toBeGreaterThan(10);
    expect(cases.filter((name) => name.startsWith('mirror_')).length).toBeGreaterThan(5);
  });

  it.each(cases)('%s', { timeout: 30_000 }, (name) => {
    const result = bash(name);
    expect(result.stderr + result.stdout).toContain(`ok ${name}`);
    expect(result.status).toBe(0);
  });
});
