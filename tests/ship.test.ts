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
  it('production post-deploy smoke is smoke:quick and the suite runs in shards', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const smoke = jobYaml(ci, 'smoke');
    const smokeShard = jobYaml(ci, 'smoke-shard');
    const staging = jobYaml(deploy, 'staging');
    const stagingSmoke = jobYaml(deploy, 'staging-smoke');
    const production = jobYaml(deploy, 'production');
    const prodSmoke = stepYaml(production, 'smoke production');
    const shard = 'npx playwright test --project="$PROJECT" --shard="$SHARD/$SHARD_TOTAL"';
    // `npm run smoke` is a substring of `npm run smoke:quick`, so the suite is the whole line.
    expect(prodSmoke.split('\n')).toContain('        run: npm run smoke:quick');
    expect(prodSmoke.split('\n')).not.toContain('        run: npm run smoke');
    // The jobs named smoke and staging only gate the shards. The suite itself is the matrix.
    expect(smoke).not.toContain('npx playwright test');
    expect(smoke).not.toContain('npm run smoke');
    expect(smokeShard).toContain(shard);
    expect(smokeShard).not.toContain('smoke:quick');
    expect(staging).not.toContain('npx playwright test');
    expect(staging).not.toContain('npm run smoke');
    expect(staging).not.toContain('smoke:quick');
    expect(stagingSmoke).toContain(shard);
    expect(stagingSmoke).toContain('SMOKE_BASE_URL');
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
    expect(cases.filter((name) => name.startsWith('auto_merge_')).length).toBeGreaterThanOrEqual(8);
    expect(cases).toContain('auto_merge_risk_low_enables');
    expect(cases).toContain('auto_merge_enables_for_any_risk');
    expect(cases).toContain('auto_merge_enables_before_the_video');
    expect(cases).toContain('no_signoff_check');
    // Adding the `approved` label is pressing Approve: one case per rule of it.
    expect(cases.filter((name) => name.startsWith('approve_')).length).toBeGreaterThanOrEqual(12);
    expect(cases).toContain('approve_help_and_usage');
    expect(cases).toContain('approve_an_approver_on_the_list_approves');
    expect(cases).toContain('approve_a_stranger_loses_the_label');
    expect(cases).toContain('approve_the_allowlist_comes_from_the_variable');
    expect(cases).toContain('approve_the_allowlist_file_is_the_default');
    expect(cases).toContain('approve_an_empty_allowlist_approves_nobody');
    expect(cases).toContain('approve_a_draft_or_a_closed_pull_request_is_not_approved');
    expect(cases).toContain('approve_a_fork_is_not_approved');
    expect(cases).toContain('approve_dismisses_on_a_new_commit');
    expect(cases).toContain('approve_dismiss_leaves_a_human_review_alone');
    expect(cases).toContain('approve_dismiss_tolerates_an_already_dismissed_review');
    expect(cases).toContain('approve_dismiss_with_no_review_of_its_own_still_drops_the_label');
    expect(cases).toContain('approve_never_runs_pull_request_code');
    // The approval covers the commit the approver saw, and nothing else.
    expect(cases).toContain('approve_refuses_a_head_that_moved_since_the_label');
    expect(cases).toContain('approve_drops_its_own_review_when_the_head_moves_under_it');
    expect(cases).toContain('approve_rule_is_written_down');
    expect(cases).toContain('ci_owner_approval_workflow');
    // One update run at a time, oldest first, and never a paid dispatch.
    expect(cases).toContain('update_oldest_first');
    expect(cases).toContain('update_never_dispatches_the_paid_jobs');
    expect(cases).toContain('update_rule_is_written_down');
    // Two markers for a watcher to watch: ready once per head, and blocked.
    expect(cases.filter((name) => name.startsWith('signal_')).length).toBeGreaterThanOrEqual(12);
    expect(cases).toContain('signal_help_and_usage');
    expect(cases).toContain('signal_posts_one_comment_when_everything_is_green');
    expect(cases).toContain('signal_is_quiet_until_the_checks_are_green');
    expect(cases).toContain('signal_waits_for_the_video_link');
    expect(cases).toContain('signal_only_once_per_head_sha');
    expect(cases).toContain('signal_moves_to_the_new_head');
    expect(cases).toContain('signal_a_bot_pull_request_needs_no_video');
    expect(cases).toContain('signal_a_draft_or_a_fork_says_nothing');
    expect(cases).toContain('signal_blocked_says_what_failed_with_the_run_link');
    expect(cases).toContain('signal_blocked_edits_its_own_comment');
    expect(cases).toContain('signal_blocked_needs_to_know_what_failed');
    expect(cases).toContain('signal_finds_the_pull_request_from_the_head_sha');
    expect(cases).toContain('signal_never_runs_pull_request_code');
    expect(cases).toContain('signal_ignores_a_marker_comment_a_person_wrote');
    expect(cases).toContain('signal_rule_is_written_down');
    expect(cases).toContain('ci_pr_signal_workflow');
    // The rollout checklist names every workflow and script, and no secret value.
    expect(cases).toContain('rollout_doc_lists_everything_a_new_repo_needs');
    expect(cases).toContain('rollout_doc_holds_no_secret_values');
    expect(cases).toContain('gus_mints_and_execs_gh');
    expect(cases).toContain('gus_needs_the_app_env');
    expect(cases).toContain('gus_refuses_a_bad_token_response');
    expect(cases).toContain('gus_help_does_not_mint');
    expect(cases).toContain('gus_rule_is_written_down');
    expect(cases).toContain('auto_merge_dependabot_without_a_video');
    expect(cases).toContain('auto_merge_draft_is_a_no_op');
    expect(cases).toContain('auto_merge_fork_is_a_no_op');
    expect(cases).toContain('auto_merge_closed_pr_is_a_no_op');
    expect(cases).toContain('auto_merge_explains_a_refused_enable');
    expect(cases).toContain('ci_auto_merge_on_open');
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
    // The explainer video is an asset on one long-lived prerelease: the
    // user-attachments endpoint answers 404 to an App token.
    expect(cases).toContain('upload_puts_the_video_on_the_release');
    expect(cases).toContain('upload_creates_the_release_when_it_is_missing');
    expect(cases).toContain('upload_replaces_an_asset_for_the_same_commit');
    expect(cases).toContain('upload_refuses_an_answer_that_is_not_the_asset_link');
    expect(cases).toContain('upload_reports_a_refusal_in_full');
    expect(cases).toContain('body_refuses_a_link_that_is_not_the_release_asset');
    // Every deploy-gate case by name: one rule each, so dropping any one of them fails here
    // rather than quietly lowering the count.
    expect(cases.filter((name) => name.startsWith('deploy_gate_')).length).toBeGreaterThanOrEqual(16);
    expect(cases).toContain('deploy_gate_help');
    expect(cases).toContain('deploy_gate_usage');
    expect(cases).toContain('deploy_gate_green_push_deploys');
    expect(cases).toContain('deploy_gate_stale_push_does_not');
    expect(cases).toContain('deploy_gate_cancelled_skipped_or_failed_never_deploys');
    expect(cases).toContain('deploy_gate_unfinished_ci_does_not');
    expect(cases).toContain('deploy_gate_only_main_in_this_repo_deploys');
    expect(cases).toContain('deploy_gate_only_a_push_or_the_dispatch_deploys');
    expect(cases).toContain('deploy_gate_bad_sha_does_not');
    expect(cases).toContain('deploy_gate_request_must_name_the_same_commit');
    expect(cases).toContain('deploy_gate_request_must_name_the_same_event');
    expect(cases).toContain('deploy_gate_request_sha_must_be_a_commit');
    expect(cases).toContain('deploy_gate_missing_request_does_not');
    expect(cases).toContain('deploy_gate_dispatch_deploys_the_confirmed_sha');
    expect(cases).toContain('deploy_gate_dispatch_needs_confirmation');
    expect(cases).toContain('deploy_gate_normal_dispatch_deploys_like_a_push');
    expect(cases).toContain('deploy_gate_stale_normal_dispatch_does_not');
    expect(cases).toContain('deploy_gate_push_request_carries_no_confirm');
    expect(cases).toContain('deploy_gate_tip_lookup_failure_does_not');
    expect(cases).toContain('ci_deploy_only_after_a_green_ci_run');
    expect(cases).toContain('ci_smoke_timeout_has_headroom');
    // Deploys never hang: the browsers come with the container, every long step is
    // bounded and retried once, and the run says in one line how it went.
    expect(cases).toContain('ci_browsers_come_from_the_playwright_container');
    expect(cases).toContain('ci_deploy_summary_and_notify');
    expect(cases.filter((name) => name.startsWith('retry_')).length).toBeGreaterThanOrEqual(6);
    expect(cases).toContain('retry_passes_first_time');
    expect(cases).toContain('retry_tries_once_more');
    expect(cases).toContain('retry_gives_up_after_the_last_attempt');
    expect(cases).toContain('retry_times_out_a_hung_command');
    expect(cases).toContain('retry_leaves_the_commands_stdout_alone');
    expect(cases).toContain('retry_usage');
    expect(cases).toContain('container_chrome_names_the_images_browser');
    expect(cases).toContain('container_chrome_says_when_there_is_none');
    expect(cases).toContain('deploy_summary_live');
    expect(cases).toContain('deploy_summary_failed_job');
    expect(cases).toContain('deploy_summary_no_deploy_is_silent');
    // A PR explainer is narrated with one endpoint, one model and one voice, or not at all.
    expect(cases.filter((name) => name.startsWith('narrate_')).length).toBeGreaterThanOrEqual(4);
    expect(cases).toContain('narrate_pins_the_model_and_voice');
    expect(cases).toContain('narrate_needs_the_key');
    expect(cases).toContain('narrate_refuses_a_bad_answer');
    expect(cases).toContain('narrate_rule_is_written_down');
    expect(cases).toContain('same_tree_skip');
    expect(cases).toContain('verify_chrome_doctor');
    expect(cases).toContain('no_tags_in_ship_scripts_or_workflows');
    // Every main commit gets a CI run: a merge GitHub makes with its own token raises no
    // push event, so nothing deploys from it unless the reconciler dispatches one.
    expect(cases.filter((name) => name.startsWith('reconcile_')).length).toBeGreaterThanOrEqual(16);
    expect(cases).toContain('reconcile_help');
    expect(cases).toContain('reconcile_usage');
    expect(cases).toContain('reconcile_dispatches_a_main_sha_with_no_ci_run');
    expect(cases).toContain('reconcile_leaves_a_sha_that_has_a_run');
    expect(cases).toContain('reconcile_counts_its_own_dispatch_run');
    expect(cases).toContain('reconcile_ignores_a_pull_request_run');
    expect(cases).toContain('reconcile_ignores_an_emergency_dispatch_run');
    expect(cases).toContain('reconcile_only_a_push_run_is_main_heads_ci_run');
    expect(cases).toContain('reconcile_unreadable_runs_do_not_dispatch');
    expect(cases).toContain('reconcile_leaves_a_commit_too_young_to_judge');
    expect(cases).toContain('reconcile_bad_commit_date_does_not_dispatch');
    expect(cases).toContain('reconcile_confirms_its_dispatch_was_listed');
    expect(cases).toContain('reconcile_dispatches_once_per_sha');
    expect(cases).toContain('reconcile_dry_run_never_dispatches');
    expect(cases).toContain('reconcile_unreadable_github_does_not_dispatch');
    expect(cases).toContain('reconcile_bad_sha_does_not_dispatch');
    expect(cases).toContain('reconcile_explains_a_refused_dispatch');
    expect(cases).toContain('ci_reconcile_workflow');
    expect(cases).toContain('ci_dispatch_path_runs_the_push_pipeline');
    expect(cases).toContain('ci_deploy_group_only_for_main_ci_runs');
    expect(cases).toContain('start_deploy_dispatches_for_the_bot');
    expect(cases).toContain('start_deploy_refuses_a_person');
    expect(cases).toContain('start_deploy_cannot_loop');
    expect(cases).toContain('read_ci_run_waits_until_completed');
    expect(cases).toContain('ci_token_run_dispatches_deploy');
    expect(cases).toContain('ci_staging_smoke_has_headroom');
    // The recorder knows which files a pull request touches, or says so and films nothing.
    expect(cases).toContain('record_fails_loudly_without_a_file_list');
    expect(cases).toContain('record_trusts_a_checkout_another_user_owns');
  });

  // The two incidents of 22 Oct 2026, in the workflows themselves:
  // - PR 22, merged by GitHub's native auto-merge, left main d75953a with no CI run, so no
  //   deploy ever ran. ci.yml takes a normal dispatch (no inputs) for main HEAD, the
  //   reconciler dispatches it, and deploy-gate.sh gates that CI run as it gates a push run.
  // - PR 23's real deploy was cancelled with no jobs, displaced in the single
  //   paper-golf-deploy concurrency group by deploy runs from PR-branch CI completions.
  it('a main commit with no CI run is dispatched, and only a main CI run holds the deploy group', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    const deploy = readFileSync('.github/workflows/deploy.yml', 'utf8');
    const reconcile = readFileSync('.github/workflows/reconcile-ci.yml', 'utf8');
    // Neither dispatch input is required, so a dispatch with none is the normal path.
    expect(ci).not.toContain('required: true');
    expect(jobYaml(ci, 'resolve')).toContain('mode=reconcile');
    expect(reconcile).toContain('scripts/ship/reconcile-ci.sh');
    expect(reconcile).toContain("cron: '*/10 * * * *'");
    expect(reconcile).toContain('actions: write');
    expect(readFileSync('scripts/ship/deploy-gate.sh', 'utf8')).toContain('mode=reconcile');
    // Only the normal dispatch is named as a run of main HEAD, so the emergency dispatch of an
    // older commit — whose run carries the tip's head_sha — is never counted as one.
    const marker = 'CI reconcile dispatch of main HEAD';
    expect(ci).toContain(`'${marker}'`);
    expect(ci).toContain('CI production dispatch of {0}');
    // Only a dispatch is renamed; every other event falls back to GitHub's default run name.
    expect(ci).toContain("github.event_name != 'workflow_dispatch' && ' '");
    expect(readFileSync('scripts/ship/reconcile-ci.sh', 'utf8')).toContain(marker);
    // Staging and the staging smoke run for a dispatched main commit as for a pushed one,
    // with each mode paired to the event it can come from.
    expect(jobYaml(deploy, 'staging')).toContain(
      "(needs.prepare.outputs.mode == 'push' && github.event.workflow_run.event == 'push')",
    );
    expect(jobYaml(deploy, 'staging')).toContain("needs.prepare.outputs.mode == 'reconcile'");
    expect(jobYaml(deploy, 'production')).toContain("needs.prepare.outputs.mode == 'dispatch'");
    // The deploy group: the real one only for a green main push or dispatch run.
    const group = deploy.slice(deploy.indexOf('concurrency:'), deploy.indexOf('permissions:'));
    expect(group).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(group).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(group).toContain("github.event.workflow_run.event == 'push'");
    expect(group).toContain("github.event.workflow_run.event == 'workflow_dispatch'");
    expect(group).toContain("github.event_name == 'workflow_dispatch' && inputs.ci_run_id != ''");
    expect(group).toContain("format('paper-golf-deploy-skipped-{0}', github.event.workflow_run.id)");
    expect(ci).toContain("github.actor == 'github-actions[bot]'");
    expect(ci).toContain('bash scripts/ship/start-deploy.sh');
    expect(group).toContain('cancel-in-progress: false');
    // And a pull request's CI run never starts the workflow in the first place.
    expect(deploy.slice(0, deploy.indexOf('concurrency:'))).toContain('branches: [main]');
  });

  it.each(cases)('%s', { timeout: 30_000 }, (name) => {
    const result = bash(name);
    expect(result.stderr + result.stdout).toContain(`ok ${name}`);
    expect(result.status).toBe(0);
  });
});
