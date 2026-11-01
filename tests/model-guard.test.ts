import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Every Claude Code session here runs on Opus 5.5 at low effort (Derek, 1 Nov 2026: "I want all Claude code
 * sessions from now on to be opus 5.5 ... reliably 100% of the time", then at 22:59 Dubai "opus 5.5 low for
 * everything please", which replaced high). `.claude/settings.json` pins the
 * model and the effort four ways, and a SessionStart hook (`.claude/hooks/check-model-effort.sh`) warns and
 * pings the owning bot when a session starts on anything else. CI's own Claude calls are not sessions: the
 * review and the narration stay on Sonnet 5.5 (Derek, 1 Nov 2026, cost), and no workflow runs the claude CLI.
 */

const SETTINGS = '.claude/settings.json';
const HOOK = '.claude/hooks/check-model-effort.sh';
const HOOK_COMMAND = 'bash "$CLAUDE_PROJECT_DIR/.claude/hooks/check-model-effort.sh"';

const settings: unknown = JSON.parse(readFileSync(SETTINGS, 'utf8'));

/** `obj[key]` when `obj` is a plain object, else undefined. */
function field(obj: unknown, key: string): unknown {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return undefined;
  return new Map<string, unknown>(Object.entries(obj)).get(key);
}

/** Every hook command registered for `event`. */
function commands(event: string): unknown[] {
  const groups = field(field(settings, 'hooks'), event);
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group: unknown) => {
    const hooks = field(group, 'hooks');
    return Array.isArray(hooks) ? hooks.map((h: unknown) => field(h, 'command')) : [];
  });
}

/**
 * Runs the hook with `input` on stdin and a clean environment: PATH, CLAUDE_PROJECT_DIR (the repo) and the
 * `NAME=value` pairs given, so the session's own CLAUDE_EFFORT or ANTHROPIC_MODEL never leaks in.
 */
function runHook(input: string, ...env: string[]) {
  const script = `in="$1"; shift; printf '%s' "$in" | env -i PATH="$PATH" CLAUDE_PROJECT_DIR="$PWD" "$@" bash ${HOOK}`;
  return spawnSync('bash', ['-c', script, 'guard', input, ...env], { encoding: 'utf8' });
}

describe('Claude Code sessions are pinned to Opus 5.5 at low effort', () => {
  it('pins the model, the effort, the per-model effort and the effort env', () => {
    expect(settings).toMatchObject({
      model: 'claude-opus-5-5',
      effortLevel: 'low',
      modelSettings: { 'claude-opus-5-5': { effortLevel: 'low' } },
      env: { CLAUDE_CODE_EFFORT_LEVEL: 'low' },
    });
  });

  it('names no other effort anywhere in the settings', () => {
    const text = readFileSync(SETTINGS, 'utf8');
    expect(text).not.toMatch(/"(high|medium|xhigh|max)"/);
  });

  it('runs the model guard on SessionStart', () => {
    expect(commands('SessionStart')).toContain(HOOK_COMMAND);
  });

  it('the guard is an executable script', () => {
    const r = spawnSync('test', ['-x', HOOK], { encoding: 'utf8' });
    expect(r.status).toBe(0);
  });

  it('the guard says nothing on Opus 5.5 at low effort', () => {
    const r = runHook(JSON.stringify({ hook_event_name: 'SessionStart', model: 'claude-opus-5-5' }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('the guard reads the effort from the settings when the env has none', () => {
    const r = runHook(JSON.stringify({ model: 'claude-opus-5-5[1m]' }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('the guard warns on another model, and never fails the session', () => {
    const r = runHook(JSON.stringify({ model: 'claude-sonnet-5-5' }));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('MODEL DRIFT: model is claude-sonnet-5-5 (want claude-opus-5-5)');
    const out: unknown = JSON.parse(r.stdout);
    expect(out).toMatchObject({ hookSpecificOutput: { hookEventName: 'SessionStart' } });
    expect(String(field(field(out, 'hookSpecificOutput'), 'additionalContext'))).toContain(
      '--model claude-opus-5-5 --effort low',
    );
  });

  it('the guard warns on another effort', () => {
    const r = runHook(JSON.stringify({ model: 'claude-opus-5-5' }), 'CLAUDE_EFFORT=medium');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('effort is medium (want low)');
  });

  it('the guard warns on high, the effort low replaced', () => {
    const r = runHook(JSON.stringify({ model: 'claude-opus-5-5' }), 'CLAUDE_CODE_EFFORT_LEVEL=high');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('effort is high (want low)');
  });

  it('the guard survives input that is not JSON', () => {
    const r = runHook('not json', 'CLAUDE_CODE_EFFORT_LEVEL=low');
    expect(r.status).toBe(0);
    // The model then comes from the settings, which pin Opus 5.5.
    expect(r.stdout).toBe('');
  });
});

describe("CI's Claude calls stay on Sonnet 5.5", () => {
  it('the review is pinned to claude-sonnet-5-5', () => {
    const src = readFileSync('scripts/claude-review.mjs', 'utf8');
    expect(src).toContain("export const MODEL = 'claude-sonnet-5-5';");
    expect(src).not.toContain('claude-opus');
  });

  it('the narration is pinned to claude-sonnet-5-5', () => {
    const src = readFileSync('scripts/ship/pr-video-script.sh', 'utf8');
    expect(src).toContain('MODEL="claude-sonnet-5-5"');
    expect(src).not.toMatch(/MODEL="claude-opus/);
  });

  it('no workflow runs the claude CLI or the Claude Code action', () => {
    const dir = '.github/workflows';
    for (const name of readdirSync(dir)) {
      const text = readFileSync(`${dir}/${name}`, 'utf8');
      expect(text, name).not.toMatch(/claude-code-action|@anthropic-ai\/claude-code|^\s*(run:\s*)?claude\s+(-p|--)/m);
      expect(text, name).not.toContain('claude-opus');
    }
  });
});
