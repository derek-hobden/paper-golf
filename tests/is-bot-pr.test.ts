/**
 * scripts/ci/is-bot-pr.sh: the one bot-PR filter the bot pings share (bot-ping-pr-check-failed.yml and the
 * GitHub-event pings). A PR is a bot's when its author is one of the bot logins (BOT_LOGINS, comma- or
 * space-separated, and the older BOT_AUTHORS) or its head branch starts with one of BOT_BRANCH_PREFIXES;
 * exit 0 for a bot PR, 1 otherwise, nothing printed. Ported from the fleet template (RuckBee PR 476).
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IS_BOT_PR, readWorkflow, useStubs, workflowEnv } from './bot-ping-harness';
import { REPO } from './hook-harness';

// Paper Golf's config, as every bot-ping-*.yml sets it.
const CONFIG = {
  BOT_AUTHORS: 'golf-gus-bot[bot]',
  BOT_BRANCH_PREFIXES: 'claude/',
};

describe('is-bot-pr.sh', () => {
  const t = useStubs();
  const isBot = (author: string, branch: string, env: Record<string, string> = CONFIG, cwd = REPO) =>
    t.sh([IS_BOT_PR, author, branch], env, cwd);

  it('is tested with the config the workflows set', () => {
    expect(workflowEnv(readWorkflow('bot-ping-pr-check-failed.yml'))).toMatchObject(CONFIG);
  });

  it('is a bot PR when the author is the bot login, on any branch', () => {
    for (const branch of ['feature/x', 'fix-standings', '']) {
      const r = isBot('golf-gus-bot[bot]', branch);
      expect(r.status, branch).toBe(0);
      expect(r.stdout + r.stderr).toBe('');
    }
  });

  it('is a bot PR when the branch has a bot prefix, whoever opened it', () => {
    expect(isBot('human-dev', 'claude/bot-gh-event-pings').status).toBe(0);
    expect(isBot('derek-hobden', 'claude/no-prompts-bot-pings-kyj6xm').status).toBe(0);
    expect(isBot('', 'claude/x').status).toBe(0);
    expect(isBot('human-dev', 'codex/x', { ...CONFIG, BOT_BRANCH_PREFIXES: 'claude/ codex/' }).status).toBe(0);
  });

  it('is not a bot PR otherwise', () => {
    for (const [author, branch] of [
      ['human-dev', 'feature/x'],
      ['human-dev', 'stuart/claude/x'],
      ['human-dev', 'claude'],
      // Cloud sessions open pull requests as derek-hobden: his login is never a bot's, only the branch is.
      ['derek-hobden', 'feature/x'],
      ['golf-gus-bot', 'feature/x'],
      ['golf-gus-bot-2', 'feature/x'],
      ['dependabot[bot]', 'dependabot/npm_and_yarn/x'],
      ['', ''],
    ] as const) {
      const r = isBot(author, branch);
      expect(r.status, `${author} ${branch}`).toBe(1);
      expect(r.stdout + r.stderr).toBe('');
    }
    const none = { BOT_AUTHORS: '', BOT_BRANCH_PREFIXES: '' };
    expect(isBot('golf-gus-bot[bot]', 'claude/x', none).status).toBe(1);
    expect(t.sh([IS_BOT_PR], {}).status).toBe(1);
  });

  it('reads BOT_LOGINS, comma- or space-separated, beside BOT_AUTHORS', () => {
    const logins = { BOT_LOGINS: 'a-bot,golf-gus-bot[bot] other-bot', BOT_BRANCH_PREFIXES: '' };
    for (const author of ['a-bot', 'golf-gus-bot[bot]', 'other-bot']) {
      expect(isBot(author, 'feature/x', logins).status, author).toBe(0);
    }
    expect(isBot('golf-gus-bot', 'feature/x', logins).status).toBe(1);
    expect(isBot('x-bot', 'feature/x', { ...logins, BOT_AUTHORS: 'x-bot' }).status).toBe(0);
  });

  it('matches the claude/ prefix when BOT_BRANCH_PREFIXES is unset, and nothing when it is empty', () => {
    expect(isBot('human-dev', 'claude/x', { BOT_AUTHORS: '' }).status).toBe(0);
    expect(isBot('human-dev', 'claude/x', { BOT_AUTHORS: '', BOT_BRANCH_PREFIXES: '' }).status).toBe(1);
  });

  it('never globs: a [bot] login matches only itself, even next to a matching file', () => {
    writeFileSync(join(t.dir(), 'golf-gus-botb'), '');
    expect(isBot('golf-gus-bot[bot]', 'feature/x', CONFIG, t.dir()).status).toBe(0);
    expect(isBot('golf-gus-botb', 'feature/x', CONFIG, t.dir()).status).toBe(1);
    writeFileSync(join(t.dir(), 'claudeX'), '');
    const globby = { ...CONFIG, BOT_BRANCH_PREFIXES: 'claude?' };
    expect(isBot('human-dev', 'claudeX', globby, t.dir()).status).toBe(1);
    expect(isBot('human-dev', 'claude?/x', globby, t.dir()).status).toBe(0);
  });
});
