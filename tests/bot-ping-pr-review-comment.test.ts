/**
 * bot-ping-pr-review-comment.yml: a review's inline comments on a bot's pull request ping the owning bot
 * once per review, not once per comment (kind review_comment, with every comment's path and line).
 *
 * GitHub sends one pull_request_review_comment event per comment. The `pick` job of each lists the
 * review's comments (gh api pulls/N/reviews/ID/comments) and only the run for the lowest comment id outputs
 * a payload; the `ping` job then posts it, in a concurrency group keyed on the review id. pick has no
 * per-review group on purpose: a group keeps one pending run and cancels the rest, which could drop the
 * lowest id's run and leave the review unpinged. Ported from the fleet template's RuckBee tests. Harness:
 * tests/bot-ping-harness.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  block,
  contractChecks,
  expectNoSecretsPrinted,
  expectRealShaped,
  jobText,
  prUrl,
  R,
  readWorkflow,
  stepNamed,
  useStubs,
  type Ran,
  type RunOpts,
} from './bot-ping-harness';
import { defined } from './helpers';

const FILE = 'bot-ping-pr-review-comment.yml';
const FIRST = 'pull_request_review_comment.created.first.json';
const SECOND = 'pull_request_review_comment.created.second.json';
const HUMAN_PR = 'pull_request_review_comment.created.human-pr.json';
const BOT_REVIEWER = 'pull_request_review_comment.created.bot-reviewer.json';
// Any number: the ping's own timestamp.
const ANY_TS: unknown = expect.any(Number);
const LISTED_COMMENTS: unknown = expect.objectContaining({
  method: 'GET',
  path: `repos/${R}/pulls/512/reviews/2400000011/comments?per_page=100`,
  paginate: true,
  token: 'test-gh-token',
});

describe(FILE, () => {
  const t = useStubs();
  const yml = readWorkflow(FILE);
  const pick = stepNamed(FILE, 'pick', "Pick the review's first comment");
  const send = stepNamed(FILE, 'ping', 'Ping owning bot on the review comments');

  /** Both jobs, as GitHub chains them: ping runs only when pick output a payload. */
  function run(e: string, opts: Partial<RunOpts> = {}): { first: Ran; second: Ran | null } {
    const first = t.runStep(FILE, pick, { event: e, routes: 'review-comments.routes.json', ...opts });
    expect(first.stderr).toBe('');
    expect(first.status).toBe(0);
    const payload = first.outputs.payload ?? '';
    if (payload === '') return { first, second: null };
    const second = t.runStep(FILE, send, { event: e, ...opts, env: { ...opts.env, PAYLOAD: payload } });
    return { first, second };
  }

  for (const [title, check] of contractChecks({
    file: FILE,
    on: 'pull_request_review_comment',
    types: '[created]',
    timeout: 3,
  })) {
    it(title, check);
  }

  it('dedupes per review: pick has no review group, ping is grouped on the review id', () => {
    for (const f of [FIRST, SECOND, HUMAN_PR, BOT_REVIEWER]) expectRealShaped(f);
    expect(block(yml, 'concurrency')).toContain('  group: bot-ping-pr-review-comment-${{ github.event.comment.id }}');
    const pickJob = jobText(yml, 'pick');
    expect(pickJob).not.toMatch(/concurrency:/);
    expect(pickJob).toContain("    if: github.event.comment.user.type != 'Bot'");
    expect(pickJob).toMatch(/^ {6}payload: \$\{\{ steps\.pick\.outputs\.payload \}\}$/m);
    const ping = jobText(yml, 'ping');
    expect(ping).toContain('    needs: pick');
    expect(ping).toContain("    if: needs.pick.outputs.payload != ''");
    expect(ping).toMatch(
      /^ {4}concurrency:\n {6}group: bot-ping-pr-review-comment-review-\$\{\{ github\.event\.comment\.pull_request_review_id \}\}\n {6}cancel-in-progress: false$/m,
    );
    expect(pick.id).toBe('pick');
    expect(pick.env.GH_TOKEN).toBe('${{ github.token }}');
    expect(pick.env.BOT_WEBHOOK_URL).toBeUndefined();
    expect(send.env.PAYLOAD).toBe('${{ needs.pick.outputs.payload }}');
    expect(block(yml, 'permissions')).toBe('permissions:\n  contents: read\n  pull-requests: read\n');
  });

  it("the review's lowest comment id posts one kind review_comment with every path and line", () => {
    const { first, second } = run(FIRST);
    expect(first.stdout).toContain('author=human-dev branch=claude/bot-gh-event-pings bot=1');
    expect(first.stdout).toContain('comment 1900000101 is the first of review 2400000011');
    const sent = defined(second, 'the ping job');
    expect(sent.stderr).toBe('');
    expect(sent.status).toBe(0);
    expect(sent.stdout).toContain('bot ping http=200');
    expect(t.pings()).toEqual([
      {
        kind: 'review_comment',
        waiting: false,
        repo: R,
        pr: 512,
        pr_url: prUrl(512),
        reviewer: 'derek-hobden',
        review_id: 2400000011,
        comment_count: 3,
        comments: [
          { path: '.github/workflows/bot-ping-pr-review.yml', line: 12 },
          { path: 'scripts/ci/is-bot-pr.sh', line: 7 },
          // An outdated comment has no line; its original_line stands in.
          { path: 'scripts/ci/is-bot-pr.sh', line: 9 },
        ],
        author: 'human-dev',
        branch: 'claude/bot-gh-event-pings',
        ts: ANY_TS,
      },
    ]);
    expect(t.ghCalls()).toEqual([LISTED_COMMENTS]);
    expectNoSecretsPrinted(first);
    expectNoSecretsPrinted(sent);
  });

  it("the review's other comments never ping", () => {
    const { first, second } = run(SECOND);
    expect(first.stdout).toContain(
      'comment 1900000102 is not the first of review 2400000011 (1900000101 pings), no ping',
    );
    expect(second).toBeNull();
    expect(t.curlCalls()).toEqual([]);
  });

  it("a human's PR never pings and asks GitHub nothing", () => {
    const { first, second } = run(HUMAN_PR);
    expect(first.stdout).toContain('author=human-dev branch=feature/standings-filter bot=0');
    expect(first.stdout).toContain('human PR, no ping');
    expect(second).toBeNull();
    expect(t.ghCalls()).toEqual([]);
  });

  it("the bot's own review comments never ping", () => {
    const { first, second } = run(BOT_REVIEWER);
    expect(first.stdout).toContain('reviewer golf-gus-bot[bot] is a bot, no ping');
    expect(second).toBeNull();
    expect(t.ghCalls()).toEqual([]);
  });

  it('a failed comment lookup pings nobody, exit 0', () => {
    const { first, second } = run(FIRST, { routes: 'missing.json' });
    expect(first.stdout).toContain('review comments lookup failed, no ping');
    expect(second).toBeNull();
  });

  it('skips with exit 0 when the secrets are not set', () => {
    const { second } = run(FIRST, { secrets: false });
    expect(second?.status).toBe(0);
    expect(second?.stdout).toContain('secrets not set, skipped');
    expect(t.curlCalls()).toEqual([]);
  });
});
