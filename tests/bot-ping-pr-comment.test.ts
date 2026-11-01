/**
 * bot-ping-pr-comment.yml: a person's comment on a bot's pull request pings the owning bot (kind comment,
 * with a one-line snippet of at most 280 characters; priority high for the commenters in
 * BOT_PRIORITY_COMMENTERS). A comment on a plain issue, by a Bot account, a [bot] login or a BOT_AUTHORS
 * login, or on a human's PR never pings. issue_comment carries no head branch, so the workflow reads it
 * (and the author) from the pull request with the job's token. Ported from the fleet template's RuckBee
 * tests. Harness: tests/bot-ping-harness.ts.
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
  workflowEnv,
  type RunOpts,
} from './bot-ping-harness';
import { at, defined } from './helpers';

const FILE = 'bot-ping-pr-comment.yml';
const DEREK = 'issue_comment.created.bot-pr.derek.json';
const HUMAN = 'issue_comment.created.bot-pr.human.json';
const APP_BOT = 'issue_comment.created.bot-pr.app-bot.json';
const BOT_AUTHOR = 'issue_comment.created.bot-pr.bot-author.json';
const PLAIN = 'issue_comment.created.plain-issue.json';
const HUMAN_PR = 'issue_comment.created.human-pr.json';
// Any number: the ping's own timestamp.
const ANY_TS: unknown = expect.any(Number);
const ANY_GH_CALL: unknown = expect.objectContaining({ method: 'GET', path: `repos/${R}/pulls/512`, token: 'test-gh-token' });

describe(FILE, () => {
  const t = useStubs();
  const yml = readWorkflow(FILE);
  const step = stepNamed(FILE, 'ping', 'Ping owning bot on the comment');
  const run = (e: string, opts: Partial<RunOpts> = {}) =>
    t.runStep(FILE, step, { event: e, routes: 'pulls.routes.json', ...opts });

  for (const [title, check] of contractChecks({
    file: FILE,
    on: 'issue_comment',
    types: '[created]',
    timeout: 3,
  })) {
    it(title, check);
  }

  it("starts a runner only for a pull request's comments by a non-Bot account", () => {
    for (const f of [DEREK, HUMAN, APP_BOT, BOT_AUTHOR, PLAIN, HUMAN_PR]) expectRealShaped(f);
    expect(event(PLAIN).issue?.pull_request).toBeUndefined();
    expect(event(APP_BOT).comment?.user.type).toBe('Bot');
    expect(jobText(yml, 'ping')).toContain(
      "    if: github.event.issue.pull_request && github.event.comment.user.type != 'Bot'",
    );
    expect(block(yml, 'permissions')).toBe('permissions:\n  contents: read\n  pull-requests: read\n');
    expect(block(yml, 'concurrency')).toContain('  group: bot-ping-pr-comment-${{ github.event.comment.id }}');
    expect(workflowEnv(yml).BOT_PRIORITY_COMMENTERS).toBe('derek-hobden');
    expect(yml).toMatch(/^ {2}BOT_PRIORITY_COMMENTERS: "[^"]*" +# EDIT/m);
    expect(step.env.GH_TOKEN).toBe('${{ github.token }}');
  });

  it("Derek's comment on a bot PR posts kind comment, priority high, one-line snippet", () => {
    const r = run(DEREK);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=human-dev branch=claude/bot-gh-event-pings bot=1');
    const snippet = defined(event(DEREK).comment, 'comment').body.replace(/\s+/g, ' ').trim().slice(0, 280);
    expect(snippet).toHaveLength(280);
    const sent = t.pings();
    expect(sent).toEqual([
      {
        kind: 'comment',
        waiting: false,
        repo: R,
        pr: 512,
        pr_url: prUrl(512),
        commenter: 'derek-hobden',
        comment_url: `${prUrl(512)}#issuecomment-3300000001`,
        snippet,
        priority: 'high',
        author: 'human-dev',
        branch: 'claude/bot-gh-event-pings',
        ts: ANY_TS,
      },
    ]);
    expect(String(at(sent, 0).snippet)).not.toMatch(/[\r\n\t]/);
    // The head branch and author came from the pull request, with the job's token.
    expect(t.ghCalls()).toEqual([ANY_GH_CALL]);
    expectNoSecretsPrinted(r);
  });

  it("anyone else's comment on the bot author's PR posts with priority normal", () => {
    const r = run(HUMAN);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=golf-gus-bot[bot] branch=rob/standings-fix bot=1');
    expect(t.pings()).toEqual([
      {
        kind: 'comment',
        waiting: false,
        repo: R,
        pr: 513,
        pr_url: prUrl(513),
        commenter: 'human-reviewer',
        comment_url: `${prUrl(513)}#issuecomment-3300000002`,
        snippet: 'Can you add a test for the draw case?',
        priority: 'normal',
        author: 'golf-gus-bot[bot]',
        branch: 'rob/standings-fix',
        ts: ANY_TS,
      },
    ]);
  });

  it('a comment on a plain issue never pings and asks GitHub nothing', () => {
    const r = run(PLAIN);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('comment on an issue, no ping');
    expect(t.curlCalls()).toEqual([]);
    expect(t.ghCalls()).toEqual([]);
  });

  for (const [fixture, login] of [
    [APP_BOT, 'github-actions[bot]'],
    [BOT_AUTHOR, 'golf-gus-bot[bot]'],
  ] as const) {
    it(`a comment by ${login} never pings and asks GitHub nothing`, () => {
      const r = run(fixture);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain(`commenter ${login} is a bot, no ping`);
      expect(t.curlCalls()).toEqual([]);
      expect(t.ghCalls()).toEqual([]);
    });
  }

  it('a comment by a BOT_AUTHORS login with no [bot] suffix never pings either', () => {
    const r = run(DEREK, { env: { BOT_AUTHORS: 'golf-gus-bot[bot] derek-hobden' } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('commenter derek-hobden is a bot, no ping');
    expect(t.curlCalls()).toEqual([]);
    expect(t.ghCalls()).toEqual([]);
  });

  it("a comment on a human's PR never pings", () => {
    const r = run(HUMAN_PR);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=human-dev branch=feature/standings-filter bot=0');
    expect(r.stdout).toContain('human PR, no ping');
    expect(t.curlCalls()).toEqual([]);
  });

  it('a failed pull request lookup is not a bot PR: no ping, exit 0', () => {
    const r = run(DEREK, { routes: 'missing.json' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=unknown branch= bot=0');
    expect(t.curlCalls()).toEqual([]);
  });

  it('skips with exit 0 when the secrets are not set', () => {
    const r = run(DEREK, { secrets: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('secrets not set, skipped');
    expect(t.curlCalls()).toEqual([]);
  });
});
