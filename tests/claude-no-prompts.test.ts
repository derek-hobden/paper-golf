/**
 * Claude Code sessions in this repo run without permission prompts (Derek, 1 Nov 2026; the fleet template,
 * from RuckBee PRs 473 to 478): .claude/settings.json sets bypassPermissions and has no `ask` list, so the
 * deny list is the only thing between an agent and a push to main, a merge, a production promote by hand
 * or a live database. Every wait, idle, stop or failure pings the owning bot through
 * scripts/claude-hooks/bot-ping.sh instead of sitting on a prompt nobody sees, and in a cloud session
 * (which cannot run bypassPermissions) the same hook answers what still prompts with "allow"; deny rules
 * are checked first. It also pings on session start and resume, an MCP elicitation, an auto mode denial,
 * and after a `git push` (`pushed`) or a pull request opened any way (`pr_opened`). Which tool calls are a
 * push or a new PR is the script's call (tests/bot-ping-hook-pr-opened.test.ts).
 *
 * This pins all of that, and replays the deny rules with Claude Code's own Bash rule semantics, so a rule
 * that is too loose (the old `git push *main*` also caught `fix-domain`) or one that can never match fails
 * here. Releases and live-data scripts are open (Derek, 1 Nov 20:50 Dubai); nuke-live and direct prod
 * database commands stay denied (20:55); merges stay with Derek or the owning bot.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { at } from './helpers';
import { cleanEnv, git, REPO } from './hook-harness';

/** Outside .claude/, which a cloud session cannot edit without a prompt. */
const BOT_PING = `${REPO}scripts/claude-hooks/bot-ping.sh`;
const PRE_PUSH_SCAN = `${REPO}scripts/claude-hooks/pre-push-scan.sh`;
const BLOCK_PUSH = `${REPO}.claude/hooks/block-push-from-main.sh`;
const BLOCK_EDITS = `${REPO}.claude/hooks/block-main-edits.sh`;

interface HookEntry {
  matcher?: string;
  hooks?: { type: string; command: string; timeout?: number; if?: string }[];
}

interface Settings {
  remote?: { defaultEnvironmentId?: string };
  permissions?: { defaultMode?: string; allow?: string[]; deny?: string[]; ask?: string[] };
  hooks?: Record<string, HookEntry[] | undefined>;
}

const settingsText = readFileSync(`${REPO}.claude/settings.json`, 'utf8');
const settings = JSON.parse(settingsText) as Settings;

const permissions = settings.permissions ?? {};
const allow = permissions.allow ?? [];
const deny = permissions.deny ?? [];
const bashDeny = deny.flatMap((rule) => /^Bash\(([\s\S]*)\)$/.exec(rule)?.[1] ?? []);

/**
 * Claude Code's Bash rule matching (CLI 2.1.x): a rule ending in `:*` is the legacy prefix form and is
 * compared literally, so a `*` before that suffix is never expanded; any other rule with a `*` is a
 * wildcard where `*` matches any characters and the whole command must match (a single trailing ` *`
 * also matches the bare command); the rest are exact.
 */
