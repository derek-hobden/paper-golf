import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';

// The ship scripts are bash; their cases live in scripts/ship/test-ship.sh (fake gh / curl / npm /
// actionlint / git, temp fixture repos, no real remote). Each runs here as one test.
const harness = 'scripts/ship/test-ship.sh';

function bash(...args: string[]) {
  return spawnSync('bash', [harness, ...args], { encoding: 'utf8' });
}

const cases = bash('--list').stdout.split('\n').filter((name) => name !== '');

/** The lines of one workflow job, from its `  name:` header up to the next job. */
function jobYaml(yml: string, name: string): string {
  const lines = yml.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  if (start < 0) throw new Error(`no ${name} job`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[a-z_-]+:$/.test(at(lines, i))) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** One step inside a job, from its `name:` line up to the next step. */
function stepYaml(job: string, name: string): string {
  const lines = job.split('\n');
  const start = lines.indexOf(`      - name: ${name}`);
  if (start < 0) throw new Error(`no ${name} step`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (at(lines, i).startsWith('      - ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('scripts/ship', () => {
  it('production post-deploy smoke is smoke:quick and staging runs the full suite', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const smoke = jobYaml(ci, 'smoke');
    const staging = jobYaml(deploy, 'staging');
    const production = jobYaml(deploy, 'production');
    const prodSmoke = stepYaml(production, 'smoke production');
    // `npm run smoke` is a substring of `npm run smoke:quick`, so the suite is the whole line.
    expect(prodSmoke.split('\n')).toContain('        run: npm run smoke:quick');
    expect(prodSmoke.split('\n')).not.toContain('        run: npm run smoke');
    expect(staging.split('\n')).toContain('        run: npm run smoke');
    expect(staging).not.toContain('smoke:quick');
    expect(smoke.split('\n')).toContain('      - run: npm run smoke');
    expect(smoke).not.toContain('smoke:quick');
    expect(production.split('\n')).toContain(
      '            if [ -n "$LAST_GOOD_URL" ] && SMOKE_BASE_URL="$LAST_GOOD_URL" npm run smoke; then',
    );
  });

  it('has the deploy-watch, pr-risk, check and workflow cases', () => {
    expect(cases.filter((name) => name.startsWith('wait_')).length).toBeGreaterThan(10);
    expect(cases.filter((name) => name.startsWith('risk_')).length).toBeGreaterThanOrEqual(6);
    expect(cases.filter((name) => name.startsWith('check_')).length).toBeGreaterThanOrEqual(3);
    expect(cases.filter((name) => name.startsWith('ci_')).length).toBeGreaterThanOrEqual(6);
    expect(cases).toContain('push_to_main_retired');
    expect(cases).toContain('ci_no_branch_or_pr_preview_deploys');
    expect(cases).toContain('ci_claude_review_on_every_pr');
    expect(cases).toContain('review_status_workflow');
    expect(cases).toContain('review_status_bot');
    expect(cases).toContain('review_status_secret');
    expect(cases).toContain('review_status_no_verdict');
    expect(cases).toContain('review_status_generic');
    expect(cases).toContain('review_status_api_error');
    expect(cases).toContain('review_status_pass_updates');
    expect(cases).toContain('review_status_comment_endpoint');
    expect(cases).toContain('review_status_comment_created');
    expect(cases).toContain('review_status_comment_gone');
    expect(cases).toContain('review_status_comment_no_permission');
    expect(cases).toContain('review_status_blocked');
    expect(cases).toContain('ci_signoff_on_risk_high');
    expect(cases.filter((name) => name.startsWith('auto_merge_')).length).toBeGreaterThanOrEqual(8);
    expect(cases).toContain('auto_merge_risk_low_enables');
    expect(cases).toContain('auto_merge_risk_high_does_not');
    expect(cases).toContain('auto_merge_unlabelled_does_not');
    expect(cases).toContain('auto_merge_closed_pr_is_a_no_op');
    expect(cases).toContain('auto_merge_explains_a_refused_enable');
    expect(cases).toContain('ci_auto_merge_after_the_review');
    expect(cases.filter((name) => name.startsWith('video_')).length).toBeGreaterThanOrEqual(10);
    expect(cases).toContain('video_product_video_passes');
    expect(cases).toContain('video_pr_explainer_file_fails');
    expect(cases).toContain('video_qa_video_path_fails');
    expect(cases).toContain('video_docs_pr_videos_fails');
    expect(cases).toContain('video_missing_link_fails');
    expect(cases).toContain('video_link_must_be_the_first_non_empty_line');
    expect(cases).toContain('video_dependabot_exempt');
    expect(cases).toContain('video_renovate_exempt');
    expect(cases).toContain('ci_pr_video_workflow');
    expect(cases).toContain('same_tree_skip');
    expect(cases).toContain('verify_chrome_doctor');
    expect(cases).toContain('no_tags_in_ship_scripts_or_workflows');
  });

  it.each(cases)('%s', { timeout: 30_000 }, (name) => {
    const result = bash(name);
    expect(result.stderr + result.stdout).toContain(`ok ${name}`);
    expect(result.status).toBe(0);
  });
});
