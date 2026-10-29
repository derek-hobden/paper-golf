// The "steps first, and the link stays" explainer (factory step 2, part 2), in the plain-story order
// (AGENTS.md "Plain words for someone not in the loop"): the opening, why, before, what changes,
// after, matches the ask, risk, review, undo, the decision with the commit stamp, and the review
// result last, in plain words. Before and after are real terminal recordings CI
// made of the pull requests the spec names (its `// walkthrough-evidence:` lines, in order). One
// scene on screen at a time, cut (scene-cut.ts), one scene per `## How to see it` step, and the
// spec leaves the scene starts as beats.json, so beat mode holds each scene for exactly its own
// paragraph of voice.
import { CLIP_CSS, clipsJson, PLAYER } from './evidence-player';
import { type Clip, clipHtml } from './review-first-2-scenes';
import { reviewWords } from './review-first-scenes';
import { sceneCutCss } from './scene-cut';

export type Scene =
  | { readonly kind: 'verdict' }
  | { readonly kind: 'diagram'; readonly tag: string; readonly title: string; readonly rows: readonly string[] }
  | { readonly kind: 'clip'; readonly clip: number }
  | { readonly kind: 'decision' };

/**
 * The scenes, in order, and how long each is filmed. Every word a scene shows is a quoted part of
 * its `## How to see it` step (stepLines), and a diagram's seconds are its words at the
 * narration's 2.2 a second, so the voice has nothing to pad with.
 */
export const SCENES: readonly (Scene & { readonly seconds: number })[] = [
  {
    kind: 'diagram', seconds: 15, tag: 'WHAT THIS IS', title: 'Every pull request now films its own change',
    rows: ['The steps are required, and the video link stays put', 'You decide: approve this change, or ask for changes'],
  },
  {
    kind: 'diagram', seconds: 13, tag: 'WHY', title: 'Before, two gaps in the video',
    rows: ['No steps meant a tour of the app, not this change', 'A hand edit of the body could drop the video link'],
  },
  { kind: 'clip', clip: 0, seconds: 8 },
  {
    kind: 'diagram', seconds: 16, tag: 'WHAT CHANGES', title: 'Steps are required, and the link comes back',
    rows: ['No steps: the video check fails at once, with an example', 'A draft is only warned', 'A dropped link is put back from the shelf'],
  },
  { kind: 'clip', clip: 1, seconds: 8 },
  {
    kind: 'diagram', seconds: 12, tag: 'MATCHES THE ASK', title: 'The brief, point by point',
    rows: ['A missing How to see it section fails fast with an example', 'CI restores a deleted video link'],
  },
  {
    kind: 'diagram', seconds: 12, tag: 'RISK', title: 'Pipeline, docs and walkthrough only',
    rows: ["Nothing in the game's code changes", 'Only a video CI made is put back, never bought'],
  },
  { kind: 'clip', clip: 2, seconds: 9 },
  {
    kind: 'diagram', seconds: 11, tag: 'UNDO', title: 'Revert the merge, as a pull request',
    rows: ['No steps goes back to a tour of the app', 'Nothing to clean up: no data, no settings'],
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
        return `- recorded live: ${q(captions[s.clip] ?? '')}`;
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
      return `${open}${clipHtml(withoutHeadline(clips[s.clip]), s.clip)}</section>`;
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
.tag{color:#3e70b8;font-size:22px;letter-spacing:.14em;margin:0 0 10px}h1{font-size:44px;margin:0 0 26px}
.row{display:flex;justify-content:center;gap:24px;margin:18px 0}
.row b{padding:18px 22px;border-radius:14px;background:#3e70b8;color:#fff;animation:pop .5s calc(.3s + .35s*var(--d,0)) both}
.row b.G{background:#3a8a55}.row b.K{background:#8a93a3}
.verdict h1{color:#3a8a55;font-size:34px;line-height:1.3}.stamp{display:inline-block;margin-top:24px;padding:12px 26px;border:3px solid #e3dcc8;border-radius:12px;font:700 24px 'Liberation Mono','DejaVu Sans Mono',monospace}
@keyframes pop{from{opacity:0;transform:translateY(20px)}}
${CLIP_CSS}
</style><body data-scene="0">${SCENES.map((s, i) => sceneHtml(s, i, clips)).join('')}${clipsJson(clips)}<script>${PLAYER}</script>`;
