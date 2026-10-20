import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// The ship scripts are bash; their cases live in scripts/ship/test-ship.sh (fake gh / curl / npm /
// actionlint / git, temp fixture repos, no real remote). Each runs here as one test.
const harness = 'scripts/ship/test-ship.sh';

function bash(...args: string[]) {
  return spawnSync('bash', [harness, ...args], { encoding: 'utf8' });
}

const cases = bash('--list').stdout.split('\n').filter((name) => name !== '');

describe('scripts/ship', () => {
  it('has the deploy-watch, pr-risk, check and workflow cases', () => {
    expect(cases.filter((name) => name.startsWith('wait_')).length).toBeGreaterThan(10);
    expect(cases.filter((name) => name.startsWith('risk_')).length).toBeGreaterThanOrEqual(6);
    expect(cases.filter((name) => name.startsWith('check_')).length).toBeGreaterThanOrEqual(3);
    expect(cases.filter((name) => name.startsWith('ci_')).length).toBeGreaterThanOrEqual(6);
    expect(cases).toContain('push_to_main_retired');
    expect(cases).toContain('ci_no_branch_or_pr_preview_deploys');
    expect(cases).toContain('ci_claude_review_on_every_pr');
    expect(cases).toContain('no_tags_in_ship_scripts_or_workflows');
  });

  it.each(cases)('%s', { timeout: 30_000 }, (name) => {
    const result = bash(name);
    expect(result.stderr + result.stdout).toContain(`ok ${name}`);
    expect(result.status).toBe(0);
  });
});
