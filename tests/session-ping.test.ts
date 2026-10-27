import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENE_SECONDS } from '../e2e/walkthroughs/session-ping-scenes';

// The session ping hook is bash; its cases live in scripts/factory/test-session-ping.sh (a fake
// curl on PATH, a temp fixture repo, fixed fake session ids and key, no network). Each runs here
// as one test.
const harness = 'scripts/factory/test-session-ping.sh';

function bash(...args: string[]) {
  return spawnSync('bash', [harness, ...args], { encoding: 'utf8' });
}

const cases = bash('--list').stdout.split('\n').filter((name) => name !== '');

describe('scripts/factory/session-ping.sh', () => {
  it('has every case the hook was proven with', () => {
    expect(cases).toHaveLength(22);
    expect(cases).toContain('stop_plain_finished_text_is_done');
    expect(cases).toContain('stop_transcript_question_before_a_trailing_tool_use');
    expect(cases).toContain('stop_asking_without_a_question_mark_is_done');
    expect(cases).toContain('stop_question_mark_before_markdown_is_a_question');
    expect(cases).toContain('stop_prefers_last_assistant_message_to_the_transcript');
    expect(cases).toContain('stop_rhetorical_question_early_in_a_long_message_is_done');
    expect(cases).toContain('stop_question_mark_only_in_a_url_is_done');
    expect(cases).toContain('notification_is_a_question');
    expect(cases).toContain('manual_error_is_an_error');
    expect(cases).toContain('stop_failure_is_an_error');
    expect(cases).toContain('session_end_carries_its_reason');
    expect(cases).toContain('malformed_hook_json_still_posts');
    expect(cases).toContain('outside_a_cloud_session_it_stays_quiet');
    expect(cases).toContain('without_the_key_it_stays_quiet');
    expect(cases).toContain('a_missing_transcript_is_fine');
    expect(cases).toContain('a_failing_curl_never_fails_the_hook');
    expect(cases).toContain('without_debug_it_prints_nothing');
    expect(cases).toContain('the_key_never_leaves_the_curl_config');
    expect(cases).toContain('settings_pin_the_environment_and_the_four_hooks');
    expect(cases).toContain('a_key_with_quotes_and_backslashes_is_escaped');
    expect(cases).toContain('a_plain_http_url_is_refused');
    expect(cases).toContain('a_hanging_webhook_is_cut_off_at_5_seconds');
  });

  it.each(cases)('%s', { timeout: 30_000 }, (name) => {
    const result = bash(name);
    expect(result.stderr + result.stdout).toContain(`ok ${name}`);
    expect(result.status).toBe(0);
  });
});

// The explainer walkthrough: the recorder films it only for a diff that touches the hook or the
// spec (scripts/ship/pr-video-record.sh, `walkthrough-covers`), and it fits a narrated video.
describe('the session ping walkthrough', () => {
  it('opts in by the hook it explains', () => {
    const spec = readFileSync('e2e/walkthroughs/session-ping.spec.ts', 'utf8').split('\n');
    expect(spec).toContain('// walkthrough-covers: scripts/factory/session-ping.sh');
  });

  it('runs inside the 30 to 60 second video a narration fits', () => {
    const seconds = SCENE_SECONDS.reduce((a, b) => a + b, 0);
    expect(seconds).toBeGreaterThanOrEqual(30);
    expect(seconds).toBeLessThanOrEqual(60);
  });
});
