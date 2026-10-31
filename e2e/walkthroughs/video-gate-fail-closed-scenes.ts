// The "video gate fails closed" explainer (Derek, 31 Oct 2026), in the plain-story order (AGENTS.md
// "Plain words for someone not in the loop"): what this is and what to decide, why, the evidence
// before, what changes, the evidence after, matches the ask, risk, review, undo, the decision with
// the commit stamp, and the review result last, in plain words. Before and after are real terminal
// recordings CI made (the spec's `// walkthrough-evidence:` lines, in order): Dependabot's pull
// request 101 passing the video check with no video, then this pull request's own test cases, each
// saying what it proved. One scene on screen at a time, cut (scene-cut.ts), one scene per
// `## How to see it` step, and the spec leaves the scene starts as beats.json for beat mode.
import { CLIP_CSS, clipsJson, PLAYER } from './evidence-player';
import { type Clip, clipHtml } from './review-first-2-scenes';
import { reviewWords } from './review-first-scenes';
import { sceneCutCss } from './scene-cut';

export type Scene =
  | { readonly kind: 'verdict' }
  | { readonly kind: 'diagram'; readonly tag: string; readonly title: string; readonly rows: readonly string[] }
  | { readonly kind: 'clip'; readonly clip: number; readonly proves?: string }
  | { readonly kind: 'decision' };

/**
 * The scenes, in order, and how long each is filmed. Every word a diagram shows is a quoted part of
 * its `## How to see it` step (stepLines), and a clip's step quotes its caption and what its test
 * case proves (the `proves "..."` line test-ship.sh prints), so the narration says them.
 */
export const SCENES: readonly (Scene & { readonly seconds: number })[] = [
  {
    kind: 'diagram', seconds: 15, tag: 'WHAT THIS IS', title: 'No pull request merges without its video',
    rows: ['A dependency update gets its explainer video from CI, like every other change', 'You decide: approve this change, or ask for changes'],
  },
  {
    kind: 'diagram', seconds: 12, tag: 'WHY', title: 'Before, some pull requests passed with no video',
    rows: ['Dependabot and Renovate were let through', 'A draft passed the check too'],
  },
  { kind: 'clip', clip: 0, seconds: 8 },
  {
    kind: 'diagram', seconds: 15, tag: 'WHAT CHANGES', title: 'No video fails the check, and CI makes the missing one',
    rows: ['Every author needs the video, a draft included', 'For a dependency update, main films it from the diff', 'Then the Kore voice, and the link on top'],
  },
  { kind: 'clip', clip: 1, seconds: 9, proves: 'A Dependabot pull request with no video fails the check' },
  { kind: 'clip', clip: 2, seconds: 9, proves: 'With its video on top, the check passes' },
  { kind: 'clip', clip: 3, seconds: 9, proves: "Only main's copy runs, and the pull request is only data" },
  {
    kind: 'diagram', seconds: 12, tag: 'MATCHES THE ASK', title: 'The brief, point by point',
    rows: ['A missing video fails, always', "Main's copy makes the video", 'The result is said last'],
  },
  {
    kind: 'diagram', seconds: 11, tag: 'RISK', title: 'Pipeline, docs and walkthrough only',
    rows: ["Nothing in the game's code changes", 'A dependency update now waits for its video'],
  },
  { kind: 'clip', clip: 4, seconds: 9 },
  {
    kind: 'diagram', seconds: 11, tag: 'UNDO', title: 'Revert the merge, as a pull request',
    rows: ['The old exemption comes back', 'Nothing to clean up: no data, no settings'],
  },
  { kind: 'decision', seconds: 8 },
  { kind: 'verdict', seconds: 10 },
];

/** The decision scene's words, all of them said. */
export const DECISION = { title: 'Yours to approve', approve: 'Approve: add the approved label', change: 'Or ask for changes' } as const;

/**
 * The `## How to see it` steps, one per scene, quoting every word each scene shows. A clip's
 * caption is its `walkthrough-evidence` line's, passed in from the spec.
 */
