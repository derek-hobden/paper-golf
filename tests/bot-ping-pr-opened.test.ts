/**
 * bot-ping-pr-opened.yml: the GitHub-side backstop for the session hook's pr_opened ping. On RuckBee's
 * throwaway PR 477 a session opened a pull request and the hook never fired; now GitHub pings the owning
 * bot itself when a bot's PR is opened or marked ready for review. A human's PR never pings, and the
 * workflow never runs on `edited` (scripts/ci/check-pr-triggers.mjs).
 *
 * Both pings use the event name pr_opened; the bot tolerates getting both, so nothing dedupes them. It runs
 * on pull_request (the PR's merge commit, so the scripts/ci checkout matches this file); a fork's run has
 * no secrets and skips. Ported from the fleet template's RuckBee tests. Harness: tests/bot-ping-harness.ts.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  block,
  contractChecks,
  event,
  expectNoSecretsPrinted,
  expectRealShaped,
  jobSteps,
  jobText,
  prUrl,
  R,
  readWorkflow,
  stepNamed,
  useStubs,
  type RunOpts,
} from './bot-ping-harness';
import { at } from './helpers';
import { cleanEnv, REPO } from './hook-harness';

const FILE = 'bot-ping-pr-opened.yml';
const OPENED = 'pull_request.opened.bot-pr.json';
const DRAFT = 'pull_request.opened.draft.bot-author.json';
const READY = 'pull_request.ready_for_review.bot-author.json';
const HUMAN = 'pull_request.opened.human-pr.json';
// Any number: the ping's own timestamp.
const ANY_TS: unknown = expect.any(Number);

// The session hook caps stdin and its python with `timeout` (GNU coreutils).
const hookTools = ['timeout', 'python3'].every((cmd) => {
  try {
    execFileSync('bash', ['-c', `command -v ${cmd}`], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
});

describe(FILE, () => {
  const t = useStubs();
  const yml = readWorkflow(FILE);
  const step = stepNamed(FILE, 'ping', 'Ping owning bot on the new PR');
  const run = (e: string, opts: Partial<RunOpts> = {}) => t.runStep(FILE, step, { event: e, ...opts });

  for (const [title, check] of contractChecks({
    file: FILE,
    on: 'pull_request',
    types: '[opened, ready_for_review]',
    timeout: 3,
  })) {
    it(title, check);
  }

  it('uses the shared bot filter and ping script, from a scripts/ci checkout', () => {
    for (const f of [OPENED, DRAFT, READY, HUMAN]) expectRealShaped(f);
    expect(event(OPENED).action).toBe('opened');
    expect(event(READY).action).toBe('ready_for_review');
    expect(step.run).toContain('bash scripts/ci/is-bot-pr.sh "$author" "$branch" && bot=1');
    expect(step.run).toMatch(/^bash scripts\/ci\/bot-event-ping\.sh "\$payload"$/m);
    expect(step.run).not.toMatch(/\bcurl\b|for \w+ in \$BOT_(AUTHORS|BRANCH_PREFIXES)/);
    expect(block(yml, 'permissions')).toBe('permissions:\n  contents: read\n');
    expect(block(yml, 'concurrency')).toContain('  group: bot-ping-pr-opened-${{ github.event.pull_request.number }}');
    expect(jobText(yml, 'ping')).not.toMatch(/^ {4}if:/m);
    const steps = jobSteps(FILE, 'ping');
    expect(steps.map((s) => s.uses ?? s.name)).toEqual(['actions/checkout@v7', 'Ping owning bot on the new PR']);
  });

  it('a bot PR opened posts kind pr_opened, with event pr_opened like the hook', () => {
    const r = run(OPENED);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('action=opened author=human-dev branch=claude/bot-gh-event-pings bot=1');
    expect(t.pings()).toEqual([
      {
        kind: 'pr_opened',
        event: 'pr_opened',
        action: 'opened',
        waiting: false,
        repo: R,
        pr: 512,
        pr_url: prUrl(512),
        title: 'ci: ping the owning bot on GitHub events',
        draft: false,
        author: 'human-dev',
        branch: 'claude/bot-gh-event-pings',
        base: 'main',
        sha: '200ab'.padEnd(40, '7'),
        sender: 'human-dev',
        ts: ANY_TS,
      },
    ]);
    expectNoSecretsPrinted(r);
  });

  it('a bot login opening a draft pings with draft true; marking it ready pings again', () => {
    let r = run(DRAFT);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('action=opened author=golf-gus-bot[bot] branch=rob/standings-fix bot=1');
    r = run(READY);
    expect(r.status).toBe(0);
    const sent = t.pings();
    expect(sent).toHaveLength(2);
    expect(at(sent, 0)).toMatchObject({
      kind: 'pr_opened',
      event: 'pr_opened',
      action: 'opened',
      pr: 513,
      draft: true,
      author: 'golf-gus-bot[bot]',
    });
    expect(at(sent, 1)).toMatchObject({
      kind: 'pr_opened',
      event: 'pr_opened',
      action: 'ready_for_review',
      pr: 513,
      pr_url: prUrl(513),
      draft: false,
      author: 'golf-gus-bot[bot]',
      branch: 'rob/standings-fix',
    });
  });

  it("a human's PR never pings", () => {
    const r = run(HUMAN);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=human-dev branch=feature/standings-filter bot=0');
    expect(r.stdout).toContain('human PR, no ping');
    expect(t.curlCalls()).toEqual([]);
  });

  it('skips with exit 0 when the secrets are not set (a fork), or the webhook is down', () => {
    let r = run(OPENED, { secrets: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('secrets not set, skipped');
    expect(t.curlCalls()).toEqual([]);
    r = run(OPENED, { env: { FAKE_CURL_EXIT: '7' } });
    expect(r.status).toBe(0);
    expect(t.curlCalls()).toHaveLength(1);
  });

  it.skipIf(!hookTools)('names the event pr_opened exactly as the session hook does', () => {
    run(OPENED);
    const github = at(t.pings(), 0);
    // The hook, after a `gh pr create` in a session (stand-in curl records the body).
    const dir = mkdtempSync(join(tmpdir(), 'bot-ping-both-'));
    try {
      writeFileSync(
        join(dir, 'curl'),
        '#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do case "$1" in --data) printf \'%s\' "$2" > "$OUT"; shift 2;; *) shift;; esac; done\nprintf 200\n',
        { mode: 0o755 },
      );
      // No webhook, ping key or cloud-session flag from the caller's environment.
      const env = Object.fromEntries(
        Object.entries(cleanEnv()).filter(([key]) => !/^(BOT_|FACTORY_PING_|CLAUDE_CODE_REMOTE)/.test(key)),
      );
      execFileSync('bash', [`${REPO}scripts/claude-hooks/bot-ping.sh`, 'PostToolUse'], {
        cwd: REPO,
        encoding: 'utf8',
        input: JSON.stringify({
          hook_event_name: 'PostToolUse',
          tool_name: 'Bash',
          tool_input: { command: 'gh pr create --fill' },
          tool_response: { stdout: `${prUrl(512)}\n`, stderr: '' },
        }),
        env: {
          ...env,
          PATH: `${dir}:${env.PATH ?? ''}`,
          BOT_WEBHOOK_URL: 'https://bot.invalid/hook',
          BOT_WEBHOOK_KEY: 'stub-key',
          BOT_PING_LOG: join(dir, 'ping.log'),
          OUT: join(dir, 'hook.json'),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const hook = JSON.parse(readFileSync(join(dir, 'hook.json'), 'utf8')) as Record<string, unknown>;
      expect(hook.event).toBe('pr_opened');
      expect(github.event).toBe(hook.event);
      expect(github.kind).toBe(hook.event);
      expect(github.pr_url).toBe(hook.pr_url);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
