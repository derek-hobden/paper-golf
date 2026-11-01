/**
 * Bot event pings: the owning bot hears about a failed check on a bot's pull request
 * (bot-ping-pr-check-failed.yml) and about every staging and production deploy result (the last step
 * of deploy.yml's `staging-deploy` and `production` jobs, through scripts/ci/bot-event-ping.sh).
 * Ported from the fleet template's RuckBee test (scripts/__tests__/bot-event-pings.test.ts there).
 *
 * Contract:
 *   - no BOT_WEBHOOK_URL / BOT_WEBHOOK_KEY: skipped, exit 0, nothing posted
 *   - with them: one POST of the payload with a Bearer header, exit 0 whatever the answer, and neither
 *     value is ever printed
 *   - the deploy ping is the last step of each deploy job, runs always() and never fails the job; it
 *     sends the deployed sha and the deployment URL
 *   - the PR ping fires only for a failed CI or Claude review run on a pull request whose author is a
 *     bot login or whose branch has a bot prefix (scripts/ci/is-bot-pr.sh, shared with the other bot
 *     pings); a human's PR never pings. It sends pr_url when the run names its pull request, and the
 *     failing job names next to the workflow's (RuckBee PR 477: workflow pr-text, job pr-title), read
 *     from the run's jobs.
 *
 * The scripts run as black boxes (the workflow steps extracted from the YAML) against a fake `curl` and
 * `gh` on PATH that log their arguments, so nothing leaves the machine.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env as processEnv } from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPO } from './hook-harness';
import { at, defined } from './helpers';

const PING = `${REPO}scripts/ci/bot-event-ping.sh`;
const WORKFLOWS = `${REPO}.github/workflows`;
const R = 'derek-hobden/paper-golf';
const HOOK = 'https://bot.example.test/hooks/paper-golf';
const KEY = 'test-bot-key-0123456789';
const SHA = 'a'.repeat(40);
const BOT = 'golf-gus-bot[bot]';

// A fake curl: logs each argument on its own line (payloads are one line of compact JSON) and answers
// HTTP 200 the way `-w '%{http_code}'` does.
const FAKE_CURL = `#!/usr/bin/env bash
printf '%s\\n' "$@" > "$STUB/curl.args"
printf 200
`;

// A fake gh: \`gh api <path> --jq <filter>\` applies the filter to $FAKE_JOBS for a run's jobs and to
// $FAKE_PULLS for anything else, like the real one does to the response; an unset answer fails like a 403.
const FAKE_GH = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB/gh.log"
printf 'GH_TOKEN=%s\\n' "$GH_TOKEN" >> "$STUB/gh.log"
[ "$1" = api ] || exit 2
shift
filter=
path=
while [ $# -gt 0 ]; do case "$1" in --jq) filter=$2; shift 2 ;; -*) shift ;; *) path=$1; shift ;; esac; done
case "$path" in */actions/runs/*/jobs*) answer=$FAKE_JOBS ;; *) answer=$FAKE_PULLS ;; esac
[ -n "$answer" ] || { echo 'HTTP 403: Resource not accessible by integration' >&2; exit 1; }
if [ -n "$filter" ]; then jq -r "$filter" <<<"$answer"; else printf '%s\\n' "$answer"; fi
`;

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bot-pings-'));
  for (const [name, body] of [
    ['curl', FAKE_CURL],
    ['gh', FAKE_GH],
  ] as const) {
    writeFileSync(join(dir, name), body);
    chmodSync(join(dir, name), 0o755);
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs a script with only the env given (never the caller's real secrets). */
function sh(args: string[], env: Record<string, string>, cwd = REPO) {
  return spawnSync('bash', args, {
    cwd,
    encoding: 'utf8',
    env: { NODE_ENV: 'test', PATH: `${dir}:${processEnv.PATH ?? ''}`, HOME: dir, STUB: dir, ...env },
  });
}

