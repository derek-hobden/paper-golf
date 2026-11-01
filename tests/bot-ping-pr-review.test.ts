/**
 * bot-ping-pr-review.yml: an approving or blocking review on a bot's pull request pings the owning bot
 * (kind review). A commented review, a dismissal and any review on a human's PR do not. Ported from the
 * fleet template's RuckBee tests. Harness: tests/bot-ping-harness.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  block,
  contractChecks,
  event,
  expectNoSecretsPrinted,
  expectRealShaped,
  jobText,
  prUrl,
  R,
  readWorkflow,
  stepNamed,
  useStubs,
  type RunOpts,
} from './bot-ping-harness';

const FILE = 'bot-ping-pr-review.yml';
const APPROVED = 'pull_request_review.approved.claude-branch.json';
const CHANGES = 'pull_request_review.changes_requested.bot-author.json';
const COMMENTED = 'pull_request_review.commented.claude-branch.json';
const HUMAN = 'pull_request_review.approved.human-pr.json';
// Any number: the ping's own timestamp.
const ANY_TS: unknown = expect.any(Number);

describe(FILE, () => {
  const t = useStubs();
  const yml = readWorkflow(FILE);
  const step = stepNamed(FILE, 'ping', 'Ping owning bot on the review');
  const run = (e: string, opts: Partial<RunOpts> = {}) => t.runStep(FILE, step, { event: e, ...opts });

  for (const [title, check] of contractChecks({
    file: FILE,
    on: 'pull_request_review',
    types: '[submitted]',
    timeout: 3,
  })) {
    it(title, check);
  }

  it('starts a runner only for approved and changes_requested reviews', () => {
    for (const f of [APPROVED, CHANGES, COMMENTED, HUMAN]) expectRealShaped(f);
    expect(event(COMMENTED).review?.state).toBe('commented');
    expect(jobText(yml, 'ping')).toContain(
      `    if: contains(fromJSON('["approved","changes_requested"]'), github.event.review.state)`,
    );
    expect(block(yml, 'permissions')).toBe('permissions:\n  contents: read\n');
    expect(block(yml, 'concurrency')).toContain('  group: bot-ping-pr-review-${{ github.event.review.id }}');
  });

  it('an approval on a claude/ branch posts kind review', () => {
    const r = run(APPROVED);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('state=approved author=human-dev branch=claude/bot-gh-event-pings bot=1');
    expect(r.stdout).toContain('bot ping http=200');
    expect(t.pings()).toEqual([
      {
        kind: 'review',
        waiting: false,
        repo: R,
        pr: 512,
        pr_url: prUrl(512),
        state: 'approved',
        reviewer: 'derek-hobden',
        review_url: `${prUrl(512)}#pullrequestreview-2400000001`,
        author: 'human-dev',
        branch: 'claude/bot-gh-event-pings',
        ts: ANY_TS,
      },
    ]);
    expect(t.ghCalls()).toEqual([]);
    expectNoSecretsPrinted(r);
  });

  it("changes requested on the bot author's PR posts, on any branch", () => {
    const r = run(CHANGES);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=golf-gus-bot[bot] branch=rob/standings-fix bot=1');
    expect(t.pings()).toEqual([
      {
        kind: 'review',
        waiting: false,
        repo: R,
        pr: 513,
        pr_url: prUrl(513),
        state: 'changes_requested',
        reviewer: 'human-reviewer',
        review_url: `${prUrl(513)}#pullrequestreview-2400000002`,
        author: 'golf-gus-bot[bot]',
        branch: 'rob/standings-fix',
        ts: ANY_TS,
      },
    ]);
  });

  it('a commented review never pings, even on a bot PR', () => {
    const r = run(COMMENTED);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('review state commented, no ping');
    expect(t.curlCalls()).toEqual([]);
  });

  it("an approval on a human's PR never pings", () => {
    const r = run(HUMAN);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=human-dev branch=feature/standings-filter bot=0');
    expect(r.stdout).toContain('human PR, no ping');
    expect(t.curlCalls()).toEqual([]);
  });

  it('skips with exit 0 when the secrets are not set, or the webhook is down', () => {
    let r = run(APPROVED, { secrets: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('secrets not set, skipped');
    expect(t.curlCalls()).toEqual([]);
    r = run(APPROVED, { env: { FAKE_CURL_EXIT: '7' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('bot ping http=000');
  });
});
