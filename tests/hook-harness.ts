/**
 * Shared plumbing for the tests of the Claude Code hooks and the bot pings
 * (tests/claude-no-prompts.test.ts, tests/bot-ping-*.test.ts, tests/pre-push-scan.test.ts).
 * The fleet template's tests (RuckBee PR 473) import these three from a hook-harness of their own.
 */

import { execFileSync } from 'node:child_process';
import { env } from 'node:process';

/** The repository root, with a trailing slash: the tests name files as `${REPO}scripts/...`. */
export const REPO = decodeURIComponent(new URL('../', import.meta.url).pathname);

/**
 * The caller's environment without git's own variables. Run from a git hook (husky's pre-commit runs
 * lint-staged, a pre-push could run the tests), GIT_DIR and GIT_INDEX_FILE would point every git
 * command in a throwaway repository back at this one.
 */
export function cleanEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('GIT_')) out[key] = value;
  }
  return out;
}

/** `git -C dir ...args`, its output trimmed; throws when git fails. */
export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    env: cleanEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
