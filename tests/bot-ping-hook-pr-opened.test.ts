/**
 * The session hook's pr_opened ping (scripts/claude-hooks/bot-ping.sh, run after a tool call by
 * .claude/settings.json's PostToolUse entry). Ported from the fleet template's RuckBee tests.
 *
 * On RuckBee's throwaway PR 477 a session opened a pull request and no pr_opened ping fired: PostToolUse
 * ran the hook only for `Bash(gh pr create *)`, so a PR opened with the GitHub MCP tool, the REST or
 * GraphQL API, or another command form (an env prefix, `cd x && gh pr create`, `gh -R o/r pr create`)
 * never reached it. Now the hook runs after every Bash call and every MCP `create_pull_request` tool, and
 * the script reads the tool input and decides: pr_opened, pushed, or no ping at all.
 *
 * The GitHub-side backstop for the same event is bot-ping-pr-opened.yml (tests/bot-ping-pr-opened.test.ts);
 * both send the event name pr_opened.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanEnv, REPO } from './hook-harness';

const BOT_PING = `${REPO}scripts/claude-hooks/bot-ping.sh`;
const HOOK_COMMAND = 'bash "$CLAUDE_PROJECT_DIR/scripts/claude-hooks/bot-ping.sh" PostToolUse';
const PR = 'https://github.com/derek-hobden/paper-golf/pull/477';

interface HookEntry {
  matcher?: string;
  hooks?: { type: string; command: string; timeout?: number; if?: string }[];
}

const settings = JSON.parse(readFileSync(`${REPO}.claude/settings.json`, 'utf8')) as {
  hooks?: Record<string, HookEntry[]>;
};

/**
 * Claude Code's hook matcher (CLI 2.1.x): empty or `*` matches every tool; a matcher of only letters,
 * digits, `_` and `|` is a list of exact tool names; anything else is a regular expression tested against
 * the tool name.
 */
function matcherMatches(matcher: string | undefined, tool: string): boolean {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  if (/^[a-zA-Z0-9_|]+$/.test(matcher)) return matcher.split('|').includes(tool);
  return new RegExp(matcher).test(tool);
}

const postToolUse = (settings.hooks?.PostToolUse ?? []).filter((e) =>
  (e.hooks ?? []).some((h) => h.command === HOOK_COMMAND),
);

describe('.claude/settings.json runs bot-ping.sh after every PR-opening tool', () => {
  it('has one PostToolUse entry for it, with no `if`: the script decides', () => {
    expect(postToolUse).toHaveLength(1);
    expect(postToolUse[0]?.hooks).toEqual([{ type: 'command', command: HOOK_COMMAND, timeout: 10 }]);
  });

  it.each([
    ['Bash', true],
    ['mcp__github__create_pull_request', true],
    ['mcp__plugin_github_github__create_pull_request', true],
    ['mcp__github-enterprise__create_pull_request', true],
    ['Edit', false],
    ['Write', false],
    ['BashOutput', false],
    ['mcp__github__get_me', false],
    ['mcp__github__update_pull_request', false],
    ['mcp__github__create_pull_request_with_copilot', false],
    ['mcp__github__pull_request_read', false],
  ] as const)('the matcher runs it after %s: %s', (tool, matched) => {
    expect(matcherMatches(postToolUse[0]?.matcher, tool)).toBe(matched);
  });
});

