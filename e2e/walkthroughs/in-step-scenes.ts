// The video maker's fixes, explained in the PR Decision Video Standard's order: the verdict,
// why, before, what changes, after, matches the ask, risk, review, undo, and the decision
// with the commit stamp. Before and after are real terminal recordings CI made of the runs
// and comments they name (the `// walkthrough-evidence:` lines in the spec, in order), not
// drawings. One scene on screen at a time, cut (scene-cut.ts), one scene per `## How to see
// it` step, and the spec leaves the scene starts as beats.json for beat mode.
import { CLIP_CSS, clipsJson, PLAYER } from './evidence-player';
import { type Clip, clipHtml } from './review-first-2-scenes';
import { sceneCutCss } from './scene-cut';

export type Scene =
  | { readonly kind: 'verdict' }
  | { readonly kind: 'diagram'; readonly tag: string; readonly title: string; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'clip'; readonly clip: number }
  | { readonly kind: 'decision' };

/** The scenes, in order, and how long each is held. */
export const SCENES: readonly (Scene & { readonly seconds: number })[] = [
  { kind: 'verdict', seconds: 7 },
  {
    kind: 'diagram', seconds: 10, tag: 'WHY', title: 'The video did not match its own voice',
    rows: [['Pictures ran seconds ahead of the words'], ['Old scenes left on screen under new ones'], ['The narration said round 1 after a round asked for changes']],
  },
  { kind: 'clip', clip: 0, seconds: 8 },
  { kind: 'clip', clip: 1, seconds: 8 },
  { kind: 'clip', clip: 2, seconds: 8 },
  {
    kind: 'diagram', seconds: 11, tag: 'WHAT CHANGES', title: 'The video maker puts each scene on its own words',
    rows: [['One paragraph per scene', 'Each voiced on its own', 'Each scene held for its paragraph'], ['Verdict first', 'Every review run counted', 'One scene at a time, cut']],
  },
  { kind: 'clip', clip: 3, seconds: 8 },
  { kind: 'clip', clip: 4, seconds: 8 },
  {
    kind: 'diagram', seconds: 10, tag: 'MATCHES THE ASK', title: "Gus's notes and Flo's list",
    rows: [['Each scene fully clears the one before'], ['Scenes timed from the real voice, per paragraph'], ['The verdict first, with why and undo beats'], ['Real recordings of the pull request and its runs'], ['The real round number']],
  },
  {
    kind: 'diagram', seconds: 8, tag: 'RISK', title: 'Pipeline only: every later video is made this way',
    rows: [['A walkthrough without scene starts is made exactly as before'], ['Scene starts that do not fit are reported and ignored']],
  },
  { kind: 'clip', clip: 5, seconds: 9 },
  {
    kind: 'diagram', seconds: 7, tag: 'UNDO', title: 'Revert the merge, as a pull request',
    rows: [['Videos are made as before'], ['Nothing to clean up: no data, no settings']],
  },
  { kind: 'decision', seconds: 30 },
];

/** The total the recording runs. */
export const RECORDING_SECONDS = SCENES.reduce((a, s) => a + s.seconds, 0);

/** Where the decision scene's commit stamp goes: the spec fills it in when it films. */
export const STAMP_ID = 'stamp';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`);

/** The review clip's own words, when CI recorded it: the real round and counts. */
const reviewWords = (clips: readonly Clip[]): string =>
  clips.find((c) => c.command.includes('review-findings.sh'))?.headline ?? 'The Claude review passed';

const sceneHtml = (s: Scene, i: number, clips: readonly Clip[]): string => {
  const open = `<section id="s${String(i)}" class="scene ${s.kind}">`;
  switch (s.kind) {
    case 'verdict':
      return `${open}<p class=tag>VERDICT</p><h1>${esc(reviewWords(clips))}</h1><p class=sub>Ready for a person to approve</p></section>`;
    case 'diagram':
      return `${open}<p class=tag>${esc(s.tag)}</p><h1>${esc(s.title)}</h1>${s.rows
        .map((r) => `<div class=row>${r.map((b, k) => `<b style=--d:${String(k)}>${esc(b)}</b>`).join('')}</div>`)
        .join('')}</section>`;
    case 'clip':
      return `${open}${clipHtml(clips[s.clip], s.clip)}</section>`;
    case 'decision':
      return `${open}<p class=tag>DECISION</p><h1>Yours to approve</h1><p class=sub>${esc(reviewWords(clips))}</p>
<div class=row><b class=G>Approve: add approved</b><b class=K>Or ask for changes</b></div>
<p class=stamp id="${STAMP_ID}">commit ·······</p></section>`;
  }
};

export const pageHtml = (clips: readonly Clip[]): string => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:720px;display:grid;place-items:center;background:#fdfbf4;font:600 22px Arial,sans-serif;color:#23324a;overflow:hidden}
.scene{max-width:1088px;max-height:612px;box-sizing:border-box;text-align:center}
${sceneCutCss(SCENES.length)}
.tag{color:#3e70b8;font-size:22px;letter-spacing:.14em;margin:0 0 10px}h1{font-size:44px;margin:0 0 26px}.sub{color:#5b6676;font-size:26px;margin:0 0 22px}
.row{display:flex;justify-content:center;gap:24px;margin:18px 0}
.row b{padding:18px 22px;border-radius:14px;background:#3e70b8;color:#fff;animation:pop .5s calc(.3s + .35s*var(--d,0)) both}
.row b.G{background:#3a8a55}.row b.K{background:#8a93a3}
.verdict h1{color:#3a8a55}.stamp{display:inline-block;margin-top:24px;padding:12px 26px;border:3px solid #e3dcc8;border-radius:12px;font:700 24px 'Liberation Mono','DejaVu Sans Mono',monospace}
@keyframes pop{from{opacity:0;transform:translateY(20px)}}
${CLIP_CSS}
</style><body data-scene="0">${SCENES.map((s, i) => sceneHtml(s, i, clips)).join('')}${clipsJson(clips)}<script>${PLAYER}</script>`;
