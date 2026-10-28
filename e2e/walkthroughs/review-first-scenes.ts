// The review-first explainer (PR 73), in the PR Decision Video Standard's order: the verdict,
// why, before, what changes, after, matches the ask, risk, review, undo, and the decision with the
// commit stamp. Before and after are real terminal recordings CI made of the runs and comments the
// spec names (its `// walkthrough-evidence:` lines, in order), not drawings. One scene on screen at
// a time, cut (scene-cut.ts), one scene per `## How to see it` step, and the spec leaves the scene
// starts as beats.json, so beat mode holds each scene for exactly its own paragraph of voice.
import { CLIP_CSS, clipsJson, PLAYER } from './evidence-player';
import { type Clip, clipHtml } from './review-first-2-scenes';
import { sceneCutCss } from './scene-cut';

export type Scene =
  | { readonly kind: 'verdict' }
  | { readonly kind: 'diagram'; readonly tag: string; readonly title: string; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'clip'; readonly clip: number }
  | { readonly kind: 'decision' };

/** The scenes, in order, and how long each is held while filming. */
export const SCENES: readonly (Scene & { readonly seconds: number })[] = [
  { kind: 'verdict', seconds: 7 },
  {
    kind: 'diagram', seconds: 10, tag: 'WHY', title: 'A video was bought before the work had passed',
    rows: [['The ready mark started the review and the recording together'], ['So a video could be made for work the review then turned down'], ['Derek asked: the review first, and a video only after a pass']],
  },
  { kind: 'clip', clip: 0, seconds: 8 },
  { kind: 'clip', clip: 1, seconds: 8 },
  {
    kind: 'diagram', seconds: 12, tag: 'WHAT CHANGES', title: 'The review first, then the video',
    rows: [['Ready', 'The Claude review'], ['Changes asked: a problem list, no video', 'Fix, push, the next round (3 at most)'], ['A pass: the review-passed label', 'The recorder starts', 'The video']],
  },
  { kind: 'clip', clip: 2, seconds: 8 },
  { kind: 'clip', clip: 3, seconds: 8 },
  { kind: 'clip', clip: 4, seconds: 8 },
  { kind: 'clip', clip: 5, seconds: 8 },
  {
    kind: 'diagram', seconds: 11, tag: 'MATCHES THE ASK', title: "Derek's request, point by point",
    rows: [['The review runs first'], ['Changes asked: the problems listed, no video'], ['Fix and push: the next round sees what was fixed'], ['A video after a pass, saying what was fixed'], ['The verdict first, the decision with the commit']],
  },
  {
    kind: 'diagram', seconds: 8, tag: 'RISK', title: 'Pipeline, docs and walkthrough only',
    rows: [['Nothing under src/: the game is untouched'], ['Each review round is paid: three at most, then a person looks']],
  },
  { kind: 'clip', clip: 6, seconds: 9 },
  {
    kind: 'diagram', seconds: 7, tag: 'UNDO', title: 'Revert the merge, as a pull request',
    rows: [['The docs and this explainer go back to before'], ['Nothing to clean up: no data, no settings']],
  },
  { kind: 'decision', seconds: 30 },
];

/** The total the recording runs. */
export const RECORDING_SECONDS = SCENES.reduce((a, s) => a + s.seconds, 0);

/** Where the decision scene's commit stamp goes: the spec fills it in when it films. */
export const STAMP_ID = 'stamp';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`);

/**
 * The review clip's own words, when CI recorded it and it ran: the real round and counts. A
 * review command that failed says why in its own clip, never as the verdict.
 */
export const reviewWords = (clips: readonly Clip[]): string => {
  const words = clips.find((c) => c.ok && c.command.includes('review-findings.sh'))?.headline ?? '';
  return words === '' ? 'The Claude review passed' : words;
};

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