function bashRuleMatches(rule: string, command: string): boolean {
  const legacyPrefix = /^([\s\S]+):\*$/.exec(rule)?.[1];
  if (legacyPrefix !== undefined) {
    return command === legacyPrefix || command.startsWith(`${legacyPrefix} `);
  }
  if (!rule.includes('*')) return command === rule;
  let source = rule
    .trim()
    .replace(/[.+?^${}()|[\]\\'"]/g, '\\$&')
    .replaceAll('*', '.*');
  if (source.endsWith(' .*') && rule.split('*').length === 2) {
    source = `${source.slice(0, -3)}( .*)?`;
  }
  return new RegExp(`^${source}$`, 's').test(command);
}

const deniedBy = (command: string): string[] => bashDeny.filter((rule) => bashRuleMatches(rule, command));

const BOT_PING_EVENTS = [
  'PermissionRequest',
  'Notification',
  'Stop',
  'StopFailure',
  'SessionEnd',
  'SessionStart',
  'PermissionDenied',
  'Elicitation',
  'PostToolUse',
];
const NOTIFICATION_TYPES = [
  'permission_prompt',
  'idle_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'agent_needs_input',
  'quota_auto_resume_fired',
  'quota_auto_resume_stale',
  'quota_auto_resume_disabled',
];

/** Every hook command, in every event. */
const allCommands = (): string[] =>
  Object.values(settings.hooks ?? {}).flatMap((entries) =>
    (entries ?? []).flatMap((e) => (e.hooks ?? []).map((h) => h.command)),
  );

/** The hook entries for `event` that run `command`. */
function entriesRunning(event: string, command: string): HookEntry[] {
  return (settings.hooks?.[event] ?? []).filter((e) =>
    (e.hooks ?? []).some((h) => h.type === 'command' && h.command === command),
  );
}

/** The hook entries for `event` that run bot-ping.sh with that event's name. */
const botPingEntries = (event: string): HookEntry[] =>
  entriesRunning(event, `bash "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/bot-ping.sh" ${event}`);

// The hook caps stdin and its python with `timeout` (GNU coreutils, not stock macOS); without it the hook
// sends nothing and answers a bare "allow".
const hasTools = (...cmds: string[]): boolean =>
  cmds.every((cmd) => spawnSync('bash', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).status === 0);

/** The caller's environment without the webhook, the cloud-session flag or a proxy. */
function quietEnv(): Record<string, string | undefined> {
  const env = cleanEnv();
  for (const key of Object.keys(env)) {
    if (/^(BOT_|FACTORY_PING_|CLAUDE_CODE_REMOTE)|^(https?|all)_proxy$/i.test(key)) {
      env[key] = undefined;
    }
  }
  return env;
}

describe('.claude/settings.json never stops on a permission prompt', () => {
  it('has no ask list', () => {
    expect(Object.hasOwn(permissions, 'ask')).toBe(false);
  });

  it('defaults to bypassPermissions', () => {
    expect(permissions.defaultMode).toBe('bypassPermissions');
  });

  it('denies AskUserQuestion', () => {
    expect(deny).toContain('AskUserQuestion');
  });

  it('has no Bash rule whose * the legacy :* suffix turns literal', () => {
    const dead = [...allow, ...deny].filter((r) => /^Bash\([\s\S]*\*[\s\S]*:\*\)$/.test(r));
    expect(dead).toEqual([]);
  });

  // Claude Code rejects a settings file with an unknown "$comment" key, and a rejected file loads no deny
  // rules at all.
  it('has no "$comment" key at any depth', () => {
    expect(settingsText).not.toContain('"$comment"');
  });

  it("keeps Paper Golf's cloud environment", () => {
    expect(settings.remote?.defaultEnvironmentId).toBe('env_018rXWwWKQcidkjjtsCxfQaa');
  });
});

describe('bot-ping.sh is wired and sound', () => {
  it.each(BOT_PING_EVENTS)('%s runs bot-ping.sh, with a 10 s timeout', (event) => {
    const entries = botPingEntries(event);
    expect(entries.length).toBeGreaterThan(0);
    for (const h of entries.flatMap((e) => e.hooks ?? [])) expect(h.timeout).toBe(10);
  });

  it('Notification pings on every kind of wait and every quota auto-resume', () => {
    const matchers = botPingEntries('Notification').flatMap((e) => (e.matcher ?? '').split('|'));
    expect(matchers).toEqual(NOTIFICATION_TYPES);
  });

  it('SessionStart pings on a new session and a resume only', () => {
    expect(botPingEntries('SessionStart').map((e) => e.matcher)).toEqual(['startup|resume']);
  });

  it('PermissionRequest and PermissionDenied on every tool; Elicitation on every server', () => {
    expect(botPingEntries('PermissionRequest').map((e) => e.matcher)).toEqual(['*']);
    expect(botPingEntries('PermissionDenied').map((e) => e.matcher)).toEqual(['*']);
    expect(botPingEntries('Elicitation').map((e) => e.matcher)).toEqual([undefined]);
  });

  it('PostToolUse is one entry for Bash and an MCP create_pull_request, with no if filter', () => {
    const entries = botPingEntries('PostToolUse');
    expect(entries.map((e) => e.matcher)).toEqual(['^(Bash|mcp__.+__create_pull_request)$']);
    expect(entries.flatMap((e) => e.hooks ?? []).filter((h) => h.if !== undefined)).toEqual([]);
  });

  it('replaced the old scripts/factory/session-ping.sh hooks', () => {
    expect(allCommands().filter((c) => c.includes('session-ping'))).toEqual([]);
  });

  it('exists and parses (bash -n)', () => {
    expect(existsSync(BOT_PING)).toBe(true);
    expect(spawnSync('bash', ['-n', BOT_PING], { encoding: 'utf8' }).status).toBe(0);
  });
});

describe('the PreToolUse guards are wired', () => {
  const bash = (path: string): string => `bash "$CLAUDE_PROJECT_DIR/${path}"`;

  it.each([
    ['Bash', '.claude/hooks/block-push-from-main.sh'],
    ['Bash', 'scripts/claude-hooks/pre-push-scan.sh'],
    ['Edit|Write|NotebookEdit', '.claude/hooks/block-main-edits.sh'],
  ])('%s runs %s', (matcher, path) => {
    expect(entriesRunning('PreToolUse', bash(path)).map((e) => e.matcher)).toEqual([matcher]);
    expect(existsSync(`${REPO}${path}`)).toBe(true);
    expect(spawnSync('bash', ['-n', `${REPO}${path}`], { encoding: 'utf8' }).status).toBe(0);
  });
});

describe('bot-ping.sh never blocks and never leaks', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-ping-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  let runs = 0;

  /** Runs the hook with only the variables given here: no webhook, proxy or cloud-session flag. */
  function ping(
    event: string,
    vars: Record<string, string>,
    input = JSON.stringify({ hook_event_name: event, session_id: 'test-session' }),
  ): { stdout: string; log: string } {
    runs += 1;
    const log = join(dir, `${event}-${String(runs)}.log`);
    const stdout = execFileSync('bash', [BOT_PING, event], {
      cwd: REPO,
      encoding: 'utf8',
      input,
      env: { ...quietEnv(), BOT_PING_LOG: log, NO_PROXY: '*', ...vars },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, log: existsSync(log) ? readFileSync(log, 'utf8') : '' };
  }

  it('exits 0 silently and sends nothing without a webhook', () => {
    expect(ping('Stop', {})).toEqual({ stdout: '', log: '' });
  });

  it('sends nothing to a plain-http webhook', () => {
    const vars = { BOT_WEBHOOK_URL: 'http://127.0.0.1:9/hook', BOT_WEBHOOK_KEY: 'k' };
    expect(ping('StopFailure', vars)).toEqual({ stdout: '', log: '' });
  });

  it.skipIf(!hasTools('timeout', 'python3', 'curl'))('logs only the event and HTTP status, never the URL or key', () => {
    const vars = {
      BOT_WEBHOOK_URL: 'https://127.0.0.1:9/hook-path-secret',
      BOT_WEBHOOK_KEY: 'key-that-must-not-leak',
    };
    const { stdout, log } = ping('SessionEnd', vars);
    expect(stdout).toBe('');
    // Nothing listens there: curl's own 000, once (PR 109 review round 2: the fallback made it 000000).
    expect(log).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ SessionEnd http=000\n$/);
    expect(log).not.toContain('hook-path-secret');
    expect(log).not.toContain('key-that-must-not-leak');
  });
});

describe('bot-ping.sh answers PermissionRequest only when auto-approve is on', () => {
  interface Decision {
    behavior: string;
    updatedPermissions?: unknown[];
  }

  /** The hook's PermissionRequest decision, or null when it printed nothing. */
  function decision(vars: Record<string, string>, input = '{}', event = 'PermissionRequest'): Decision | null {
    const stdout = execFileSync('bash', [BOT_PING, event], {
      cwd: REPO,
      encoding: 'utf8',
      input,
      env: { ...quietEnv(), BOT_PING_LOG: '/dev/null', ...vars },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (stdout === '') return null;
    const out = JSON.parse(stdout) as { hookSpecificOutput: { hookEventName: string; decision: Decision } };
    expect(out.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    return out.hookSpecificOutput.decision;
  }

  it('BOT_AUTO_APPROVE=1 answers allow', () => {
    expect(decision({ BOT_AUTO_APPROVE: '1' })?.behavior).toBe('allow');
  });

  it('BOT_AUTO_APPROVE=0 prints nothing, even in a cloud session', () => {
    expect(decision({ BOT_AUTO_APPROVE: '0' })).toBeNull();
    expect(decision({ BOT_AUTO_APPROVE: '0', CLAUDE_CODE_REMOTE: 'true' })).toBeNull();
  });

  it('is on by default in a cloud session and off elsewhere', () => {
    expect(decision({ CLAUDE_CODE_REMOTE: 'true' })?.behavior).toBe('allow');
    expect(decision({})).toBeNull();
  });

  it('never answers another event', () => {
    expect(decision({ BOT_AUTO_APPROVE: '1' }, '{}', 'Notification')).toBeNull();
  });

  it.skipIf(!hasTools('timeout', 'python3'))("echoes only the prompt's session-scoped suggestions", () => {
    const session = { type: 'addDirectories', directories: ['/x'], destination: 'session' };
    const saved = { type: 'addRules', rules: [], behavior: 'allow', destination: 'localSettings' };
    const input = JSON.stringify({ permission_suggestions: [session, saved] });
    expect(decision({ BOT_AUTO_APPROVE: '1' }, input)).toEqual({ behavior: 'allow', updatedPermissions: [session] });
  });
});

describe.skipIf(!hasTools('timeout', 'python3'))('bot-ping.sh tells the bot when it must act', () => {
  // A stand-in curl, first on PATH: records the --data payload, answers 200.
  const dir = mkdtempSync(join(tmpdir(), 'bot-ping-curl-'));
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  writeFileSync(
    join(dir, 'curl'),
    '#!/usr/bin/env bash\n' +
      'while [ $# -gt 0 ]; do\n' +
      '  case "$1" in --data) printf \'%s\\n\' "$2" >> "$CURL_STUB_OUT"; shift 2 ;; *) shift ;; esac\n' +
      'done\n' +
      'printf 200\n',
    { mode: 0o755 },
  );
  let runs = 0;

  /** The JSON bot-ping.sh posts for `event` with `input` on stdin. */
  function posted(event: string, input: object, vars: Record<string, string> = {}): Record<string, unknown> {
    const env = quietEnv();
    runs += 1;
    const out = join(dir, `posted-${String(runs)}.jsonl`);
    execFileSync('bash', [BOT_PING, event], {
      cwd: REPO,
      encoding: 'utf8',
      input: JSON.stringify(input),
      env: {
        ...env,
        PATH: `${dir}:${env.PATH ?? ''}`,
        BOT_WEBHOOK_URL: 'https://bot.invalid/hook',
        BOT_WEBHOOK_KEY: 'stub-key',
        BOT_PING_LOG: join(dir, 'ping.log'),
        CURL_STUB_OUT: out,
        ...vars,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = readFileSync(out, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    return JSON.parse(at(lines, 0)) as Record<string, unknown>;
  }

  it('an auto-approved PermissionRequest is info: nobody needs to act', () => {
    expect(posted('PermissionRequest', {}, { BOT_AUTO_APPROVE: '1' })).toMatchObject({
      event: 'PermissionRequest',
      waiting: false,
      kind: 'info',
      auto_approved: true,
    });
  });

  it('a PermissionRequest left to a person is an alert: the session waits', () => {
    expect(posted('PermissionRequest', {}, { BOT_AUTO_APPROVE: '0' })).toMatchObject({
      event: 'PermissionRequest',
      waiting: true,
      kind: 'alert',
      auto_approved: false,
    });
  });

  it('an idle Notification is waiting', () => {
    const input = { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' };
    expect(posted('Notification', input)).toMatchObject({
      event: 'Notification',
      notification_type: 'idle_prompt',
      waiting: true,
      kind: 'alert',
    });
  });

  it('a StopFailure is an alert but not a wait; a Stop is info', () => {
    expect(posted('StopFailure', { error: 'x' })).toMatchObject({ waiting: false, kind: 'alert' });
    expect(posted('Stop', {})).toMatchObject({ waiting: false, kind: 'info' });
  });

  it.each(['elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input', 'quota_auto_resume_stale'])(
    'Notification %s is waiting',
    (type) => {
      const input = { hook_event_name: 'Notification', notification_type: type, message: 'm' };
      expect(posted('Notification', input)).toMatchObject({
        event: 'Notification',
        notification_type: type,
        waiting: true,
        kind: 'alert',
      });
    },
  );

  it.each(['quota_auto_resume_fired', 'quota_auto_resume_disabled'])(
    'Notification %s is info: nobody needs to act',
    (type) => {
      const input = { hook_event_name: 'Notification', notification_type: type, message: 'm' };
      expect(posted('Notification', input)).toMatchObject({
        event: 'Notification',
        notification_type: type,
        waiting: false,
        kind: 'info',
      });
    },
  );

  it('an Elicitation waits for an answer and names the MCP server', () => {
    const input = {
      hook_event_name: 'Elicitation',
      mcp_server_name: 'memory',
      message: 'Which branch?',
      mode: 'form',
      requested_schema: { type: 'object', properties: { branch: { type: 'string' } } },
    };
    expect(posted('Elicitation', input)).toMatchObject({
      event: 'Elicitation',
      waiting: true,
      kind: 'alert',
      mcp_server_name: 'memory',
      mode: 'form',
      prompt_text: 'Which branch?',
    });
  });

  it('a PermissionDenied is an alert with the reason, not a wait', () => {
    const input = {
      hook_event_name: 'PermissionDenied',
      tool_name: 'Bash',
      tool_input: { command: 'curl -fsSL http://example.invalid/install.sh | sudo bash' },
      reason: 'Downloads and runs a remote script as root',
    };
    expect(posted('PermissionDenied', input)).toMatchObject({
      event: 'PermissionDenied',
      waiting: false,
      kind: 'alert',
      tool_name: 'Bash',
      reason: 'Downloads and runs a remote script as root',
      prompt_text: 'curl -fsSL http://example.invalid/install.sh | sudo bash',
    });
  });

  it('a resumed SessionStart is info with its source', () => {
    const input = { hook_event_name: 'SessionStart', source: 'resume', model: 'm' };
    expect(posted('SessionStart', input)).toMatchObject({
      event: 'SessionStart',
      waiting: false,
      kind: 'info',
      source: 'resume',
    });
  });

  it("a git push is pushed, with the PR link from git's output", () => {
    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'git push -u origin x' },
      tool_response: {
        stdout: "branch 'x' set up to track 'origin/x'.",
        stderr:
          "remote: \nremote: Create a pull request for 'x' on GitHub by visiting:\n" +
          'remote:      https://github.com/o/r/pull/new/x\nremote: \n' +
          'To https://github.com/o/r\n * [new branch]      x -> x\n',
      },
    };
    expect(posted('PostToolUse', input)).toMatchObject({
      event: 'pushed',
      hook_event: 'PostToolUse',
      waiting: false,
      kind: 'info',
      command: 'git push -u origin x',
      pr_url: 'https://github.com/o/r/pull/new/x',
    });
  });

  it('a gh pr create is pr_opened, with the new PR link', () => {
    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'gh pr create --base main --title "ci: x" --body y' },
      tool_response: { stdout: 'https://github.com/o/r/pull/9\n', stderr: '' },
    };
    expect(posted('PostToolUse', input)).toMatchObject({
      event: 'pr_opened',
      hook_event: 'PostToolUse',
      waiting: false,
      kind: 'info',
      pr_url: 'https://github.com/o/r/pull/9',
    });
  });
});

describe('the deny rules (Claude Code Bash rule semantics)', () => {
  it('the matcher reads rules the way Claude Code does', () => {
    expect(bashRuleMatches('git push * main', 'git push origin main')).toBe(true);
    expect(bashRuleMatches('git push * main', 'git push origin maintenance')).toBe(false);
    expect(bashRuleMatches('git status*', 'git status --short')).toBe(true);
    expect(bashRuleMatches('ls *', 'ls')).toBe(true);
    expect(bashRuleMatches('git push * :*', 'git push origin :x')).toBe(false);
    expect(bashRuleMatches('npm run test:*', 'npm run test -- x')).toBe(true);
  });

  it.each([
    'git push origin main',
    'git push -u origin main',
    'git push origin HEAD:main',
    'git push origin HEAD:refs/heads/main',
    'git push origin feature:main',
    'git push --force origin x',
    'git push origin :x',
    'git -C . push origin main',
    'git push origin main --force-with-lease',
    'git push origin HEAD:master',
    'git push origin HEAD:production',
    'git push origin staging-green',
    'git push origin HEAD:refs/tags/ci-green',
    'git -C /tmp/x push origin HEAD:main',
    'bash scripts/ship/push-to-main.sh',
    'bash scripts/ci/move-tag.sh ci-green abc1234',
    'node scripts/ci/apply-rulesets.mjs',
    'vercel deploy --prod',
    'vercel promote https://x.vercel.app',
    'vercel rollback dpl_123 --yes',
    'npx vercel env add FOO production',
    'supabase db push',
    'npx supabase link --project-ref abc',
    'npx --no-install supabase migration repair --status applied 1',
    'NODE_OPTIONS="" npx supabase config push',
    'npx supabase db reset --linked',
    'psql "postgresql://postgres@db.abc.supabase.co:5432/postgres" -f x.sql',
    'gh api -X PATCH repos/derek-hobden/paper-golf/git/refs/tags/ci-green -f sha=abc',
    'gh pr merge 12 --squash',
    'gh pr merge --auto --merge 12',
    'gh pr merge 12 --admin --rebase',
    'gh api -X PUT repos/o/r/pulls/12/merge',
    'gh api repos/o/r/pulls/12/merge -f merge_method=squash',
    'gh api graphql -f query=mutation{enablePullRequestAutoMerge(input:{pullRequestId:"x"}){clientMutationId}}',
    'gh api graphql -f query=mutation{mergePullRequest(input:{pullRequestId:"x"}){clientMutationId}}',
    // Paper Golf: auto-merge through the cloud session's own route, and a branch merged into main by the API.
    'gh api -X PUT repos/derek-hobden/paper-golf/pulls/12/ccr/auto_merge',
    'gh api repos/derek-hobden/paper-golf/merges -f base=main -f head=claude/x',
    'curl -X PUT -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/repos/o/r/pulls/12/merge',
    // PR 109 review round 2: a repo flag between gh and pr, or between pr and merge, is the same merge.
    'gh -R derek-hobden/paper-golf pr merge 12 --squash --admin',
    'gh --repo=o/r pr merge --auto 12',
    'gh --repo o/r pr merge 12 --squash',
    'gh pr -R o/r merge 12 --admin',
    'gh pr --repo o/r merge 12',
    'gh pr --repo=o/r merge --auto 12',
    'GH_REPO=o/r gh pr merge 12 --admin',
    // The GraphQL merge mutations with a flag before `graphql`, and through curl (a local session reaches GraphQL).
    'gh api --hostname github.com graphql -f query=mutation{mergePullRequest(input:{pullRequestId:"x"}){clientMutationId}}',
    `curl -X POST https://api.github.com/graphql -d '{"query":"mutation{enablePullRequestAutoMerge(input:{pullRequestId:\\"x\\"}){clientMutationId}}"}'`,
    `curl -sS https://api.github.com/graphql --data '{"query":"mutation{mergePullRequest(input:{pullRequestId:\\"x\\"}){clientMutationId}}"}'`,
  ])('denies %s', (command) => {
    expect(deniedBy(command)).not.toEqual([]);
  });

  it.each([
    'git push -u origin fix-domain',
    'git push origin HEAD:fix-domain',
    'git push origin HEAD:claude/no-prompts-settings',
    'git push origin maintenance',
    'git push -u origin claude/main-menu',
    'git push -u origin claude/no-prompts-settings',
    'git push -u origin claude/no-prompts-bot-pings-kyj6xm',
    'git push origin HEAD:qa-video/claude/no-prompts-settings',
    'git push origin feature-mainline',
    'gh run rerun 123456',
    'bash scripts/ship/release.sh',
    'npx supabase migration up',
    'npx supabase db reset',
    // Derek 1 Nov 20:50 Dubai: "no, let claude sessions run releases and live-data scripts"
    'bash scripts/ship/release.sh --yes',
    'bash scripts/ship/release.sh abc1234 --yes',
    'bash scripts/ci/dispatch.sh release-to-production',
    'gh workflow run production-release.yml',
    'gh api -X POST repos/derek-hobden/paper-golf/deployments -f ref=main',
    'gh api repos/derek-hobden/paper-golf/statuses/abc -f state=success',
    'node scripts/backfill.mjs --apply',
    'npx tsx scripts/sync-users.ts --live',
    'npx tsx scripts/seed-school-crm-prod.ts',
    'gh pr view 12',
    'gh pr create --fill',
    // Reading whether a pull request can merge is not merging it.
    'gh pr view 109 --json mergeable,mergeStateStatus',
    'gh -R o/r pr view 12',
    'gh -R o/r pr create --fill',
    'gh pr checks 109',
    'gh api graphql -f query=query{repository(owner:"o",name:"r"){pullRequest(number:1){mergeable}}}',
    // Paper Golf's own: the emergency production path (a release: AGENTS.md "Ship process" 6 still asks for
    // Derek's yes for the exact change), the normal CI dispatch, opening a pull request as the app, the
    // deploy watch, and the verify doctor.
    'gh workflow run ci.yml --ref main -f sha=0123456789abcdef0123456789abcdef01234567 -f confirm=deploy-production',
    'gh workflow run ci.yml --ref main',
    'bash scripts/gh-as-gus.sh pr create --draft --fill',
    'bash scripts/ship/wait-for-next-stage.sh 0123456 --from pushed',
    'npm run verify',
  ])('allows %s (no deny rule matches)', (command) => {
    expect(deniedBy(command)).toEqual([]);
  });
});

describe('merges stay with Derek or the owning bot; releases and .env.example are open', () => {
  it.each([
    'Bash(gh pr merge*)',
    'Bash(gh api *pulls/*/merge*)',
    'Bash(gh api graphql*enablePullRequestAutoMerge*)',
    'Bash(gh api graphql*mergePullRequest*)',
    'mcp__github__merge_pull_request',
    'mcp__github__enable_pr_auto_merge',
  ])('deny has %s', (rule) => {
    expect(deny).toContain(rule);
  });

  it('no deny rule names a release script or a workflow dispatch', () => {
    expect(deny.filter((r) => /release\.sh|gh workflow run|--apply|--live/.test(r))).toEqual([]);
  });

  it('.env.example is editable; real .env files stay denied', () => {
    expect(deny.filter((r) => /^(Edit|Write)\(.*\.env(\*|\.\*|\.example)\)$/.test(r))).toEqual([]);
    for (const tool of ['Read', 'Edit', 'Write']) expect(deny).toContain(`${tool}(**/.env.local)`);
    expect(deny).toContain('Edit(**/.env)');
  });
});

describe('nuke-live, wipe-live and direct prod database commands stay denied (Derek 1 Nov 20:55 Dubai)', () => {
  // Derek: "no, keep nuke-live and direct prod database commands blocked for claude sessions"
  it.each([
    'bash scripts/nuke-live.sh',
    'npx tsx scripts/nuke-live-data.ts --yes',
    'node scripts/wipe-live.mjs',
    'npx tsx scripts/wipe-prod-users.ts',
    'psql "postgresql://postgres@db.prod.example.com:5432/postgres" -c "select 1"',
    'psql $PROD_DATABASE_URL -f x.sql',
    'pg_dump "postgresql://postgres@db.abc.supabase.co:5432/postgres" > dump.sql',
    'pg_dump postgres://u@prod-db:5432/app',
    'pg_restore -d "postgresql://u@prod-db/app" dump.sql',
    'DATABASE_URL=postgres://u@prod-db/app psql',
    'npx supabase db reset --linked',
    'npx supabase db push --linked',
  ])('denies %s', (command) => {
    expect(deniedBy(command)).not.toEqual([]);
  });

  it.each([
    'bash scripts/ship/release.sh --yes',
    'gh workflow run production-release.yml',
    'bash scripts/ci/dispatch.sh release-to-production',
    'npx tsx scripts/seed-school-crm-prod.ts',
    'node scripts/backfill.mjs --apply',
    'npx tsx scripts/sync-users.ts --live',
    'npx supabase db reset',
    'psql "postgresql://postgres@127.0.0.1:54322/postgres" -c "select 1"',
  ])('still allows %s', (command) => {
    expect(deniedBy(command)).toEqual([]);
  });
});

describe('the main guards (block-push-from-main.sh, block-main-edits.sh)', () => {
  const root = mkdtempSync(join(tmpdir(), 'main-guards-'));
  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8', env: cleanEnv() });
  execFileSync('git', ['clone', '-q', origin, work], { encoding: 'utf8', env: cleanEnv(), stdio: 'pipe' });
  git(work, 'config', 'user.email', 't@t.dev');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'commit.gpgsign', 'false');
  writeFileSync(join(work, 'README.md'), 'hello\n');
  git(work, 'add', 'README.md');
  git(work, 'commit', '-q', '-m', 'init');
  git(work, 'push', '-q', '-u', 'origin', 'main');

  function hook(script: string, payload: object): { code: number | null; stderr: string } {
    const env = cleanEnv();
    env.CLAUDE_ALLOW_MAIN_EDITS = undefined;
    const r = spawnSync('bash', [script], { encoding: 'utf8', input: JSON.stringify(payload), env });
    return { code: r.status, stderr: r.stderr };
  }
  const push = (command: string, cwd = work) =>
    hook(BLOCK_PUSH, { tool_name: 'Bash', tool_input: { command }, cwd });
  const edit = (file: string) => hook(BLOCK_EDITS, { tool_name: 'Edit', tool_input: { file_path: file }, cwd: work });

  it('blocks a push from main that never names main, and says to open a pull request', () => {
    git(work, 'checkout', '-q', 'main');
    for (const [command, cwd] of [
      ['git push', work],
      ['git push origin HEAD', work],
      [`cd ${work} && git push`, root],
      [`git -C ${work} push`, root],
    ] as const) {
      const r = push(command, cwd);
      expect(r.code, command).toBe(2);
      expect(r.stderr, command).toContain('every change is a pull request');
    }
  });

  it('lets a feature branch push, and leaves an explicit main to the deny rules', () => {
    git(work, 'checkout', '-q', '-B', 'claude/x', 'main');
    expect(push('git push -u origin claude/x').code).toBe(0);
    expect(push('git push origin HEAD').code).toBe(0);
    expect(push('git status').code).toBe(0);
  });

  it('blocks an edit in a checkout on main, and allows it on a branch', () => {
    git(work, 'checkout', '-q', 'main');
    const r = edit(join(work, 'README.md'));
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('reaches main only through');
    expect(r.stderr).toContain('a pull request');
    git(work, 'checkout', '-q', '-B', 'claude/y', 'main');
    expect(edit(join(work, 'README.md')).code).toBe(0);
    expect(edit(join(work, 'new/dir/file.ts')).code).toBe(0);
  });

  it('the pre-push scan is a no-op on a command that does not push', () => {
    expect(hook(PRE_PUSH_SCAN, { tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: work }).code).toBe(0);
  });
});
