// The "Opus reviewer" explainer: the code review moves to Claude Opus 5.5 at high effort, the
// rules lose their leftover "verdict" wording, and the three older walkthroughs open on the plain
// story. In the plain-story order (AGENTS.md "Plain words for someone not in the loop"): the
// opening, before, what changes, after, risk, the decision with the commit stamp, and the review
// result last, in plain words. The after is a real terminal recording CI made (the spec's
// `// walkthrough-evidence:` lines). One scene on screen at a time, cut (scene-cut.ts), one scene
// per `## How to see it` step, and the spec leaves the scene starts as beats.json for beat mode.
import { CLIP_CSS, clipsJson, PLAYER } from './evidence-player';
import { type Clip, clipHtml } from './review-first-2-scenes';
import { reviewWords } from './review-first-scenes';
import { sceneCutCss } from './scene-cut';

export type Scene =
  | { readonly kind: 'diagram'; readonly tag: string; readonly title: string; readonly rows: readonly string[] }
  | { readonly kind: 'clip'; readonly clip: number }
  | { readonly kind: 'decision' }
  | { readonly kind: 'review' };

/**
 * The scenes, in order, and how long each is filmed. Every word a scene shows is a quoted part of
 * its `## How to see it` step (stepLines), and a diagram's seconds are its words at the
 * narration's 2.2 a second, so the voice has nothing to pad with. The opening is the first 15 s.
 */
export const SCENES: readonly (Scene & { readonly seconds: number })[] = [
  {
    kind: 'diagram', seconds: 15, tag: 'WHAT THIS IS', title: 'The automatic code review moves to Claude Opus 5.5',
    rows: ['It reads every change before a person approves it', 'You decide: approve this change, or ask for changes'],
  },
  {
    kind: 'diagram', seconds: 11, tag: 'BEFORE', title: 'Before, the review ran on Claude Sonnet 5.5',
    rows: ['At its default thinking effort', 'Older videos opened on the review result'],
  },
  {
    kind: 'diagram', seconds: 14, tag: 'WHAT CHANGES', title: 'Three small changes',
    rows: ['The review runs on Claude Opus 5.5, thinking hard', 'The rules now say review result, in plain words', 'Older walkthroughs open on the plain story'],
  },
  { kind: 'clip', clip: 0, seconds: 9 },
  {
    kind: 'diagram', seconds: 10, tag: 'RISK', title: 'Pipeline, docs and walkthroughs only',
    rows: ["Nothing in the game's code changes", 'Each review costs more than before'],
  },
  { kind: 'decision', seconds: 8 },
  { kind: 'review', seconds: 10 },
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
      case 'diagram':
        return `- ${s.tag.toLowerCase()}: ${[s.title, ...s.rows].map(q).join(', ')}`;
      case 'clip':
        return `- recorded live: ${q(captions[s.clip] ?? '')}`;
      case 'decision':
        return `- decision: ${[DECISION.title, DECISION.approve, DECISION.change].map(q).join(', ')}, stamped with the commit`;
      case 'review':
        return '- review result: the fixed review result, shown as it is said';
    }
  });

/** The total the recording runs. */
export const RECORDING_SECONDS = SCENES.reduce((a, s) => a + s.seconds, 0);

/** Where the decision scene's commit stamp goes: the spec fills it in when it films. */
export const STAMP_ID = 'stamp';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`);

const sceneHtml = (s: Scene, i: number, clips: readonly Clip[]): string => {
  const open = `<section id="s${String(i)}" class="scene ${s.kind}">`;
  switch (s.kind) {
    case 'diagram':
      return `${open}<p class=tag>${esc(s.tag)}</p><h1>${esc(s.title)}</h1>${s.rows
        .map((r, k) => `<div class=row><b style=--d:${String(k)}>${esc(r)}</b></div>`)
        .join('')}</section>`;
    case 'clip':
      return `${open}${clipHtml(clips[s.clip], s.clip)}</section>`;
    case 'decision':
      return `${open}<p class=tag>DECISION</p><h1>${esc(DECISION.title)}</h1>
<div class=row><b class=G>${esc(DECISION.approve)}</b><b class=K>${esc(DECISION.change)}</b></div>
<p class=stamp id="${STAMP_ID}">commit ·······</p></section>`;
    case 'review':
      // The review's own counts reach the page through its evidence line, so the words on screen
      // are the plain paragraph the narration says last (pr-video-script.sh).
      return `${open}<p class=tag>REVIEW RESULT</p><h1 class=said>${esc(reviewWords(clips))}</h1></section>`;
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
.review h1{color:#3a8a55;font-size:34px;line-height:1.3}.stamp{display:inline-block;margin-top:24px;padding:12px 26px;border:3px solid #e3dcc8;border-radius:12px;font:700 24px 'Liberation Mono','DejaVu Sans Mono',monospace}
@keyframes pop{from{opacity:0;transform:translateY(20px)}}
${CLIP_CSS}
</style><body data-scene="0">${SCENES.map((s, i) => sceneHtml(s, i, clips)).join('')}${clipsJson(clips)}<script>${PLAYER}</script>`;