/** What the fake curl was called with, or null when it never ran. */
function curlArgs(): string[] | null {
  const file = join(dir, 'curl.args');
  return existsSync(file) ? readFileSync(file, 'utf8').replace(/\n$/, '').split('\n') : null;
}

/** The value after a flag in the curl call (`-H` may repeat). */
function after(args: readonly string[], flag: string): string[] {
  return args.flatMap((a, i) => (a === flag && i + 1 < args.length ? [at(args, i + 1)] : []));
}

function posted(): Record<string, unknown> {
  const args = defined(curlArgs(), 'a curl call');
  const data = after(args, '--data');
  expect(data).toHaveLength(1);
  return JSON.parse(at(data, 0)) as Record<string, unknown>;
}

// ---- Reading the workflow YAML as text (the repo has no YAML parser) --------

interface Step {
  name: string;
  if: string | null;
  continueOnError: boolean;
  env: Record<string, string>;
  run: string;
  body: string;
}

/** One job's lines (`  <id>:` under `jobs:`), up to the next job. */
function jobText(yml: string, id: string): string {
  const lines = yml.split('\n');
  const jobsAt = lines.indexOf('jobs:');
  const start = lines.findIndex((l, i) => i > jobsAt && l === `  ${id}:`);
  if (jobsAt < 0 || start < 0) throw new Error(`no job ${id}`);
  const rest = lines.slice(start + 1).findIndex((l) => /^ {0,2}\S/.test(l));
  return lines.slice(start, rest < 0 ? lines.length : start + 1 + rest).join('\n');
}

function parseStep(body: string): Step {
  const lines = body.split('\n');
  const env: Record<string, string> = {};
  const envAt = lines.findIndex((l) => /^ {8}env:\s*$/.test(l));
  if (envAt >= 0) {
    for (const l of lines.slice(envAt + 1)) {
      const m = /^ {10}([A-Z_][A-Z0-9_]*): (.*?)\s*(?:#.*)?$/.exec(l);
      if (!m) break;
      env[at(m, 1)] = at(m, 2);
    }
  }
  let run = '';
  const runAt = lines.findIndex((l) => /^ {8}run:/.test(l));
  if (runAt >= 0) {
    const inline = at(lines, runAt).replace(/^ {8}run:\s*/, '');
    if (inline === '|') {
      const block: string[] = [];
      for (const l of lines.slice(runAt + 1)) {
        if (l.trim() !== '' && !l.startsWith(' '.repeat(10))) break;
        block.push(l.slice(10));
      }
      run = block.join('\n').replace(/\n+$/, '') + '\n';
    } else {
      run = inline + '\n';
    }
  }
  return {
    name: /^ {6}- name: (.+)$/m.exec(body)?.[1] ?? '',
    if: /^ {8}if: (.+)$/m.exec(body)?.[1] ?? null,
    continueOnError: /^ {8}continue-on-error: true$/m.test(body),
    env,
    run,
    body,
  };
}

function jobSteps(file: string, job: string): Step[] {
  const yml = readFileSync(join(WORKFLOWS, file), 'utf8');
  return jobText(yml, job)
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map(parseStep);
}

/** The workflow-level `env:` values (`  KEY: "value"   # comment`). */
function workflowEnv(yml: string): Record<string, string> {
  const lines = yml.split('\n');
  const start = lines.indexOf('env:');
  const env: Record<string, string> = {};
  if (start < 0) return env;
  for (const l of lines.slice(start + 1)) {
    // A comment inside the block (bot-ping-pr-check-failed.yml explains PING_IGNORE_CHECKS above it).
    if (/^ {2}#/.test(l)) continue;
    const m = /^ {2}([A-Z_][A-Z0-9_]*): "([^"]*)"/.exec(l);
    if (!m) break;
    env[at(m, 1)] = at(m, 2);
  }
  return env;
}

function writeStep(script: string): string {
  const file = join(dir, 'step.sh');
  writeFileSync(file, script);
  return file;
}

