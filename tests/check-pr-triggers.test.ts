/**
 * scripts/ci/check-pr-triggers.mjs, the `pr triggers` step of ci.yml's `check` job (fleet template): editing a
 * pull request's text never re-runs the full check, so only the PR-text workflows ci.yml lists in
 * PR_TEXT_WORKFLOWS may run on `edited`. It reads the `on:` block as text, so it has to read both ways YAML
 * writes a list of types (PR 109 review round 2: the block list `- edited` went unread).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPO } from './hook-harness';

const SCRIPT = `${REPO}scripts/ci/check-pr-triggers.mjs`;

function check(dir: string, list: string): { status: number | null; stdout: string; stderr: string } {
  return spawnSync('node', [SCRIPT, dir], { encoding: 'utf8', env: { ...env, PR_TEXT_WORKFLOWS: list } });
}

describe('check-pr-triggers.mjs', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pr-triggers-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const workflow = (name: string, on: string): void => {
    writeFileSync(join(dir, name), `name: x\non:\n${on}\njobs:\n  a:\n    runs-on: ubuntu-latest\n`);
  };

  it("passes this repository's workflows with ci.yml's list", () => {
    const list = /^ {10}PR_TEXT_WORKFLOWS: (.+)$/m.exec(readFileSync(`${REPO}.github/workflows/ci.yml`, 'utf8'))?.[1];
    expect(list).toBeDefined();
    const r = check(`${REPO}.github/workflows`, list ?? '');
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('pr triggers ok');
  });

  it.each([
    ['the flow form', '  pull_request:\n    types: [opened, edited, synchronize]'],
    ['a quoted flow item', "  pull_request_target:\n    types: ['opened', \"edited\"]"],
    ['the block form', '  pull_request:\n    types:\n      - opened\n      - edited\n    branches: [main]'],
    ['a quoted block item', '  pull_request_target:\n    types:\n      - "edited"'],
  ])('fails a full check that runs on edited, in %s', (_form, on) => {
    workflow('check.yml', on);
    const r = check(dir, 'text.yml');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("check.yml: pull_request");
    expect(r.stderr).toContain("runs on 'edited'");
  });

  it('passes a listed PR-text workflow on edited, and a full check without it', () => {
    workflow('text.yml', '  pull_request:\n    types:\n      - edited');
    workflow('check.yml', '  pull_request:\n    types:\n      - opened\n      - synchronize');
    workflow('bare.yml', '  pull_request:\n    branches: [main]');
    expect(check(dir, 'text.yml').stdout.trim()).toBe('pr triggers ok');
  });
});
