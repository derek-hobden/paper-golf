import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { at, defined } from './helpers';
import {
  dependencyWords,
  type Facts,
  jobLabel,
  MAX_SHOWN,
  pageHtml,
  parseFacts,
  recordingSeconds,
  scenes,
  spokenName,
  storyMarkdown,
} from '../e2e/walkthroughs/deps/dependency-update-scenes';
import { sceneCutCss } from '../e2e/walkthroughs/scene-cut';

// A dependency update's explainer is main's own film (pr-video-deps.yml): it draws facts.json —
// the pull request's diff and CI run, read through the API as data — in the plain story's order,
// with the result last in the same words the narration says.

const RAW = {
  pr: 101,
  sha: '4444444ddddddddddddddddddddddddddddddddd',
  base: '5555555eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  author: 'dependabot[bot]',
  ci_run: 900,
  updates: [
    { name: '@playwright/test', from: '^1.64.1', to: '^1.65.0' },
    { name: 'actions/checkout', from: 'v7.0.1', to: 'v7.0.2' },
  ],
  more: 0,
  dependency_files: 3,
  other_files: 0,
  checks: [
    { name: 'check', conclusion: 'success', seconds: 240 },
    { name: 'smoke-shard (chrome, 1, 4)', conclusion: 'success', seconds: 180 },
    { name: 'smoke-shard (iphone-webkit, 2, 2)', conclusion: 'success', seconds: 300 },
    { name: 'smoke', conclusion: 'success', seconds: 10 },
  ],
  main: { sha: '5555555', conclusion: 'success' },
};

const facts = (over: Record<string, unknown> = {}): Facts => defined(parseFacts({ ...RAW, ...over }));

/** The fixed result scripts/ship/pr-video-script.sh says last, built from the same counts. */
const bashWords = (checks: number, other: number): string => {
  const r = spawnSync(
    'env',
    ['-u', 'REVIEW_ROUND', `DEPS_CHECKS=${String(checks)}`, `DEPS_OTHER=${String(other)}`, 'DEPS_UPDATES=2',
      'bash', 'scripts/ship/pr-video-script.sh', '--verdict'],
    { encoding: 'utf8' },
  );
  expect(r.status, r.stderr).toBe(0);
  return r.stdout.trim();
};