export const stepLines = (captions: readonly string[]): string[] =>
  SCENES.map((s) => {
    const q = (t: string): string => `"${t}"`;
    switch (s.kind) {
      case 'verdict':
        return '- review result: the fixed review result, shown as it is said';
      case 'diagram':
        return `- ${s.tag.toLowerCase()}: ${[s.title, ...s.rows].map(q).join(', ')}`;
      case 'clip':
        return `- recorded live: ${q(captions[s.clip] ?? '')}${s.proves === undefined ? '' : `, which proves ${q(s.proves)}`}`;
      case 'decision':
        return `- decision: ${[DECISION.title, DECISION.approve, DECISION.change].map(q).join(', ')}, stamped with the commit`;
    }
  });

/** The total the recording runs. */
export const RECORDING_SECONDS = SCENES.reduce((a, s) => a + s.seconds, 0);

/** Where the decision scene's commit stamp goes: the spec fills it in when it films. */
export const STAMP_ID = 'stamp';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`);

// The review clip without its headline: the review result is said once, on its own last scene.
const withoutHeadline = (clip: Clip | undefined): Clip | undefined => (clip === undefined ? undefined : { ...clip, headline: '' });

const sceneHtml = (s: Scene, i: number, clips: readonly Clip[]): string => {
  const open = `<section id="s${String(i)}" class="scene ${s.kind}">`;
  switch (s.kind) {
    case 'verdict':
      return `${open}<p class=tag>REVIEW RESULT</p><h1 class=said>${esc(reviewWords(clips))}</h1></section>`;
    case 'diagram':
      return `${open}<p class=tag>${esc(s.tag)}</p><h1>${esc(s.title)}</h1>${s.rows
        .map((r, k) => `<div class=row><b style=--d:${String(k)}>${esc(r)}</b></div>`)
        .join('')}</section>`;
    case 'clip':
      return `${open}${clipHtml(withoutHeadline(clips[s.clip]), s.clip)}${
        s.proves === undefined ? '' : `<p class=proves>${esc(s.proves)}</p>`
      }</section>`;
    case 'decision':
      return `${open}<p class=tag>DECISION</p><h1>${esc(DECISION.title)}</h1>
<div class=row><b class=G>${esc(DECISION.approve)}</b><b class=K>${esc(DECISION.change)}</b></div>
<p class=stamp id="${STAMP_ID}">commit ·······</p></section>`;
  }
};

export const pageHtml = (clips: readonly Clip[]): string => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:720px;display:grid;place-items:center;background:#fdfbf4;font:600 22px Arial,sans-serif;color:#23324a;overflow:hidden}
.scene{max-width:1088px;max-height:612px;box-sizing:border-box;text-align:center}
${sceneCutCss(SCENES.length)}
.tag{color:#3e70b8;font-size:22px;letter-spacing:.14em;margin:0 0 10px}h1{font-size:42px;margin:0 0 26px}
.row{display:flex;justify-content:center;gap:24px;margin:18px 0}
.row b{padding:18px 22px;border-radius:14px;background:#3e70b8;color:#fff;animation:pop .5s calc(.3s + .35s*var(--d,0)) both}
.row b.G{background:#3a8a55}.row b.K{background:#8a93a3}
.proves{display:inline-block;margin:12px 0 0;padding:10px 18px;border-radius:12px;background:#3a8a55;color:#fff;animation:pop .5s 1.2s both}
.verdict h1{color:#3a8a55;font-size:34px;line-height:1.3}.stamp{display:inline-block;margin-top:24px;padding:12px 26px;border:3px solid #e3dcc8;border-radius:12px;font:700 24px 'Liberation Mono','DejaVu Sans Mono',monospace}
@keyframes pop{from{opacity:0;transform:translateY(20px)}}
${CLIP_CSS}
</style><body data-scene="0">${SCENES.map((s, i) => sceneHtml(s, i, clips)).join('')}${clipsJson(clips)}<script>${PLAYER}</script>`;
