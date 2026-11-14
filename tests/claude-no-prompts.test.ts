/**
 * Claude Code sessions in this repo run without permission prompts (Derek, 1 Nov 2026; the fleet template,
 * from RuckBee PRs 473 to 478): .claude/settings.json sets bypassPermissions and has no `ask` list, so the
 * deny list is the only thing between an agent and a push to main, a merge, a production promote by hand
 * or a live database. In a cloud session (which cannot run bypassPermissions) scripts/claude-hooks/auto-approve.sh
 * answers what still prompts with "allow"; deny rules are checked first. The hooks are guards and nothing
 * else: no hook pings a bot (Derek, 14 Nov 2026: "Remove both: the Claude hooks and the GitHub PR/deploy pings").
 *
 * This pins all of that, and replays the deny rules with Claude Code's own Bash rule semantics, so a rule
 * that is too loose (the old `git push *main*` also caught `fix-domain`) or one that can never match fails
 * here. Releases and live-data scripts are open (Derek, 1 Nov 20:50 Dubai); nuke-live and direct prod
 * database commands stay denied (20:55); merges stay with Derek.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cleanEnv, git, REPO } from './hook-harness';

/** Outside .claude/, which a cloud session cannot edit without a prompt. */
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

/** Every hook the settings register, event by event: the guards, and no ping (Derek, 14 Nov 2026). */
const hook = (path: string): string => `bash "$CLAUDE_PROJECT_DIR/${path}"`;
const GUARD_HOOKS = {
  PermissionRequest: [{ matcher: '*', command: hook('scripts/claude-hooks/auto-approve.sh') }],
  PreToolUse: [
    { matcher: 'Bash', command: hook('.claude/hooks/block-push-from-main.sh') },
    { matcher: 'Bash', command: hook('.claude/hooks/no-main-without-pr.sh') },
    { matcher: 'Bash', command: hook('scripts/claude-hooks/pre-push-scan.sh') },
    { matcher: 'Edit|Write|NotebookEdit', command: hook('.claude/hooks/block-main-edits.sh') },
  ],
  SessionStart: [{ matcher: undefined, command: hook('.claude/hooks/check-model-effort.sh') }],
};

describe('the hooks are the guards and nothing else', () => {
  const registered = Object.fromEntries(
    Object.entries(settings.hooks ?? {}).map(([event, entries]) => [
      event,
      (entries ?? []).flatMap((e) => (e.hooks ?? []).map((h) => ({ matcher: e.matcher, command: h.command }))),
    ]),
  );

  it('registers exactly the guard hooks, event by event', () => {
    expect(registered).toEqual(GUARD_HOOKS);
  });

  it('no hook pings a bot or posts to a webhook', () => {
    expect(allCommands().filter((c) => /ping|webhook|curl|factory\//i.test(c))).toEqual([]);
  });

  it('scripts/claude-hooks holds the guard scripts only', () => {
    expect(readdirSync(`${REPO}scripts/claude-hooks`).sort()).toEqual([
      'auto-approve.sh',
      'pre-push-scan.mjs',
      'pre-push-scan.sh',
      'push-guards.mjs',
    ]);
  });

  it.each(allCommands())('%s exists and parses (bash -n)', (command) => {
    const path = /^bash "\$CLAUDE_PROJECT_DIR\/([^"]+)"$/.exec(command)?.[1] ?? '';
    expect(existsSync(`${REPO}${path}`)).toBe(true);
    expect(spawnSync('bash', ['-n', `${REPO}${path}`], { encoding: 'utf8' }).status).toBe(0);
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

describe('the refspec-delete rule', () => {
  it('keeps git push * :** and never the legacy git push * :*, which blocks every push', () => {
    expect(bashDeny).toContain('git push * :**');
    expect(bashDeny).not.toContain('git push * :*');
    expect(bashDeny).not.toContain('git -C * push * :*');
    expect(deniedBy('git push origin :claude/x')).not.toEqual([]);
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
    // PR 109 review round 3: main's branch protection is the backstop every other write to main meets, so a
    // session may not change it or the rulesets, and DELETE is denied however the method is spelt.
    'gh api --method=DELETE repos/derek-hobden/paper-golf/branches/main/protection',
    'gh api -XDELETE repos/o/r/hooks/1',
    'gh api -X PUT repos/derek-hobden/paper-golf/branches/main/protection --input protection.json',
    'gh api repos/o/r/branches/main/protection/required_pull_request_reviews -X PATCH -F required_approving_review_count=0',
    'gh api --method PUT repos/o/r/rulesets/1 --input ruleset.json',
    'gh api repos/o/r/rulesets -f name=x -f enforcement=disabled',
    'gh api repos/derek-hobden/paper-golf/statuses/abc -f state=success',
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
    'git push -u origin chore/remove-bot-hooks',
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
    'gh api repos/derek-hobden/paper-golf/branches/main',
    // Paper Golf's own: the emergency production path (a release: AGENTS.md "Ship process" 6 still asks for
    // Derek's yes for the exact change), the normal CI dispatch, opening a pull request as the app, the
    // deploy watch, and the verify doctor.
    'gh workflow run ci.yml --ref main -f sha=0123456789abcdef0123456789abcdef01234567 -f confirm=deploy-production',
    'gh workflow run ci.yml --ref main',
    'bash scripts/gh-as-gus.sh pr create --draft --fill',
    'bash scripts/ship/wait-for-next-stage.sh 0123456 --from pushed',
    'npm run verify',
    'git push origin claude/paper-golf-hooks-fleet-sync-oweoqy',
    'git push -u origin feature/x',
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
