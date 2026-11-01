/**
 * bot-ping-merge-watch.yml: after each push to main, every open bot pull request's mergeability is read
 * again, and a change pings the owning bot: newly conflicting is kind merge_conflict (priority alert),
 * newly behind main is kind behind_main (priority info). The last state lives in a marker label on the
 * PR (bot-merge:dirty, bot-merge:behind; removed once neither holds), so an unchanged state never pings
 * twice. GitHub answers mergeable null while it computes it, so a PR is asked up to 5 times; still
 * unknown, it is left as it was. Harness: tests/bot-ping-harness.ts. Ported from the fleet template's
 * RuckBee test.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  block,
  contractChecks,
  EVENTS,
  expectNoSecretsPrinted,
  expectRealShaped,
  MAIN_SHA,
  prUrl,
  R,
  readWorkflow,
  stepNamed,
  useStubs,
  type RunOpts,
} from './bot-ping-harness';

const FILE = 'bot-ping-merge-watch.yml';
const ROUTES = 'merge-watch.routes.json';
const LIST = `GET repos/${R}/pulls?state=open&per_page=100`;

describe(FILE, () => {
  const t = useStubs();
  const yml = readWorkflow(FILE);
  const step = stepNamed(FILE, 'watch', 'Track bot PR merge states');
  const run = (opts: Partial<RunOpts> = {}) =>
    t.runStep(FILE, step, { event: 'push.main.json', routes: ROUTES, ...opts });

  for (const [title, check] of contractChecks({
    file: FILE,
    on: 'push',
    types: null,
    timeout: 5,
  })) {
    it(title, check);
  }

  it('may write labels, and polls with short sleeps', () => {
    expectRealShaped('push.main.json');
    expect(block(yml, 'permissions')).toBe('permissions:\n  contents: read\n  issues: write\n  pull-requests: write\n');
    expect(block(yml, 'concurrency')).toBe('concurrency:\n  group: bot-ping-merge-watch\n  cancel-in-progress: false\n');
    expect(step.env.GH_TOKEN).toBe('${{ github.token }}');
    expect(step.run).toContain('${MERGE_WATCH_SLEEP:-3}');
    // Only the tests set it (to 0): the workflow never does.
    expect(yml).not.toMatch(/^\s+MERGE_WATCH_SLEEP:/m);
  });

  it('pings a new conflict or fall-behind once, and keeps the labels in step', () => {
    const r = run();
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expectNoSecretsPrinted(r);
    const common = { waiting: false, repo: R, main_sha: MAIN_SHA, ts: expect.any(Number) as unknown };
    expect(t.pings()).toEqual([
      {
        kind: 'merge_conflict',
        priority: 'alert',
        pr: 601,
        pr_url: prUrl(601),
        mergeable_state: 'dirty',
        author: 'human-dev',
        branch: 'claude/new-conflict',
        ...common,
      },
      {
        kind: 'behind_main',
        priority: 'info',
        pr: 605,
        pr_url: prUrl(605),
        mergeable_state: 'behind',
        // A bot's pull request by its author alone: the branch has no bot prefix.
        author: 'golf-gus-bot[bot]',
        branch: 'rob/slow-to-compute',
        ...common,
      },
      // A draft's mergeable_state is "draft"; mergeable false still means a conflict.
      {
        kind: 'merge_conflict',
        priority: 'alert',
        pr: 607,
        pr_url: prUrl(607),
        mergeable_state: 'draft',
        author: 'human-dev',
        branch: 'claude/draft-conflict',
        ...common,
      },
      {
        kind: 'behind_main',
        priority: 'info',
        pr: 608,
        pr_url: prUrl(608),
        mergeable_state: 'behind',
        author: 'human-dev',
        branch: 'claude/dirty-now-behind',
        ...common,
      },
    ]);

    const calls = t.ghCalls();
    const gets = (n: number) => calls.filter((c) => c.method === 'GET' && c.path === `repos/${R}/pulls/${String(n)}`);
    // Bot PRs only; a null mergeability is asked again, at most 5 times.
    expect(gets(601)).toHaveLength(1);
    expect(gets(604)).toHaveLength(0);
    expect(gets(605)).toHaveLength(3);
    expect(gets(606)).toHaveLength(5);
    expect(calls[0]).toMatchObject({
      method: 'GET',
      path: `repos/${R}/pulls?state=open&per_page=100`,
      paginate: true,
      token: 'test-gh-token',
    });

    const writes = calls
      .filter((c) => c.method !== 'GET')
      .map((c) => `${c.method} ${c.path} ${c.fields.join(' ')}`.trim());
    expect(writes).toEqual([
      // The two labels, created before the first is added (both exist here: 422, ignored).
      `POST repos/${R}/labels name=bot-merge:dirty color=b60205 description=Bot PR conflicts with main (bot-ping-merge-watch)`,
      `POST repos/${R}/labels name=bot-merge:behind color=fbca04 description=Bot PR is behind main (bot-ping-merge-watch)`,
      `POST repos/${R}/issues/601/labels labels[]=bot-merge:dirty`,
      `DELETE repos/${R}/issues/603/labels/bot-merge%3Adirty`,
      `POST repos/${R}/issues/605/labels labels[]=bot-merge:behind`,
      `POST repos/${R}/issues/607/labels labels[]=bot-merge:dirty`,
      `DELETE repos/${R}/issues/608/labels/bot-merge%3Adirty`,
      `POST repos/${R}/issues/608/labels labels[]=bot-merge:behind`,
    ]);
    expect(r.stdout).toContain('#602 behind, unchanged');
    expect(r.stdout).toContain('#603 clean, bot-merge:dirty removed');
    expect(r.stdout).toContain('#606 mergeability still unknown after 5 tries, left as is');
  });

  it('nothing changed: no ping and no label writes', () => {
    const routes = JSON.parse(readFileSync(join(EVENTS, 'api', ROUTES), 'utf8')) as Record<string, unknown>;
    const list = routes[LIST] as { number: number }[];
    const steady = {
      [LIST]: list.filter((p) => [602, 604].includes(p.number)),
      [`GET repos/${R}/pulls/602`]: routes[`GET repos/${R}/pulls/602`],
      [`GET repos/${R}/pulls/604`]: routes[`GET repos/${R}/pulls/604`],
    };
    const file = join(t.dir(), 'steady.json');
    writeFileSync(file, JSON.stringify(steady));
    const r = run({ env: { FAKE_GH_ROUTES: file } });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('#602 behind, unchanged');
    expect(t.curlCalls()).toEqual([]);
    expect(t.ghCalls().filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('a failed PR list does nothing, exit 0', () => {
    const r = run({ routes: 'missing.json' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('open PR list failed, nothing to do');
    expect(t.curlCalls()).toEqual([]);
  });

  it('without the secrets the labels still track, and nothing posts', () => {
    const r = run({ secrets: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('secrets not set, skipped');
    expect(t.curlCalls()).toEqual([]);
    expect(t.ghCalls().some((c) => c.path === `repos/${R}/issues/601/labels`)).toBe(true);
  });
});
