/**
 * Shared plumbing for the GitHub-event bot ping tests (tests/bot-ping-*.test.ts), ported from the fleet
 * template's RuckBee tests (scripts/__tests__/bot-ping-harness.ts there).
 *
 * Each workflow's run scripts are extracted from the YAML (as text: the repo has no YAML parser) and run
 * as GitHub runs them: `bash -e`, the workflow env, the step's env with real-looking values for its
 * expressions, and the event payload at GITHUB_EVENT_PATH. The payloads are real-shaped webhook bodies
 * in tests/fixtures/github-events/. A fake `gh` answers from tests/fixtures/github-events/api/
 * (fake-gh.mjs) and a fake `curl` records each POST, so nothing leaves the machine.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env as processEnv } from 'node:process';
import { afterEach, beforeEach, expect } from 'vitest';
import { REPO } from './hook-harness';
import { at } from './helpers';

export const WORKFLOWS = `${REPO}.github/workflows`;
export const EVENTS = `${REPO}tests/fixtures/github-events`;
export const IS_BOT_PR = `${REPO}scripts/ci/is-bot-pr.sh`;
export const R = 'derek-hobden/paper-golf';
export const HOOK = 'https://bot.example.test/hooks/paper-golf';
export const KEY = 'test-bot-key-0123456789';
export const MAIN_SHA = 'c0ffee'.padEnd(40, '1');
export const prUrl = (n: number): string => `https://github.com/${R}/pull/${String(n)}`;

// A fake curl: appends its arguments to curl.log as one JSON line per call and answers the way
// `-w '%{http_code}'` does: FAKE_CURL_CODE (default 200), or, with FAKE_CURL_EXIT, what real curl
// prints when the transfer fails (000) and that exit code.
const FAKE_CURL = `#!/usr/bin/env node
require('fs').appendFileSync(process.env.STUB + '/curl.log', JSON.stringify(process.argv.slice(2)) + '\\n')
if (process.env.FAKE_CURL_EXIT) {
  process.stdout.write('000')
  process.exit(Number(process.env.FAKE_CURL_EXIT))
}
process.stdout.write(process.env.FAKE_CURL_CODE || '200')
`;
const FAKE_GH = `#!/usr/bin/env bash
exec node "${EVENTS}/fake-gh.mjs" "$@"
`;

export interface GhCall {
  method: string;
  path: string;
  fields: string[];
  jq: string | null;
  paginate: boolean;
  token: string | null;
}

export interface Step {
  name: string;
  id: string | null;
  uses: string | null;
  if: string | null;
  continueOnError: boolean;
  env: Record<string, string>;
  run: string;
  body: string;
}

export interface RunOpts {
  /** A fixture name in tests/fixtures/github-events/, or an absolute path. */
  event: string;
  /** A routes file in tests/fixtures/github-events/api/ for the fake gh. */
  routes?: string;
  /** false: no BOT_WEBHOOK_URL / BOT_WEBHOOK_KEY. */
  secrets?: boolean;
  env?: Record<string, string>;
}

export interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

// ---- The workflow YAML, as text ----------------------------------------------

export function readWorkflow(file: string): string {
  return readFileSync(join(WORKFLOWS, file), 'utf8');
}

/** One job's lines (`  <id>:` under `jobs:`), up to the next job. */
export function jobText(yml: string, id: string): string {
  const lines = yml.split('\n');
  const jobsAt = lines.indexOf('jobs:');
  const start = lines.findIndex((l, i) => i > jobsAt && l === `  ${id}:`);
  if (jobsAt < 0 || start < 0) throw new Error(`no job ${id}`);
  const rest = lines.slice(start + 1).findIndex((l) => /^ {0,2}\S/.test(l));
  return lines.slice(start, rest < 0 ? lines.length : start + 1 + rest).join('\n');
}

export function jobIds(yml: string): string[] {
  const lines = yml.split('\n');
  const jobsAt = lines.indexOf('jobs:');
  return lines.flatMap((l, i) => {
    const m = i > jobsAt ? /^ {2}([\w-]+):\s*$/.exec(l) : null;
    return m ? [at(m, 1)] : [];
  });
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
    id: /^ {8}id: (.+)$/m.exec(body)?.[1] ?? null,
    uses: /^ {6}- uses: (.+)$/m.exec(body)?.[1] ?? /^ {8}uses: (.+)$/m.exec(body)?.[1] ?? null,
    if: /^ {8}if: (.+)$/m.exec(body)?.[1] ?? null,
    continueOnError: /^ {8}continue-on-error: true$/m.test(body),
    env,
    run,
    body,
  };
}

export function jobSteps(file: string, job: string): Step[] {
  return jobText(readWorkflow(file), job)
    .split(/\n(?= {6}- )/)
    .slice(1)
    .map(parseStep);
}

export function stepNamed(file: string, job: string, name: string): Step {
  const step = jobSteps(file, job).find((s) => s.name === name);
  if (!step) throw new Error(`${file}: no step "${name}" in job ${job}`);
  return step;
}

