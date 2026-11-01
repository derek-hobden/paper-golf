/**
 * Tests for scripts/claude-hooks/pre-push-scan.sh, the PreToolUse (Bash) secret scan before a push.
 *
 * Git runs husky's hooks only once `npm install` has set core.hooksPath, a fresh Claude cloud container
 * starts without it, and Paper Golf's husky has no pre-push hook at all, so a session could push a secret
 * with nothing scanning it. The hook runs the scan (secretProblems, scripts/claude-hooks/push-guards.mjs)
 * over origin/main..HEAD before any Bash command that pushes, and blocks (exit 2) on a hit. Ported from
 * the fleet template (RuckBee PR 473).
 *
 * Exercised as a black box against throwaway repos with a bare `origin`. The fake secrets are assembled
 * at run time so this file never holds one.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanEnv, git, REPO } from './hook-harness';

const HOOK = `${REPO}scripts/claude-hooks/pre-push-scan.sh`;
const FAKE_GITHUB_TOKEN = 'ghp_' + 'Zq7X'.repeat(9);
const FAKE_AWS_KEY = 'AKIA' + 'ZQXJ'.repeat(4);
const FAKE_ANTHROPIC_KEY = 'sk-' + 'ant-' + 'api03-' + 'Zq7X'.repeat(8);
const FAKE_PRIVATE_KEY = '-----' + 'BEGIN OPENSSH PRIVATE KEY' + '-----';
// AWS's own documentation key, which every scanner lets through.
const AWS_DOCS_KEY = 'AKIA' + 'IOSFODNN7' + 'EXAMPLE';

function scan(command: string, cwd: string): { code: number | null; stderr: string } {
  const r = spawnSync('bash', [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }),
    env: cleanEnv(),
  });
  return { code: r.status, stderr: r.stderr };
}

describe('pre-push-scan hook', () => {
  let root = '';
  let work = '';
  let noRemote = '';

  /** A branch off main with one commit adding `file` with `text`. */
  function branchWith(branch: string, file: string, text: string): void {
    git(work, 'checkout', '-q', '-B', branch, 'main');
    writeFileSync(join(work, file), `${text}\n`);
    git(work, 'add', file);
    git(work, 'commit', '-q', '-m', `add ${file}`);
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'pre-push-scan-'));
    const origin = join(root, 'origin.git');
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8', env: cleanEnv() });
    work = join(root, 'work');
    execFileSync('git', ['clone', '-q', origin, work], { encoding: 'utf8', env: cleanEnv(), stdio: 'pipe' });
    git(work, 'config', 'user.email', 't@t.dev');
    git(work, 'config', 'user.name', 'Test');
    git(work, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(work, 'README.md'), 'hello\n');
    git(work, 'add', 'README.md');
    git(work, 'commit', '-q', '-m', 'init');
    git(work, 'push', '-q', '-u', 'origin', 'main');

    noRemote = join(root, 'no-remote');
    execFileSync('git', ['init', '-q', '-b', 'main', noRemote], { encoding: 'utf8', env: cleanEnv() });
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('passes a clean commit', () => {
    branchWith('clean', 'notes.txt', 'nothing to see here');
    expect(scan('git push -u origin clean', work)).toEqual({ code: 0, stderr: '' });
  });

  it('blocks a commit carrying a GitHub token', () => {
    branchWith('gh-token', 'token.txt', `token = ${FAKE_GITHUB_TOKEN}`);
    const { code, stderr } = scan('git push -u origin gh-token', work);
    expect(code).toBe(2);
    expect(stderr).toContain('token.txt:1 looks like a GitHub token.');
  });

  it('blocks a commit carrying an AWS access key', () => {
    branchWith('aws-key', 'aws.txt', `aws_access_key_id = ${FAKE_AWS_KEY}`);
    const { code, stderr } = scan('git push origin HEAD:aws-key', work);
    expect(code).toBe(2);
    expect(stderr).toContain('aws.txt:1 looks like an AWS access key.');
  });

  it('blocks an Anthropic key and a private key, naming the line each is on', () => {
    branchWith('keys', 'keys.txt', `first line\nANTHROPIC_API_KEY=${FAKE_ANTHROPIC_KEY}\n${FAKE_PRIVATE_KEY}`);
    const { code, stderr } = scan('git push -u origin keys', work);
    expect(code).toBe(2);
    expect(stderr).toContain('keys.txt:2 looks like an Anthropic API key.');
    expect(stderr).toContain('keys.txt:3 looks like a private key.');
  });

  it("lets AWS's documentation example key through", () => {
    branchWith('aws-docs', 'docs.md', `For example ${AWS_DOCS_KEY}.`);
    expect(scan('git push -u origin aws-docs', work).code).toBe(0);
  });

  it('scans the checkout `git -C` names, wherever the session is', () => {
    branchWith('gh-token-c', 'token.txt', `token = ${FAKE_GITHUB_TOKEN}`);
    expect(scan(`git -C ${work} push -u origin gh-token-c`, root).code).toBe(2);
  });

  it('leaves commands that do not push alone', () => {
    branchWith('gh-token-2', 'token.txt', `token = ${FAKE_GITHUB_TOKEN}`);
    expect(scan('git status && git log -1', work)).toEqual({ code: 0, stderr: '' });
  });

  it('fails soft where it cannot tell (no origin/main)', () => {
    expect(scan('git push', noRemote).code).toBe(0);
  });
});
