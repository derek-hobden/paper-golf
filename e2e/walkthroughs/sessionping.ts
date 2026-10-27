/**
 * What session-ping.spec.ts films, from the pull request's diff and the walkthroughs
 * checked in next to it.
 *
 * scripts/ship/pr-video-record.sh films every `*.spec.ts` here but default.spec.ts,
 * and falls back to default.spec.ts only when there is none. So once this spec is on
 * main it is filmed for every later pull request, and it must not change what any of
 * them gets: it films the session ping explainer only for a diff that touches the
 * hook, says nothing when another pull request has checked in its own walkthrough
 * (the recorder films that one, as it would without this file), and otherwise films
 * exactly what default.spec.ts would.
 */

export const SESSION_PING_SCRIPT = 'scripts/factory/session-ping.sh';
export const SESSION_PING_SPEC = 'session-ping.spec.ts';
const DEFAULT_SPEC = 'default.spec.ts';

/** explainer: the session ping scenes. default: default.spec.ts's walkthrough. none: film nothing. */
export type SessionPingFilm = 'explainer' | 'default' | 'none';

/**
 * @param files the paths the pull request's diff touches (PR_FILES)
 * @param specs the file names in e2e/walkthroughs/
 */
export function sessionPingFilm(files: readonly string[], specs: readonly string[]): SessionPingFilm {
  const others = specs.filter((f) => f.endsWith('.spec.ts') && f !== DEFAULT_SPEC && f !== SESSION_PING_SPEC);
  if (others.length > 0) return 'none';
  return files.includes(SESSION_PING_SCRIPT) ? 'explainer' : 'default';
}