/** The workflow-level `env:` values (`  KEY: "value"   # comment`). */
export function workflowEnv(yml: string): Record<string, string> {
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

/** A top-level block (`on:`, `permissions:`, `concurrency:`) as text. */
export function block(yml: string, key: string): string {
  const m = new RegExp(`^${key}:.*\\n((?:^(?: .*|)\\n)*)`, 'm').exec(yml);
  return m ? m[0] : '';
}

// ---- Fixtures ---------------------------------------------------------------

export interface PullShape {
  number: number;
  html_url: string;
  user: { login: string };
  head: { ref: string };
}

/** A webhook payload from tests/fixtures/github-events/ (only the parts tests read are typed). */
export interface EventShape {
  action?: string;
  repository: { full_name: string };
  sender: { login: string };
  pull_request?: PullShape & { merged?: boolean };
  review?: { state: string };
  issue?: { pull_request?: object };
  comment?: { body: string; user: { login: string; type: string } };
}

export function event(name: string): EventShape {
  return JSON.parse(readFileSync(join(EVENTS, name), 'utf8')) as EventShape;
}

/** Every fixture a workflow's tests use is a real-shaped payload of its event. */
export function expectRealShaped(name: string): void {
  const e = event(name);
  expect(e.repository.full_name, name).toBe(R);
  expect(e.sender.login, name).toBeTruthy();
  if (!name.startsWith('push.')) expect(typeof e.action, name).toBe('string');
}

/** The value after a flag in an argument list (`-H` may repeat). */
export function after(args: readonly string[], flag: string): string[] {
  return args.flatMap((a, i) => (a === flag && i + 1 < args.length ? [at(args, i + 1)] : []));
}

export function expectNoSecretsPrinted(r: { stdout: string; stderr: string }): void {
  for (const out of [r.stdout, r.stderr]) {
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('bot.example.test');
  }
}

// ---- The stubs and the runner -----------------------------------------------

/**
 * Registers a fresh stub directory (fake curl and gh on PATH) around each test and returns the helpers
 * that run steps and read what they did.
 */
export function useStubs() {
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

  /** Runs bash with only the env given (never the caller's real secrets). */
  function sh(args: string[], env: Record<string, string>, cwd = REPO): Ran {
    return spawnSync('bash', args, {
      cwd,
      encoding: 'utf8',
      env: { NODE_ENV: 'test', PATH: `${dir}:${processEnv.PATH ?? ''}`, HOME: dir, STUB: dir, ...env },
    });
  }

  function lines(file: string): string[] {
    const path = join(dir, file);
    return existsSync(path)
      ? readFileSync(path, 'utf8')
          .trim()
          .split('\n')
          .filter((l) => l !== '')
      : [];
  }

  /** Every curl call so far, as its argument list. */
  const curlCalls = (): string[][] => lines('curl.log').map((l) => JSON.parse(l) as string[]);

  /** Every gh call so far. */
  const ghCalls = (): GhCall[] => lines('gh.log').map((l) => JSON.parse(l) as GhCall);

  /** The JSON bodies POSTed so far, each checked for the Bearer header and URL. */
  function pings(): Record<string, unknown>[] {
    return curlCalls().map((args) => {
      expect(after(args, '-X')).toEqual(['POST']);
      expect(after(args, '-H')).toEqual(['Content-Type: application/json', `Authorization: Bearer ${KEY}`]);
      expect(args.at(-1)).toBe(HOOK);
      const data = after(args, '--data');
      expect(data).toHaveLength(1);
      return JSON.parse(at(data, 0)) as Record<string, unknown>;
    });
  }

  /**
   * Runs one step's script as GitHub would: `bash -e`, the workflow env, the step's env with
   * real-looking values for its expressions, the event payload at GITHUB_EVENT_PATH and a GITHUB_OUTPUT
   * file.
   */
  function runStep(file: string, step: Step, opts: RunOpts): Ran & { outputs: Record<string, string> } {
    const script = join(dir, 'step.sh');
    writeFileSync(script, step.run);
    const out = join(dir, 'github_output');
    writeFileSync(out, '');
    const secrets: Record<string, string> =
      opts.secrets === false ? {} : { BOT_WEBHOOK_URL: HOOK, BOT_WEBHOOK_KEY: KEY };
    const r = sh(['-e', script], {
      ...workflowEnv(readWorkflow(file)),
      ...secrets,
      GH_TOKEN: 'test-gh-token',
      GITHUB_EVENT_PATH: opts.event.startsWith('/') ? opts.event : join(EVENTS, opts.event),
      GITHUB_REPOSITORY: R,
      GITHUB_OUTPUT: out,
      FAKE_GH_ROUTES: opts.routes === undefined ? '' : join(EVENTS, 'api', opts.routes),
      MERGE_WATCH_SLEEP: '0',
      ...opts.env,
    });
    const outputs: Record<string, string> = Object.fromEntries(
      readFileSync(out, 'utf8')
        .split('\n')
        .filter((l) => l !== '')
        .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
    );
    return { ...r, outputs };
  }

  return {
    dir: () => dir,
    sh,
    curlCalls,
    ghCalls,
    pings,
    runStep,
  };
}

// ---- What every bot-ping-*.yml for a GitHub event shares ---------------------

export interface Contract {
  file: string;
  on: string;
  /** The activity types, e.g. `[submitted]`; null for push (branches: [main]). */
  types: string | null;
  timeout: number;
}

/** The checks every GitHub-event bot ping workflow must pass, as [title, fn] pairs. */
export function contractChecks({ file, on, types, timeout }: Contract): [string, () => void][] {
  const yml = readWorkflow(file);
  const steps = (): (readonly [string, Step])[] =>
    jobIds(yml).flatMap((j) => jobSteps(file, j).map((s) => [j, s] as const));
  return [
    [
      `runs on ${on}${types === null ? '' : ` ${types}`} only, never on edited`,
      () => {
        const onBlock = block(yml, 'on');
        expect(onBlock).toMatch(new RegExp(`^ {2}${on}:$`, 'm'));
        expect(onBlock.match(/^ {2}\w+:/gm)).toHaveLength(1);
        if (types === null) expect(onBlock).toMatch(/^ {4}branches: \[main\]/m);
        else expect(onBlock).toContain(`    types: ${types}\n`);
        expect(onBlock).not.toMatch(/edited/);
      },
    ],
    [
      `every job has timeout-minutes ${String(timeout)}, and the workflow a concurrency group`,
      () => {
        for (const job of jobIds(yml)) {
          expect(jobText(yml, job), job).toMatch(new RegExp(`^ {4}timeout-minutes: ${String(timeout)}$`, 'm'));
        }
        const conc = block(yml, 'concurrency');
        expect(conc).toMatch(new RegExp(`^ {2}group: ${file.replace('.yml', '')}\\b`, 'm'));
        expect(conc).toMatch(/^ {2}cancel-in-progress: false$/m);
      },
    ],
    [
      'has the same bot config as bot-ping-pr-check-failed.yml, marked EDIT',
      () => {
        const existing = workflowEnv(readWorkflow('bot-ping-pr-check-failed.yml'));
        expect(workflowEnv(yml)).toMatchObject({
          BOT_AUTHORS: existing.BOT_AUTHORS,
          BOT_BRANCH_PREFIXES: existing.BOT_BRANCH_PREFIXES,
        });
        expect(yml).toMatch(/^ {2}BOT_AUTHORS: "[^"]*" +# EDIT/m);
        expect(yml).toMatch(/^ {2}BOT_BRANCH_PREFIXES: "[^"]*" +# EDIT/m);
      },
    ],
    [
      'reads the bot secrets in one step only, never prints them, and the ping never fails the job',
      () => {
        expect(yml.match(/secrets\.BOT_WEBHOOK_URL/g)).toHaveLength(1);
        expect(yml.match(/secrets\.BOT_WEBHOOK_KEY/g)).toHaveLength(1);
        expect(yml.match(/secrets\./g)).toHaveLength(2);
        for (const line of yml.split('\n')) {
          if (/\b(echo|printf)\b/.test(line)) expect(line).not.toMatch(/BOT_WEBHOOK_/);
        }
        const pinging = steps().filter(([, s]) => s.env.BOT_WEBHOOK_URL !== undefined);
        expect(pinging).toHaveLength(1);
        const ping = at(pinging, 0)[1];
        expect(ping.env).toMatchObject({
          BOT_WEBHOOK_URL: '${{ secrets.BOT_WEBHOOK_URL }}',
          BOT_WEBHOOK_KEY: '${{ secrets.BOT_WEBHOOK_KEY }}',
        });
        expect(ping.continueOnError).toBe(true);
      },
    ],
    [
      'passes event values through env or the event file, never ${{ }} in a script',
      () => {
        for (const [job, step] of steps()) {
          expect(step.run, `${job}/${step.name}`).not.toContain('${{');
        }
      },
    ],
    [
      'never checks out pull request code by ref, and keeps no credentials',
      () => {
        expect(yml).not.toMatch(/ref:.*(head|pull_request)/);
        for (const [, step] of steps().filter(([, s]) => s.uses?.startsWith('actions/checkout') === true)) {
          expect(step.body).toMatch(/persist-credentials: false/);
          expect(step.body).toMatch(/sparse-checkout: scripts\/ci/);
        }
      },
    ],
    [
      "keeps check-pr-triggers.mjs passing with ci.yml's list",
      () => {
        const list = /^ {10}PR_TEXT_WORKFLOWS: (.+)$/m.exec(readWorkflow('ci.yml'))?.[1] ?? '';
        expect(list).not.toBe('');
        const r = spawnSync('node', [`${REPO}scripts/ci/check-pr-triggers.mjs`, WORKFLOWS], {
          cwd: REPO,
          encoding: 'utf8',
          env: { ...processEnv, PR_TEXT_WORKFLOWS: list },
        });
        expect(r.stderr).toBe('');
        expect(r.stdout.trim()).toBe('pr triggers ok');
      },
    ],
  ];
}
