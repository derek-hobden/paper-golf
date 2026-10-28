// The round counter explainer (issue 92), in the PR Decision Video Standard's order: the verdict,
// why, before, what changes, after, matches the ask, risk, review, undo, and the decision with the
// commit stamp. Before and after are real terminal recordings CI made of the comments, runs and
// checks the spec names (its `// walkthrough-evidence:` lines, in order). One scene at a time, cut
// (scene-cut.ts), one scene per `## How to see it` step, and the spec leaves the scene starts as
// beats.json, so beat mode holds each scene for exactly its own paragraph of voice.
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
  { kind: 'verdict', seconds: 8 },
  {
    kind: 'diagram', seconds: 13, tag: 'WHY', title: 'Two reviews read as round 3',
    rows: ['PR 76 had one changes request and one pass', 'A copied verdict was counted as another round'],
  },
  { kind: 'clip', clip: 0, seconds: 8 },
  { kind: 'clip', clip: 1, seconds: 8 },
  {
    kind: 'diagram', seconds: 14, tag: 'WHAT CHANGES', title: 'One review job, one round',
    rows: ['A commit keeps no more verdicts than review jobs', 'The earliest verdict is the one kept', 'Two real reviews of one commit still count twice'],
  },
  { kind: 'clip', clip: 2, seconds: 8 },
  {
    kind: 'diagram', seconds: 12, tag: 'MATCHES THE ASK', title: 'The ask, point by point',
    rows: ['The bug filed as issue 92', 'Only the round counter changes', "A test built from PR 76's real check runs"],
  },
  {
    kind: 'diagram', seconds: 11, tag: 'RISK', title: 'One script and its test',
    rows: ["Nothing in the game's code changes", 'A wrong count only changes a number in words'],
  },
  { kind: 'clip', clip: 3, seconds: 9 },
  {
    kind: 'diagram', seconds: 11, tag: 'UNDO', title: 'Revert the merge, as a pull request',
    rows: ['A copied verdict counts again', 'Nothing to clean up: no data, no settings'],
  },
  { kind: 'decision', seconds: 8 },
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
        return '- verdict: the fixed verdict sentence, shown as it is said';
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

// The review clip without its headline: the verdict's words are said once, on the verdict scene.
const withoutHeadline = (clip: Clip | undefined): Clip | undefined => (clip === undefined ? undefined : { ...clip, headline: '' });

const sceneHtml = (s: Scene, i: number, clips: readonly Clip[]): string => {
  const open = `<section id="s${String(i)}" class="scene ${s.kind}">`;
  switch (s.kind) {
    case 'verdict':
      return `${open}<p class=tag>VERDICT</p><h1 class=said>${esc(reviewWords(clips))}</h1></section>`;
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
.verdict h1{color:#3a8a55;font-size:38px;line-height:1.3}.stamp{display:inline-block;margin-top:24px;padding:12px 26px;border:3px solid #e3dcc8;border-radius:12px;font:700 24px 'Liberation Mono','DejaVu Sans Mono',monospace}
@keyframes pop{from{opacity:0;transform:translateY(20px)}}
${CLIP_CSS}
</style><body data-scene="0">${SCENES.map((s, i) => sceneHtml(s, i, clips)).join('')}${clipsJson(clips)}<script>${PLAYER}</script>`;
