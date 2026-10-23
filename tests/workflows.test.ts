import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at } from './helpers';

/**
 * The workflows themselves: every job is bounded in time, nothing installs a browser, and the jobs that
 * run the Playwright suite take their browsers from the official container at the version package-lock.json
 * resolves.
 *
 * On 22 Oct 2026 `npx playwright install --with-deps webkit` froze three deploy jobs (run 39781080561:
 * staging 15m04s and production 18m45s on that one step, each cancelled by hand, and the same step took 34s
 * on the attempt that got through). A step with no limit of its own, installing a browser the image already
 * has, is what made a deploy hang; these cases keep all three facts out of the workflows.
 */

const DIR = '.github/workflows';
// Every job is capped; a deploy job is capped tighter, because a hanging deploy blocks the next one.
const JOB_CAP_MINUTES = 25;
const DEPLOY_CAP_MINUTES = 15;
// A step that runs one Playwright shard stays inside 8 minutes. The whole suite in
// one step measured 7m40s (and 7m22s-7m58s on the old bare-runner job), so ci.yml and
// the staging smoke run it as shards. The rollback still runs the full suite in one
// step: against a deployment that outgrew 8 minutes (run 39841475142 passed 208 of 211
// tests and was cut off), so that one step is 12, which still fits the 15-minute deploy job.
const PROJECT_SMOKE_STEP_CAP_MINUTES = 8;
const FULL_SUITE_STEP_MINUTES = 12;
// The @quick production check is a start page and one solo round: ~20s.
const QUICK_SMOKE_STEP_CAP_MINUTES = 5;
const VERCEL_STEP_CAP_MINUTES = 6;
const PLAYWRIGHT_LOCK_PATH = 'node_modules/@playwright/test';

interface Step {
  readonly name: string;
  readonly text: string;
  readonly timeout: number | undefined;
}

interface Job {
  readonly id: string;
  readonly text: string;
  readonly timeout: number | undefined;
  readonly image: string | undefined;
  readonly steps: readonly Step[];
}

/** The first capture of `re` over these lines, or undefined. */
function firstMatch(lines: readonly string[], re: RegExp): string | undefined {
  for (const line of lines) {
    const m = re.exec(line);
    if (m !== null) return at(m, 1);
  }
  return undefined;
}

function minutes(lines: readonly string[], re: RegExp): number | undefined {
  const found = firstMatch(lines, re);
  return found === undefined ? undefined : Number(found);
}

/** One step: from its `- ` line to the next one. A run block's own lines are indented further. */
function readStep(lines: readonly string[]): Step {
  const head = at(lines, 0);
  const named = /^ {6}- name: (.+)$/.exec(head);
  return {
    name: named === null ? head.replace(/^ {6}- /, '') : at(named, 1),
    text: lines.join('\n'),
    timeout: minutes(lines, /^ {8}timeout-minutes: (\d+)$/),
  };
}

function readSteps(lines: readonly string[]): Step[] {
  const start = lines.indexOf('    steps:');
  if (start < 0) return [];
  const steps: Step[] = [];
  let current: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = at(lines, i);
    if (line.startsWith('      - ')) {
      if (current.length > 0) steps.push(readStep(current));
      current = [line];
      continue;
    }
    if (current.length > 0) current.push(line);
  }
  if (current.length > 0) steps.push(readStep(current));
  return steps;
}

/** Every job of a workflow: the 2-space keys under `jobs:`, each with its own lines. */
function readJobs(yml: string): Job[] {
  const lines = yml.split('\n');
  const start = lines.indexOf('jobs:');
  if (start < 0) throw new Error('a workflow with no jobs: block');
  const jobs: Job[] = [];
  let id = '';
  let current: string[] = [];
  const flush = (): void => {
    if (id === '') return;
    jobs.push({
      id,
      text: current.join('\n'),
      timeout: minutes(current, /^ {4}timeout-minutes: (\d+)$/),
      image: firstMatch(current, /^ {6}image: (\S+)$/),
      steps: readSteps(current),
    });
  };
  for (let i = start + 1; i < lines.length; i++) {
    const line = at(lines, i);
    const head = /^ {2}([a-z][a-z0-9_-]*):$/.exec(line);
    if (head !== null) {
      flush();
      id = at(head, 1);
      current = [];
      continue;
    }
    if (id !== '') current.push(line);
  }
  flush();
  return jobs;
}