// ---- scripts/ci/bot-event-ping.sh -------------------------------------------

describe('bot-event-ping.sh', () => {
  it('skips quietly with exit 0 when the secrets are not set', () => {
    const partial: Record<string, string>[] = [{}, { BOT_WEBHOOK_URL: HOOK }, { BOT_WEBHOOK_KEY: KEY }];
    for (const env of partial) {
      const r = sh([PING, '{"kind":"deploy"}'], env);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('skipped');
      expect(curlArgs()).toBeNull();
    }
  });

  it('posts the payload with the Bearer header and prints only the HTTP code', () => {
    const payload = JSON.stringify({ kind: 'deploy', env: 'staging', sha: SHA });
    const r = sh([PING, payload], { BOT_WEBHOOK_URL: HOOK, BOT_WEBHOOK_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('bot ping http=200');
    const args = defined(curlArgs(), 'a curl call');
    expect(after(args, '-X')).toEqual(['POST']);
    expect(after(args, '-H')).toEqual(['Content-Type: application/json', `Authorization: Bearer ${KEY}`]);
    expect(after(args, '--data')).toEqual([payload]);
    expect(args.at(-1)).toBe(HOOK);
    expect(args).toContain('-m');
    for (const out of [r.stdout, r.stderr]) {
      expect(out).not.toContain(KEY);
      expect(out).not.toContain('bot.example.test');
    }
  });

  it('refuses a non-https URL without calling curl', () => {
    const r = sh([PING, '{}'], { BOT_WEBHOOK_URL: 'http://bot.example.test/', BOT_WEBHOOK_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('non-https URL, skipped');
    expect(r.stdout).not.toContain('bot.example.test');
    expect(curlArgs()).toBeNull();
  });

  it('exits 0 when curl fails', () => {
    writeFileSync(join(dir, 'curl'), '#!/usr/bin/env bash\nexit 7\n');
    const r = sh([PING, '{}'], { BOT_WEBHOOK_URL: HOOK, BOT_WEBHOOK_KEY: KEY });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('bot ping http=000');
  });
});

// ---- The deploy pings -------------------------------------------------------

// Paper Golf deploys from one workflow: the staging deploy job and the production job (which promotes,
// smokes and rolls back). The staging URL is the alias the job sets; production's is the deploy step's.
const DEPLOY_JOBS = [
  {
    job: 'staging-deploy',
    env: 'staging',
    sha: '${{ needs.prepare.outputs.sha }}',
    url: '${{ env.STAGING_URL }}',
  },
  {
    job: 'production',
    env: 'production',
    sha: '${{ needs.prepare.outputs.sha }}',
    url: '${{ steps.deploy.outputs.url }}',
  },
] as const;

const DEPLOY_YML = readFileSync(join(WORKFLOWS, 'deploy.yml'), 'utf8');

it('deploy.yml: only the two ping steps read the bot secrets, and nothing prints them', () => {
  expect(DEPLOY_YML.match(/secrets\.BOT_WEBHOOK_(URL|KEY)/g)).toHaveLength(4);
  for (const line of DEPLOY_YML.split('\n')) {
    if (/\b(echo|printf)\b/.test(line)) expect(line).not.toMatch(/BOT_WEBHOOK_/);
  }
});

describe.each(DEPLOY_JOBS)('deploy.yml $job deploy ping', ({ job, env, sha, url }) => {
  const steps = jobSteps('deploy.yml', job);
  const last = defined(steps.at(-1), `the last step of ${job}`);

  it(`is the last step of the ${job} job, always(), and never fails the job`, () => {
    expect(last.name).toBe('Ping owning bot with the deploy result');
    expect(last.if).toBe('always()');
    expect(last.continueOnError).toBe(true);
    expect(last.run).toMatch(/kind: ?"deploy"/);
    expect(last.run).toMatch(/^bash scripts\/ci\/bot-event-ping\.sh "\$payload"$/m);
  });

  it('sends the job status, the deployed sha and the deployment URL', () => {
    expect(last.env).toMatchObject({
      BOT_WEBHOOK_URL: '${{ secrets.BOT_WEBHOOK_URL }}',
      BOT_WEBHOOK_KEY: '${{ secrets.BOT_WEBHOOK_KEY }}',
      DEPLOY_ENV: env,
      STATUS: '${{ job.status }}',
      SHA: sha,
      URL: url,
    });
    // The sha is the one the gate chose and the job checked out.
    expect(jobText(DEPLOY_YML, job)).toContain('ref: ${{ needs.prepare.outputs.sha }}');
    const id = /steps\.([\w-]+)\.outputs\.url/.exec(url);
    if (id === null) {
      // Staging: the job's own alias, which its vercel deploy step points at the new deployment.
      expect(jobText(DEPLOY_YML, job)).toContain('STAGING_URL: https://paper-golf-staging-derek-hobden.vercel.app');
      const deploy = steps.find((s) => s.name === 'vercel deploy (staging)');
      expect(deploy?.run).toMatch(/vercel deploy --prebuilt/);
      expect(deploy?.run).toContain('vercel alias set "$url" "${STAGING_URL#https://}"');
    } else {
      // Production: the output of this job's vercel deploy step.
      const deploy = steps.find((s) => new RegExp(`^ {8}id: ${at(id, 1)}$`, 'm').test(s.body));
      expect(deploy?.run).toMatch(/vercel deploy --prebuilt --prod/);
      expect(deploy?.run).toContain('echo "url=$url" >>"$GITHUB_OUTPUT"');
    }
  });

  it('builds the payload with a tool the job has (jq on the runner, node in the Playwright container)', () => {
    const container = /^ {4}container:$/m.test(jobText(DEPLOY_YML, job));
    if (container) {
      expect(last.run).toContain('node -e');
      expect(last.run).not.toMatch(/\bjq\b/);
    } else {
      expect(last.run).toContain('jq -nc');
    }
  });

  for (const status of ['success', 'failure', 'cancelled'] as const) {
    it(`posts a deploy event on ${status}`, () => {
      const deployment = `https://paper-golf-${env}-abc123.vercel.app`;
      const r = sh(['-e', writeStep(last.run)], {
        BOT_WEBHOOK_URL: HOOK,
        BOT_WEBHOOK_KEY: KEY,
        DEPLOY_ENV: env,
        STATUS: status,
        SHA,
        URL: deployment,
        RUN_URL: `https://github.com/${R}/actions/runs/1`,
        GITHUB_REPOSITORY: R,
      });
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe('bot ping http=200');
      expect(r.stdout).not.toContain(KEY);
      const body = posted();
      expect(body).toEqual({
        kind: 'deploy',
        env,
        status,
        sha: SHA,
        url: deployment,
        run_url: `https://github.com/${R}/actions/runs/1`,
        repo: R,
        waiting: false,
        ts: expect.any(Number) as unknown,
      });
      expect(after(defined(curlArgs(), 'a curl call'), '-H')).toContain(`Authorization: Bearer ${KEY}`);
    });
  }

  it('skips with exit 0 when the secrets are not set', () => {
    const r = sh(['-e', writeStep(last.run)], {
      DEPLOY_ENV: env,
      STATUS: 'success',
      SHA,
      URL: 'https://x.vercel.app',
      RUN_URL: 'https://github.com/x',
      GITHUB_REPOSITORY: R,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('secrets not set, skipped');
    expect(curlArgs()).toBeNull();
  });
});

// ---- The PR check-failure ping ----------------------------------------------

describe('bot-ping-pr-check-failed.yml', () => {
  const yml = readFileSync(join(WORKFLOWS, 'bot-ping-pr-check-failed.yml'), 'utf8');
  const steps = jobSteps('bot-ping-pr-check-failed.yml', 'ping');
  const step = defined(
    steps.find((s) => s.name === 'Ping owning bot'),
    'the Ping owning bot step',
  );
  const config = workflowEnv(yml);

  it('runs on completed CI and Claude review runs and filters to failed pull request runs', () => {
    expect(yml).toMatch(/^ {2}workflow_run:$/m);
    expect(yml).toMatch(/^ {4}workflows: \["CI", "Claude review"\]/m);
    expect(yml).toMatch(/^ {4}types: \[completed\]$/m);
    const cond = /^ {4}if: (.+)$/m.exec(jobText(yml, 'ping'))?.[1] ?? '';
    // CI runs on pull_request; the review runs on pull_request_target (main's copy reviews the PR).
    expect(cond).toContain(
      `contains(fromJSON('["pull_request","pull_request_target"]'), github.event.workflow_run.event)`,
    );
    expect(cond).toContain(
      `contains(fromJSON('["failure","timed_out","startup_failure"]'), github.event.workflow_run.conclusion)`,
    );
    // contents: read for the scripts/ci checkout (main's copy: workflow_run runs on main),
    // actions: read for the run's jobs.
    expect(yml).toMatch(/^permissions:\n {2}actions: read\n {2}contents: read\n {2}pull-requests: read\njobs:/m);
    expect(steps).toHaveLength(2);
    const checkout = at(steps, 0).body;
    expect(checkout).toMatch(/^ {6}- uses: actions\/checkout@v7$/m);
    expect(checkout).toMatch(/sparse-checkout: scripts\/ci/);
    expect(checkout).toMatch(/persist-credentials: false/);
  });

  it('decides bot or human with the shared scripts/ci/is-bot-pr.sh', () => {
    expect(step.run).toContain('bash scripts/ci/is-bot-pr.sh "$author" "$branch" && bot=1');
    expect(step.run).not.toMatch(/for \w+ in \$BOT_(AUTHORS|BRANCH_PREFIXES)/);
  });

  it('lists only workflows that run on pull requests', () => {
    const listed = JSON.parse(at(defined(/workflows: (\[.*?\])/.exec(yml), 'a workflows list'), 1)) as string[];
    const byName = new Map(
      readdirSync(WORKFLOWS)
        .filter((f) => f.endsWith('.yml'))
        .map((f) => {
          const text = readFileSync(join(WORKFLOWS, f), 'utf8');
          return [/^name: (.+)$/m.exec(text)?.[1]?.trim() ?? f, text] as const;
        }),
    );
    // Paper Golf's two pull request checks that can fail: the code check and the Claude review.
    expect(listed).toEqual(['CI', 'Claude review']);
    for (const name of listed) {
      expect(byName.has(name), name).toBe(true);
      expect(byName.get(name)).toMatch(/^ {2}pull_request(_target)?:/m);
    }
  });

  it('pings for the bot login and the claude/ prefix, ignoring no check', () => {
    expect(config.BOT_AUTHORS?.split(' ')).toEqual([BOT]);
    expect(config.BOT_BRANCH_PREFIXES?.split(' ')).toEqual(['claude/']);
    // No approval gate among CI's and the review's jobs always fails on a bot's pull request here.
    expect(yml).toMatch(/^ {2}PING_IGNORE_CHECKS: "" +# EDIT/m);
    expect(config.PING_IGNORE_CHECKS).toBe('');
  });

  // The step as GitHub runs it: `bash -e {0}`, its env, the workflow env, and the one expression in the
  // script (the token) filled in.
  function runPing(opts: {
    author: string | null;
    branch: string;
    secrets?: boolean;
    pullRequests?: { number: number }[];
    workflow?: string;
    event?: string;
    env?: Record<string, string>;
    /** The run's jobs; null: the jobs lookup fails. */
    jobs?: { name: string; conclusion: string | null }[] | null;
  }) {
    const expressions = step.run.match(/\$\{\{[^}]*\}\}/g) ?? [];
    expect(expressions).toEqual(['${{ github.token }}']);
    const script = step.run.replace('${{ github.token }}', 'test-gh-token');
    const run = {
      id: 99,
      name: opts.workflow ?? 'CI',
      event: opts.event ?? 'pull_request',
      conclusion: 'failure',
      head_branch: opts.branch,
      head_sha: SHA,
      pull_requests: opts.pullRequests ?? [{ number: 482 }],
      html_url: `https://github.com/${R}/actions/runs/99`,
    };
    const secrets: Record<string, string> =
      opts.secrets === false ? {} : { BOT_WEBHOOK_URL: HOOK, BOT_WEBHOOK_KEY: KEY };
    const pulls: Record<string, string> =
      opts.author === null ? {} : { FAKE_PULLS: JSON.stringify([{ number: 482, user: { login: opts.author } }]) };
    const jobs: Record<string, string> =
      opts.jobs === null
        ? {}
        : {
            FAKE_JOBS: JSON.stringify({
              total_count: (opts.jobs ?? []).length,
              jobs: opts.jobs ?? [{ name: 'check', conclusion: 'failure' }],
            }),
          };
    return sh(['-e', writeStep(script)], {
      ...config,
      ...secrets,
      RUN: JSON.stringify(run),
      REPO: R,
      ...pulls,
      ...jobs,
      ...opts.env,
    });
  }

  it("a human's PR on a feature branch: 'human PR, no ping' and no curl call", () => {
    const r = runPing({ author: 'stuart', branch: 'feature/x' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=stuart branch=feature/x bot=0');
    expect(r.stdout).toContain('human PR, no ping');
    expect(curlArgs()).toBeNull();
    // The author came from the commit's pull request, with the job's token.
    expect(readFileSync(join(dir, 'gh.log'), 'utf8')).toBe(
      `api repos/${R}/commits/${SHA}/pulls --jq .[0].user.login // ""\nGH_TOKEN=test-gh-token\n`,
    );
  });

  it('a claude/ branch posts, whoever opened it', () => {
    const r = runPing({ author: 'stuart', branch: 'claude/bot-event-pings' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('bot ping http=200');
    expect(posted()).toMatchObject({
      kind: 'check_failed',
      waiting: false,
      repo: R,
      workflow: 'CI',
      failed_jobs: ['check'],
      conclusion: 'failure',
      branch: 'claude/bot-event-pings',
      sha: SHA,
      pr: 482,
      pr_url: `https://github.com/${R}/pull/482`,
      author: 'stuart',
      url: `https://github.com/${R}/actions/runs/99`,
    });
    const args = defined(curlArgs(), 'a curl call');
    expect(after(args, '-H')).toContain(`Authorization: Bearer ${KEY}`);
    expect(args.at(-1)).toBe(HOOK);
  });

  it('a failed Claude review run (pull_request_target) pings with the review job', () => {
    const r = runPing({
      author: 'derek-hobden',
      branch: 'claude/no-prompts-bot-pings',
      workflow: 'Claude review',
      event: 'pull_request_target',
      jobs: [
        { name: 'decide', conclusion: 'success' },
        { name: 'claude-review', conclusion: 'failure' },
      ],
    });
    expect(r.status).toBe(0);
    expect(posted()).toMatchObject({
      kind: 'check_failed',
      workflow: 'Claude review',
      failed_jobs: ['claude-review'],
      branch: 'claude/no-prompts-bot-pings',
      author: 'derek-hobden',
    });
  });

  it('names the failing job as well as the workflow (RuckBee PR 477: pr-text failed in pr-title)', () => {
    const r = runPing({
      author: 'derek-hobden',
      branch: 'claude/throwaway',
      workflow: 'pr-text',
      jobs: [{ name: 'pr-title', conclusion: 'failure' }],
    });
    expect(r.status).toBe(0);
    expect(posted()).toMatchObject({
      kind: 'check_failed',
      workflow: 'pr-text',
      failed_jobs: ['pr-title'],
    });
    // The jobs of this run (its latest attempt), every page, with the job's token.
    const calls = readFileSync(join(dir, 'gh.log'), 'utf8').split('\n');
    expect(calls).toContain(
      `api --paginate repos/${R}/actions/runs/99/jobs?per_page=100 --jq .jobs[] | select(.conclusion == "failure") | .name`,
    );
    expect(calls.filter((l) => l.startsWith('GH_TOKEN='))).toEqual(['GH_TOKEN=test-gh-token', 'GH_TOKEN=test-gh-token']);
  });

  it('lists only the jobs whose conclusion is failure, in run order', () => {
    runPing({
      author: BOT,
      branch: 'claude/x',
      jobs: [
        { name: 'lint', conclusion: 'failure' },
        { name: 'typecheck', conclusion: 'success' },
        { name: 'pr-title', conclusion: 'failure' },
        { name: 'e2e (shard 1)', conclusion: 'failure' },
        { name: 'deploy', conclusion: 'skipped' },
        { name: 'smoke', conclusion: 'cancelled' },
        { name: 'still running', conclusion: null },
      ],
    });
    expect(posted()).toMatchObject({
      workflow: 'CI',
      failed_jobs: ['lint', 'pr-title', 'e2e (shard 1)'],
    });
  });

  it('leaves the PING_IGNORE_CHECKS jobs out, and sends nothing when only they failed', () => {
    const env = { PING_IGNORE_CHECKS: 'owner-approval, approve' };
    const only = runPing({ author: BOT, branch: 'claude/x', env, jobs: [{ name: 'approve', conclusion: 'failure' }] });
    expect(only.status).toBe(0);
    expect(only.stdout).toContain('only ignored checks failed (PING_IGNORE_CHECKS), no ping');
    expect(curlArgs()).toBeNull();
    runPing({
      author: BOT,
      branch: 'claude/x',
      env,
      jobs: [
        { name: 'approve', conclusion: 'failure' },
        { name: 'check', conclusion: 'failure' },
      ],
    });
    expect(posted()).toMatchObject({ kind: 'check_failed', failed_jobs: ['check'] });
  });

  it('sends failed_jobs [] when no job failed (a startup failure has no jobs)', () => {
    runPing({ author: BOT, branch: 'claude/x', jobs: [] });
    expect(posted()).toMatchObject({ workflow: 'CI', failed_jobs: [] });
  });

  it('still pings with failed_jobs null when the jobs lookup fails', () => {
    const r = runPing({ author: BOT, branch: 'claude/x', jobs: null });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('jobs lookup failed');
    expect(posted()).toMatchObject({ kind: 'check_failed', workflow: 'CI', failed_jobs: null });
  });

  it('sends pr and pr_url as null when the run names no pull request', () => {
    const r = runPing({ author: BOT, branch: 'claude/x', pullRequests: [] });
    expect(r.status).toBe(0);
    const body = posted();
    expect(body.pr).toBeNull();
    expect(body.pr_url).toBeNull();
  });

  it(`${BOT} posts on any branch`, () => {
    for (const branch of ['feature/x', 'fix-standings', 'stuart/claude/x']) {
      rmSync(join(dir, 'curl.args'), { force: true });
      const r = runPing({ author: BOT, branch });
      expect(r.status, branch).toBe(0);
      expect(r.stdout, branch).toContain('bot=1');
      expect(r.stdout, branch).toContain('bot ping http=200');
      expect(posted()).toMatchObject({ kind: 'check_failed', author: BOT, branch, pr: 482 });
    }
  });

  it('the bare app login is not a bot: only its [bot] login is', () => {
    const r = runPing({ author: 'golf-gus-bot', branch: 'feature/x' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('bot=0');
    expect(curlArgs()).toBeNull();
  });

  it('an author lookup that fails is not a bot: no ping, exit 0', () => {
    const r = runPing({ author: null, branch: 'feature/x' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=unknown branch=feature/x bot=0');
    expect(r.stdout).toContain('human PR, no ping');
    expect(curlArgs()).toBeNull();
  });

  it('a bot PR with no secrets skips with exit 0', () => {
    const r = runPing({ author: BOT, branch: 'claude/x', secrets: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('secrets not set, skipped');
    expect(curlArgs()).toBeNull();
  });

  it('never prints the webhook URL or key', () => {
    const r = runPing({ author: BOT, branch: 'claude/x' });
    for (const out of [r.stdout, r.stderr]) {
      expect(out).not.toContain(KEY);
      expect(out).not.toContain('bot.example.test');
    }
  });

  // The real-shaped workflow_run payloads in tests/fixtures/github-events/, as
  // `toJSON(github.event.workflow_run)` hands them to the step.
  function runFixture(name: string) {
    const fixtures = `${REPO}tests/fixtures/github-events`;
    const e = JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as {
      workflow_run: { id: number; head_sha: string };
    };
    const routes = JSON.parse(readFileSync(join(fixtures, 'api/commit-pulls.routes.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const pulls = routes[`GET repos/${R}/commits/${e.workflow_run.head_sha}/pulls`];
    const jobRoutes = JSON.parse(readFileSync(join(fixtures, 'api/run-jobs.routes.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const jobs = jobRoutes[`GET repos/${R}/actions/runs/${String(e.workflow_run.id)}/jobs?per_page=100`];
    const script = step.run.replace('${{ github.token }}', 'test-gh-token');
    const fakeJobs: Record<string, string> = jobs === undefined ? {} : { FAKE_JOBS: JSON.stringify(jobs) };
    return sh(['-e', writeStep(script)], {
      ...config,
      BOT_WEBHOOK_URL: HOOK,
      BOT_WEBHOOK_KEY: KEY,
      RUN: JSON.stringify(e.workflow_run),
      REPO: R,
      FAKE_PULLS: JSON.stringify(pulls),
      ...fakeJobs,
    });
  }

  it("a real failed check run on a bot's PR posts check_failed with pr_url", () => {
    const r = runFixture('workflow_run.completed.failure.bot-pr.json');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=human-dev branch=claude/bot-gh-event-pings bot=1');
    expect(posted()).toEqual({
      kind: 'check_failed',
      waiting: false,
      repo: R,
      workflow: 'check',
      failed_jobs: ['check'],
      conclusion: 'failure',
      branch: 'claude/bot-gh-event-pings',
      sha: '200ab'.padEnd(40, '7'),
      pr: 512,
      pr_url: `https://github.com/${R}/pull/512`,
      author: 'human-dev',
      url: `https://github.com/${R}/actions/runs/41300000001`,
      ts: expect.any(Number) as unknown,
    });
  });

  it("a real failed pr-text run (RuckBee PR 477's case) names its failing job pr-title", () => {
    const r = runFixture('workflow_run.completed.failure.pr-text.json');
    expect(r.status).toBe(0);
    expect(posted()).toEqual({
      kind: 'check_failed',
      waiting: false,
      repo: R,
      workflow: 'pr-text',
      failed_jobs: ['pr-title'],
      conclusion: 'failure',
      branch: 'claude/bot-gh-event-pings',
      sha: '200ab'.padEnd(40, '7'),
      pr: 512,
      pr_url: `https://github.com/${R}/pull/512`,
      author: 'human-dev',
      url: `https://github.com/${R}/actions/runs/41300000002`,
      ts: expect.any(Number) as unknown,
    });
  });

  it('a real run with an empty pull_requests list posts pr and pr_url as null', () => {
    const r = runFixture('workflow_run.completed.failure.no-pr.json');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('author=unknown branch=claude/from-a-fork bot=1');
    expect(posted()).toMatchObject({ kind: 'check_failed', pr: null, pr_url: null });
  });
});
