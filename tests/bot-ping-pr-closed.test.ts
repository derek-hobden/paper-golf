/**
 * bot-ping-pr-closed.yml: a bot's pull request closed without merging pings the owning bot (kind
 * closed_unmerged, with who closed it). A merged PR and a human's PR never ping.
 *
 * pull_request_target runs main's copy with the repo's secrets even for a fork, so the workflow checks
 * nothing out and runs nothing from the pull request: it reads only the event payload, inlines the bot
 * filter (kept identical to scripts/ci/is-bot-pr.sh by a test below) and posts with curl. Ported from the
 * fleet template's RuckBee tests. Harness: tests/bot-ping-harness.ts.
 */

import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  block,
  contractChecks,
  event,
  expectNoSecretsPrinted,
  expectRealShaped,
  IS_BOT_PR,
  jobSteps,
  jobText,
  prUrl,
  R,
  readWorkflow,
  stepNamed,
  useStubs,
  workflowEnv,
  type RunOpts,
} from './bot-ping-harness';
import { defined } from './helpers';

const FILE = 'bot-ping-pr-closed.yml';
const UNMERGED = 'pull_request_target.closed.unmerged.bot-pr.json';
const MERGED = 'pull_request_target.closed.merged.bot-pr.json';
const HUMAN = 'pull_request_target.closed.unmerged.human-pr.json';
// Any number: the ping's own timestamp.
const ANY_TS: unknown = expect.any(Number);

describe(FILE, () => {
  const t = useStubs();
  const yml = readWorkflow(FILE);
  const step = stepNamed(FILE, 'ping', 'Ping owning bot on the unmerged close');
  const run = (e: string, opts: Partial<RunOpts> = {}) => t.runStep(FILE, step, { event: e, ...opts });

  for (const [title, check] of contractChecks({
    file: FILE,
    on: 'pull_request_target',
    types: '[closed]',
    timeout: 3,
  })) {
    it(title, check);
  }

  it('checks out nothing, runs nothing from the PR and holds only pull-requests: read', () => {
    for (const f of [UNMERGED, MERGED, HUMAN]) expectRealShaped(f);
    expect(event(MERGED).pull_request?.merged).toBe(true);
    expect(event(UNMERGED).pull_request?.merged).toBe(false);
    expect(yml).not.toMatch(/actions\/checkout/);
    expect(yml).not.toMatch(/^\s+(-\s+)?uses:/m);
    expect(step.run).not.toMatch(/scripts\/|\bgh\b|\bsource\b|\beval\b/);
    expect(block(yml, 'permissions')).toBe('permissions:\n  pull-requests: read\n');
    expect(jobText(yml, 'ping')).toContain('    if: github.event.pull_request.merged == false');
    expect(block(yml, 'concurrency')).toContain('  group: bot-ping-pr-closed-${{ github.event.pull_request.number }}');
    expect(jobSteps(FILE, 'ping')).toHaveLength(1);
  });

  it('a bot PR closed unmerged posts kind closed_unmerged with who closed it', () => {
    const r = run(UNMERGED);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('merged=false author=human-dev branch=claude/bot-gh-event-pings bot=1');
    expect(r.stdout).toContain('bot ping http=200');
    expect(t.pings()).toEqual([
      {
        kind: 'closed_unmerged',
        waiting: false,
        repo: R,
        pr: 512,
        pr_url: prUrl(512),
        closed_by: 'derek-hobden',
        author: 'human-dev',
        branch: 'claude/bot-gh-event-pings',
        ts: ANY_TS,
      },
    ]);
    expectNoSecretsPrinted(r);
  });

  it('a merged bot PR never pings', () => {
    const r = run(MERGED);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('merged, no ping');
    expect(t.curlCalls()).toEqual([]);
  });

  it("a human's PR closed unmerged never pings", () => {
    const r = run(HUMAN);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('human PR, no ping');
    expect(t.curlCalls()).toEqual([]);
  });

  it('skips with exit 0 when the secrets are not set, or the webhook is down', () => {
    let r = run(UNMERGED, { secrets: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('secrets not set, skipped');
    expect(t.curlCalls()).toEqual([]);
    r = run(UNMERGED, { env: { FAKE_CURL_EXIT: '7' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('bot ping http=000');
  });

  it('refuses a non-https webhook URL without calling curl', () => {
    const r = run(UNMERGED, { env: { BOT_WEBHOOK_URL: 'http://bot.example.test/' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('non-https URL, skipped');
    expect(r.stdout).not.toContain('bot.example.test');
    expect(t.curlCalls()).toEqual([]);
  });

  it('its inline filter decides exactly like is-bot-pr.sh', () => {
    const config = workflowEnv(yml);
    // Paper Golf's one bot login is the app's, golf-gus-bot[bot]: the bare login and a near miss are people.
    const cases = [
      ['golf-gus-bot', 'feature/x'],
      ['golf-gus-bot[bot]', 'feature/x'],
      ['human-dev', 'claude/x'],
      ['human-dev', 'stuart/claude/x'],
      ['human-dev', 'claude'],
      ['golf-gus-bot-2', 'fix'],
      ['', 'claude/x'],
      ['', ''],
    ] as const;
    let bots = 0;
    for (const [author, branch] of cases) {
      rmSync(join(t.dir(), 'curl.log'), { force: true });
      const e = event(HUMAN);
      const pr = defined(e.pull_request, 'pull_request');
      pr.user.login = author;
      pr.head.ref = branch;
      const file = join(t.dir(), 'closed.json');
      writeFileSync(file, JSON.stringify(e));
      const r = run(file);
      expect(r.status).toBe(0);
      const script = t.sh([IS_BOT_PR, author, branch], config).status === 0;
      if (script) bots++;
      expect(t.curlCalls().length === 1, `"${author}" "${branch}"`).toBe(script);
    }
    // Both sides of the filter are exercised: golf-gus-bot[bot], claude/x twice.
    expect(bots).toBe(3);
  });
});