describe('the dependency update walkthrough', () => {
  it('reads facts.json field by field, and refuses what is not a dependency update', () => {
    expect(facts().updates).toHaveLength(2);
    expect(parseFacts(null)).toBeUndefined();
    expect(parseFacts({ ...RAW, author: 'someone' })).toBeUndefined();
    expect(parseFacts({ ...RAW, author: 'claude[bot]' })).toBeUndefined();
    expect(parseFacts({ ...RAW, pr: '101' })).toBeUndefined();
    expect(parseFacts({ ...RAW, sha: 'HEAD; rm -rf /' })).toBeUndefined();
    expect(parseFacts({ ...RAW, other_files: -1 })).toBeUndefined();
    expect(facts({ main: 'green' }).main).toBeNull();
  });

  it('drops a name or a version that is not one, and never draws more than it may', () => {
    const f = facts({
      updates: [
        { name: '<img src=x onerror=alert(1)>', from: '1.0.0', to: '2.0.0' },
        { name: 'vite', from: '7.1.2"><script>', to: '7.1.3' },
        { name: 'ok', from: '1.0.0', to: '1.0.1' },
        ...Array.from({ length: 12 }, (_, i) => ({ name: `pkg-${String(i)}`, from: '1.0.0', to: '1.1.0' })),
      ],
      checks: [{ name: 'check<script>', conclusion: 'success', seconds: 1 }, ...RAW.checks],
    });
    expect(f.updates.map((u) => u.name)).not.toContain('vite');
    expect(at(f.updates, 0).name).toBe('ok');
    expect(f.updates).toHaveLength(MAX_SHOWN);
    expect(f.checks.map((c) => c.name)).toEqual(RAW.checks.map((c) => c.name));
    const page = pageHtml(f);
    expect(page).not.toContain('<script');
    expect(page).not.toContain('onerror');
  });

  it('opens on what this is, ends on the result, and cuts between scenes', () => {
    const f = facts();
    const list = scenes(f);
    expect(list.map((s) => s.kind)).toEqual(['opening', 'before', 'change', 'after', 'result']);
    expect(at(list, 0).title).toBe('An automatic update of 2 dependencies');
    // The opening is the first 15 seconds (AGENTS.md "Plain words for someone not in the loop").
    expect(at(list, 0).seconds).toBe(15);
    expect(recordingSeconds(f)).toBeGreaterThanOrEqual(45);
    const page = pageHtml(f);
    expect(page).toContain(sceneCutCss(list.length));
    expect(page).not.toMatch(/transition:\s*opacity/);
    list.forEach((s, i) => {
      expect(page).toContain(`<section id="s${String(i)}" class="scene ${s.kind}">`);
    });
  });

  it('shows the real evidence: main before, every CI job on the new versions after', () => {
    const page = pageHtml(facts());
    expect(page).toContain('main’s checks passed · 5555555');
    expect(page).toContain('Types, style, tests, build');
    expect(page).toContain('Chrome 1 of 4');
    expect(page).toContain('iPhone 2 of 2');
    expect(page).toContain('Every browser test');
    expect(page).toContain('4 min');
    expect(page).toContain('CI run on commit 4444444, the head of pull request 101');
    expect(pageHtml(facts({ main: null }))).toContain('No run of main’s checks found');
    expect(jobLabel('mutation')).toBe('mutation');
  });

  it('ends on the same result words the narration says, built from the same counts', () => {
    for (const [checks, other] of [[8, 0], [4, 1], [1, 3]] as const) {
      expect(dependencyWords(checks, other)).toBe(bashWords(checks, other));
    }
    const f = facts();
    const result = at(scenes(f), 4);
    expect(result.title).toBe(dependencyWords(4, 0));
    expect(pageHtml(f)).toContain(`<h1 class=said>${result.title}</h1>`);
    expect(dependencyWords(4, 2)).toContain('a person should look at them closely before approving');
    expect(at(scenes(facts({ other_files: 2 })), 2).step).toContain('2 other files');
  });

  it('writes one step per scene, quoting only the headline each scene shows, in words a voice can say', () => {
    const f = facts();
    const story = storyMarkdown(f);
    const steps = story.split('\n').filter((l) => l.startsWith('- '));
    expect(steps).toHaveLength(scenes(f).length);
    const page = pageHtml(f);
    for (const [i, step] of steps.entries()) {
      for (const [, quoted] of step.matchAll(/"([^"]+)"/g)) {
        expect(quoted).toBe(at(scenes(f), i).title);
        expect(page).toContain(defined(quoted));
      }
    }
    expect(story).toMatch(/^## Spec\n/);
    expect(story).toContain('## How to see it');
    expect(story).toContain('playwright test from 1.64.1 to 1.65.0');
    // The narration's speakable check: no path, no long token.
    for (const word of story.split(/\s+/)) {
      expect(word.length, word).toBeLessThanOrEqual(24);
      expect(word.split('/').length, word).toBeLessThanOrEqual(2);
    }
    expect(spokenName('@typescript-eslint/eslint-plugin')).toBe('typescript eslint eslint plugin');
  });

  it('is filmed by pr-video-deps.sh only, outside the ordinary recorder, from facts and nothing else', () => {
    const spec = readFileSync('e2e/walkthroughs/deps/dependency-update.spec.ts', 'utf8');
    const config = readFileSync('e2e/walkthroughs/deps/playwright.config.ts', 'utf8');
    expect(spec).toContain("process.env['FACTS_FILE']");
    expect(spec).toContain('beats.mark()');
    expect(spec).toContain('beats.save()');
    expect(spec).toContain('story.md');
    expect(spec).not.toContain('page.goto');
    expect(config).not.toContain('webServer');
    expect(config).toContain("testMatch: 'dependency-update.spec.ts'");
  });
});