/** What a comment says is not what a step runs. */
function code(yml: string): string {
  return yml
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

/** The version package-lock.json resolves for a package, with no casts to get at it. */
function lockedPlaywrightVersion(): string {
  const lock: unknown = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  if (typeof lock !== 'object' || lock === null || !('packages' in lock)) {
    throw new Error('package-lock.json has no packages');
  }
  const packages = lock.packages;
  if (typeof packages !== 'object' || packages === null || !(PLAYWRIGHT_LOCK_PATH in packages)) {
    throw new Error(`package-lock.json has no ${PLAYWRIGHT_LOCK_PATH}`);
  }
  const entry = packages[PLAYWRIGHT_LOCK_PATH];
  if (typeof entry !== 'object' || entry === null || !('version' in entry) || typeof entry.version !== 'string') {
    throw new Error(`${PLAYWRIGHT_LOCK_PATH} has no version in package-lock.json`);
  }
  return entry.version;
}

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.yml'))
  .sort();
const workflows = files.map((file) => ({ file, yml: readFileSync(`${DIR}/${file}`, 'utf8') }));
const PLAYWRIGHT_IMAGE = `mcr.microsoft.com/playwright:v${lockedPlaywrightVersion()}-noble`;

describe('.github/workflows', () => {
  it('has the workflows this suite knows about', () => {
    expect(files).toContain('ci.yml');
    expect(files).toContain('deploy.yml');
    expect(workflows.length).toBeGreaterThanOrEqual(8);
  });

  it.each(workflows)('$file: every job says how long it may take', ({ file, yml }) => {
    const jobs = readJobs(yml);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.timeout, `${file} job ${job.id} has no timeout-minutes`).toBeDefined();
      expect(job.timeout, `${file} job ${job.id}`).toBeGreaterThan(0);
      expect(job.timeout, `${file} job ${job.id}`).toBeLessThanOrEqual(JOB_CAP_MINUTES);
    }
  });

  // The hang itself: `playwright install --with-deps` in front of the suite. The browsers come
  // with the container now, so no step may install one — in any workflow, by any name.
  it.each(workflows)('$file: no step installs a browser', ({ file, yml }) => {
    const ran = code(yml);
    expect(ran, `${file} installs a browser`).not.toMatch(/playwright install/);
    expect(ran, `${file} installs browser dependencies`).not.toMatch(/--with-deps/);
    expect(ran, `${file} installs a browser channel`).not.toMatch(/install\s+(chrome|msedge|webkit|chromium|firefox)/);
  });

  it('the deploy jobs are capped tighter than the rest', () => {
    const deploy = workflows.find((w) => w.file === 'deploy.yml');
    expect(deploy).toBeDefined();
    for (const job of readJobs(deploy === undefined ? '' : deploy.yml)) {
      expect(job.timeout, `deploy.yml job ${job.id}`).toBeLessThanOrEqual(DEPLOY_CAP_MINUTES);
    }
  });

  // A job that runs the suite needs browsers, and the only browsers it gets are the image's,
  // at the one version that matches the @playwright/test in the lockfile.
  it.each(workflows)('$file: a job that runs the suite takes its browsers from the image', ({ file, yml }) => {
    for (const job of readJobs(yml)) {
      if (!/npm run smoke|playwright test/.test(code(job.text))) continue;
      expect(job.image, `${file} job ${job.id} runs the suite outside the Playwright container`).toBe(PLAYWRIGHT_IMAGE);
      expect(job.text, `${file} job ${job.id} does not point the chrome project at the image`).toContain(
        'scripts/ship/container-chrome.sh',
      );
      // Chromium cannot start its sandbox as root inside the container.
      expect(job.text, `${file} job ${job.id} leaves the Chromium sandbox on`).toContain("CHROME_NO_SANDBOX: '1'");
    }
  });

  // Both shard matrices are this list, in this order. A project added to the config has to
  // appear here or the test below fails, which is the point: a new project must be sharded.
  const SHARDS = [
    'chrome 1/4',
    'chrome 2/4',
    'chrome 3/4',
    'chrome 4/4',
    'iphone-webkit 1/2',
    'iphone-webkit 2/2',
  ];

  /** `project shard/total` rows from a job's matrix include. */
  function shardRows(jobText: string): string[] {
    const lines = jobText.split('\n');
    const rows: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const project = /^ {10}- project: ([a-z0-9-]+)$/.exec(at(lines, i));
      if (project === null) continue;
      const shard = /^ {12}shard: (\d+)$/.exec(at(lines, i + 1));
      const total = /^ {12}total: (\d+)$/.exec(at(lines, i + 2));
      if (shard === null || total === null) {
        throw new Error(`shard row under ${at(project, 1)} is not shard then total`);
      }
      rows.push(`${at(project, 1)} ${at(shard, 1)}/${at(total, 1)}`);
    }
    return rows;
  }

  // The suite runs as shards of every project. The job named smoke only gates them.
  it('every Playwright project is sharded in CI and on staging', () => {
    const config = readFileSync('playwright.config.ts', 'utf8');
    const projects = config.slice(config.indexOf('projects: ['), config.indexOf('webServer'));
    const names = [...projects.matchAll(/\{ name: '([a-z0-9-]+)'/g)].map((m) => at(m, 1));
    expect(names.length, 'no projects found in playwright.config.ts').toBeGreaterThanOrEqual(2);
    const ci = readFileSync(`${DIR}/ci.yml`, 'utf8');
    const deploy = readFileSync(`${DIR}/deploy.yml`, 'utf8');
    const smokeShard = readJobs(ci).find((job) => job.id === 'smoke-shard');
    const stagingSmoke = readJobs(deploy).find((job) => job.id === 'staging-smoke');
    expect(smokeShard, 'ci.yml has no smoke-shard job').toBeDefined();
    expect(stagingSmoke, 'deploy.yml has no staging-smoke job').toBeDefined();
    expect(shardRows(smokeShard === undefined ? '' : smokeShard.text)).toEqual(SHARDS);
    expect(shardRows(stagingSmoke === undefined ? '' : stagingSmoke.text)).toEqual(SHARDS);
    for (const name of names) {
      expect(SHARDS.join('\n'), `no shard for the ${name} project`).toContain(`${name} `);
    }
    const run = '--project="$PROJECT" --shard="$SHARD/$SHARD_TOTAL"';
    expect(code(smokeShard === undefined ? '' : smokeShard.text)).toContain(run);
    expect(code(stagingSmoke === undefined ? '' : stagingSmoke.text)).toContain(run);
    const gate = readJobs(ci).find((job) => job.id === 'smoke');
    expect(gate, 'ci.yml has no smoke gate').toBeDefined();
    expect(code(gate === undefined ? '' : gate.text)).not.toMatch(/playwright test|npm run smoke/);
  });

  // A container job's default shell is `sh`, not `bash`: `set -o pipefail` is a syntax error
  // there, so a step that relied on it would fail inside the container and nowhere else.
  it.each(workflows)('$file: a container job runs its steps in bash', ({ file, yml }) => {
    for (const job of readJobs(yml)) {
      if (job.image === undefined) continue;
      expect(job.text, `${file} job ${job.id} runs in a container without defaults.run.shell: bash`).toContain(
        'shell: bash',
      );
    }
  });

  // The parser is line-and-indent, not a YAML library (the repo has none). These counts fail
  // if a reformat hides a job or a job-level limit from it, instead of passing by not looking.
  it.each(workflows)('$file: the parser sees every job in the file', ({ file, yml }) => {
    const lines = code(yml).split('\n');
    const jobs = readJobs(yml);
    const count = (re: RegExp): number => lines.filter((line) => re.test(line)).length;
    expect(count(/^ {4}runs-on:/), `${file}: a job the parser did not see`).toBe(jobs.length);
    expect(count(/^ {4}timeout-minutes:/), `${file}: a job limit the parser did not see`).toBe(jobs.length);
    expect(count(/^ {6}image:/), `${file}: a container the parser did not see`).toBe(
      jobs.filter((job) => job.image !== undefined).length,
    );
    expect(count(/^ {6}- /), `${file}: a step the parser did not see`).toBe(
      jobs.reduce((n, job) => n + job.steps.length, 0),
    );
  });

  // The job limit is the backstop; a step that can hang says so itself, close to the work.
  it.each(workflows)('$file: the long steps have a limit of their own', ({ file, yml }) => {
    for (const job of readJobs(yml)) {
      for (const step of job.steps) {
        const ran = code(step.text);
        const where = `${file} job ${job.id} step "${step.name}"`;
        if (/npm run smoke:quick/.test(ran)) {
          expect(step.timeout, `${where} runs the quick check with no timeout-minutes`).toBeDefined();
          expect(step.timeout, where).toBeLessThanOrEqual(QUICK_SMOKE_STEP_CAP_MINUTES);
        } else if (/playwright test/.test(ran)) {
          expect(step.timeout, `${where} runs the suite with no timeout-minutes`).toBeDefined();
          expect(step.timeout, where).toBeLessThanOrEqual(PROJECT_SMOKE_STEP_CAP_MINUTES);
        } else if (/npm run smoke/.test(ran)) {
          expect(step.timeout, `${where} runs the full suite with no timeout-minutes`).toBeDefined();
          expect(step.timeout, where).toBe(FULL_SUITE_STEP_MINUTES);
          expect(step.timeout ?? 0, `${where} does not fit its job`).toBeLessThan(job.timeout ?? 0);
        }
        if (/vercel (build|deploy)/.test(ran)) {
          expect(step.timeout, `${where} deploys with no timeout-minutes`).toBeDefined();
          expect(step.timeout, where).toBeLessThanOrEqual(VERCEL_STEP_CAP_MINUTES);
        }
      }
    }
  });

  // A failed or hung Vercel call is tried once more, with a timeout of its own, by the same script.
  it('every Vercel call in a deploy job is retried once', () => {
    const deploy = workflows.find((w) => w.file === 'deploy.yml');
    expect(deploy).toBeDefined();
    for (const job of readJobs(deploy === undefined ? '' : deploy.yml)) {
      for (const step of job.steps) {
        const ran = code(step.text);
        if (!/vercel (pull|build|deploy|alias)/.test(ran)) continue;
        // The step's own `name:` is not a command it runs.
        const commands = ran.split('\n').filter((l) => !/^\s*-?\s*name:/.test(l));
        for (const line of commands.filter((l) => /vercel (pull|build|deploy|alias)/.test(l))) {
          expect(line, `deploy.yml job ${job.id} step "${step.name}" calls Vercel without retry.sh`).toContain(
            'scripts/ship/retry.sh',
          );
        }
      }
    }
  });

  // Whatever happened, the run says so in one line: LIVE <url> <sha> or FAILED <job>.
  it('the Deploy workflow always ends with a one-line summary', () => {
    const deploy = readFileSync(`${DIR}/deploy.yml`, 'utf8');
    const jobs = readJobs(deploy);
    const summary = jobs.find((job) => job.id === 'summary');
    expect(summary, 'deploy.yml has no summary job').toBeDefined();
    expect(summary === undefined ? '' : summary.text).toContain('if: always()');
    expect(summary === undefined ? '' : summary.text).toContain('bash scripts/ship/deploy-summary.sh');
    // It waits for every other job, so it is the last word on the run.
    expect(summary === undefined ? '' : summary.text).toContain('needs: [prepare, staging, production, notify]');
    // And the notify job is still there.
    expect(jobs.map((job) => job.id)).toContain('notify');
  });
});