// The hook caps stdin and its python with `timeout` (GNU coreutils).
const hasTools = ['timeout', 'python3'].every((cmd) => {
  try {
    execFileSync('bash', ['-c', `command -v ${cmd}`], { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
});

describe.skipIf(!hasTools)('bot-ping.sh decides from the tool input', () => {
  // A stand-in curl, first on PATH: records each --data payload, answers 200.
  const dir = mkdtempSync(join(tmpdir(), 'bot-ping-pr-opened-'));
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

  /** Every JSON body bot-ping.sh posts for one PostToolUse with this tool call. */
  function posts(tool: string, input: object, response: unknown = { stdout: '', stderr: '' }): Record<string, unknown>[] {
    // No webhook, ping key or cloud-session flag from the caller's environment.
    const env = Object.fromEntries(
      Object.entries(cleanEnv()).filter(([key]) => !/^(BOT_|FACTORY_PING_|CLAUDE_CODE_REMOTE)/.test(key)),
    );
    runs++;
    const out = join(dir, `posted-${String(runs)}.jsonl`);
    const log = join(dir, `ping-${String(runs)}.log`);
    const stdout = execFileSync('bash', [BOT_PING, 'PostToolUse'], {
      cwd: REPO,
      encoding: 'utf8',
      input: JSON.stringify({
        hook_event_name: 'PostToolUse',
        session_id: 'test-session',
        tool_name: tool,
        tool_input: input,
        tool_response: response,
      }),
      env: {
        ...env,
        PATH: `${dir}:${env.PATH ?? ''}`,
        BOT_WEBHOOK_URL: 'https://bot.invalid/hook',
        BOT_WEBHOOK_KEY: 'stub-key',
        BOT_PING_LOG: log,
        CURL_STUB_OUT: out,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(stdout).toBe('');
    const bodies = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n') : [];
    expect(bodies.length).toBe(existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0);
    return bodies.map((b) => JSON.parse(b) as Record<string, unknown>);
  }

  const bash = (command: string, stdout = '') => posts('Bash', { command }, { stdout, stderr: '' });

  it.each([
    'gh pr create --base main --title "ci: x" --body y',
    'GH_TOKEN=x gh pr create --fill',
    'GH_PROMPT_DISABLED=1 GH_REPO=derek-hobden/paper-golf gh pr create --fill',
    'env GH_PROMPT_DISABLED=1 gh pr create --fill',
    'cd /home/user/paper-golf && gh pr create --draft --fill',
    'gh -R derek-hobden/paper-golf pr create --fill',
    'gh --repo derek-hobden/paper-golf pr create --fill',
    'gh --repo=derek-hobden/paper-golf pr create --fill',
    'gh pr create -R derek-hobden/paper-golf --fill',
    '/usr/bin/gh pr new --fill',
    'command gh pr create --fill',
    'timeout 60 gh pr create --fill',
    'git push -u origin claude/x && gh pr create --fill',
    'git push -u origin claude/x\ngh pr create --fill',
    'url=$(gh pr create --fill) && echo "$url"',
    'bash -c "gh pr create --fill"',
    `gh pr create --title "ci: x" --body "$(cat <<'EOF'\nWhat changed and why.\n\nEOF\n)"`,
    'gh api repos/derek-hobden/paper-golf/pulls -f title=x -f head=claude/x -f base=main',
    'gh api -X POST /repos/{owner}/{repo}/pulls --input body.json',
    'gh api --method=POST repos/derek-hobden/paper-golf/pulls -F draft=true -f title=x',
    'gh api graphql -f query=\'mutation { createPullRequest(input: {repositoryId: "R_1", baseRefName: "main", headRefName: "claude/x", title: "x"}) { pullRequest { url } } }\'',
    'curl -sS -X POST -H "Authorization: Bearer $GH_TOKEN" https://api.github.com/repos/derek-hobden/paper-golf/pulls -d \'{"title":"x","head":"claude/x","base":"main"}\'',
    'curl -s --json \'{"title":"x"}\' https://api.github.com/repos/o/r/pulls',
  ])('a Bash PR creation is pr_opened: %s', (command) => {
    const bodies = bash(command, `${PR}\n`);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      event: 'pr_opened',
      hook_event: 'PostToolUse',
      waiting: false,
      kind: 'info',
      tool_name: 'Bash',
      command: command.slice(0, 300),
      pr_url: PR,
    });
  });

  it("reads the new PR's link from the API's JSON answer", () => {
    const answer = JSON.stringify({
      url: 'https://api.github.com/repos/derek-hobden/paper-golf/pulls/477',
      html_url: PR,
      number: 477,
    });
    const bodies = bash('gh api repos/derek-hobden/paper-golf/pulls -f title=x -f head=y', answer);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ event: 'pr_opened', pr_url: PR });
  });

  it.each(['mcp__github__create_pull_request', 'mcp__plugin_github_github__create_pull_request'])(
    'the MCP tool %s is pr_opened, with the link from its answer',
    (tool) => {
      const input = {
        owner: 'derek-hobden',
        repo: 'paper-golf',
        title: 'ci: throwaway',
        head: 'claude/throwaway',
        base: 'main',
        body: 'x',
      };
      const answer = [{ type: 'text', text: JSON.stringify({ id: '2600000477', url: PR }) }];
      const bodies = posts(tool, input, answer);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({
        event: 'pr_opened',
        hook_event: 'PostToolUse',
        waiting: false,
        kind: 'info',
        tool_name: tool,
        command: null,
        pr_url: PR,
      });
    },
  );

  it('an MCP create_pull_request whose answer has no link still pings, pr_url null', () => {
    const bodies = posts('mcp__github__create_pull_request', { title: 'x' }, 'created');
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ event: 'pr_opened', pr_url: null });
  });

  it.each([
    'git push',
    'git push -u origin claude/x',
    'git -C /tmp/x push origin HEAD:claude/x',
    'git -c push.default=current push',
    'GIT_TRACE=1 git push origin claude/x',
    'cd /home/user/paper-golf && git push -u origin claude/x',
    'git add -A && git commit -m "ci: x" && git push',
  ])('a git push is pushed, not pr_opened: %s', (command) => {
    const bodies = bash(command);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ event: 'pushed', command, tool_name: 'Bash' });
  });

  it.each([
    'git status',
    'git pull origin main',
    'git log --oneline -5',
    'gh pr view 477',
    'gh pr list --head claude/x',
    'gh pr checks 477',
    'gh repo view',
    'gh api repos/derek-hobden/paper-golf/pulls',
    'gh api repos/derek-hobden/paper-golf/pulls?state=open --paginate',
    'gh api repos/derek-hobden/paper-golf/pulls/477',
    'gh api repos/derek-hobden/paper-golf/pulls/477/reviews -f event=COMMENT',
    'gh api repos/derek-hobden/paper-golf/pulls/477/comments -f body=x',
    "gh api graphql -f query='{ viewer { login } }'",
    'curl -s https://api.github.com/repos/derek-hobden/paper-golf/pulls',
    'echo "gh pr create"',
    'git commit -m "docs: say gh pr create and git push"',
    'grep -rn "gh pr create" scripts',
    'npm run check',
  ])('anything else pings nothing: %s', (command) => {
    expect(bash(command, PR)).toEqual([]);
  });

  it.each(['mcp__github__update_pull_request', 'mcp__github__create_pull_request_with_copilot', 'mcp__github__get_me', 'Edit'])(
    'another tool pings nothing, even if the matcher let it through: %s',
    (tool) => {
      expect(posts(tool, { title: 'x', file_path: '/x' }, 'https://github.com/o/r/pull/9')).toEqual([]);
    },
  );
});
