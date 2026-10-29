// The "plain story" explainer (PR 97): why PR videos now open on a plain story and end on the
// review result, and why the recorder now films only a pull request's own walkthrough. This video is
// narrated by main's video maker as it was before this pull request, which says the verdict first,
// so its first scene is that verdict, in the words main's maker says. Before and after are real
// terminal recordings CI made (the spec's `// walkthrough-evidence:` lines, in order). One scene on
// screen at a time, cut (scene-cut.ts), one scene per `## How to see it` step, and the spec leaves
// the scene starts as beats.json, so beat mode holds each scene for exactly its own paragraph.
import { CLIP_CSS, clipsJson, PLAYER } from './evidence-player';
import { type Clip, clipHtml } from './review-first-2-scenes';
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
    kind: 'diagram', seconds: 12, tag: 'WHY', title: 'A video has to make sense to someone not in the loop',
    rows: ['An overwhelmed manager with many approval requests', 'Or Derek, six months from now'],
  },
  {
    kind: 'diagram', seconds: 12, tag: 'BEFORE', title: 'Before, a video opened on a verdict card',
    rows: ['The review passed in round 2', 'Nobody new to it knew what that meant'],
  },
  { kind: 'clip', clip: 0, seconds: 9 },
  {
    kind: 'diagram', seconds: 13, tag: 'WHAT CHANGES', title: 'A plain story, in this order',
    rows: ['What this is, why it matters, what to decide', 'Real evidence before and after', 'The review result last, in plain words'],
  },
  {
    kind: 'diagram', seconds: 12, tag: 'WHAT CHANGES', title: "Only a pull request's own walkthrough is filmed",
    rows: ['Filmed only for the pull request that adds it', 'Its quoted steps must be on screen, or no video'],
  },
  { kind: 'clip', clip: 1, seconds: 10 },
  { kind: 'clip', clip: 2, seconds: 10 },
  {
    kind: 'diagram', seconds: 12, tag: 'RISK', title: 'Pipeline, docs and walkthrough only',
    rows: ["Nothing in the game's code changes", 'This video is still made by the old video maker'],
  },
  { kind: 'clip', clip: 3, seconds: 9 },
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

/** The review clip, when CI recorded it and it ran: its lines carry the real round and counts. */
const reviewClip = (clips: readonly Clip[]): Clip | undefined =>
  clips.find((c) => c.ok && c.command.includes('review-findings.sh'));

/**
 * The verdict as main's video maker says it before this pull request merges (the sentence
 * pr-video-script.sh on main builds from the same counts), so the first scene shows exactly what
 * the voice says over it. Without the review clip it says only what is certain.
 */
export const verdictWords = (clips: readonly Clip[]): string => {
  const lines = reviewClip(clips)?.lines ?? [];
  const value = (key: string): string | undefined =>
    lines.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1).trim();
  const round = value('round');
  const notes = value('notes');
  if (round === undefined || !/^[1-9][0-9]*$/.test(round) || notes === undefined || !/^[0-9]+$/.test(notes)) {
    return 'The review passed. It is ready for a person to approve.';
  }
  const fixed = (value('found') ?? '')
    .split(' ')
    .map((pair) => Number(pair.split(':')[1] ?? 0))
    .filter((n) => Number.isInteger(n) && n > 0)
    .reduce((a, n) => a + n, 0);
  const fixedWords = fixed === 0 ? 'nothing needed fixing' : fixed === 1 ? 'one problem found earlier was fixed' : `${String(fixed)} problems found earlier were fixed`;
  const notesWords = notes === '0' ? 'no notes' : notes === '1' ? 'one note' : `${notes} notes`;
  return `The review passed in round ${round} with no blocking problems left; ${fixedWords}, with ${notesWords}. It is ready for a person to approve.`;
};

// The review clip without its headline: the verdict's words are said once, on the verdict scene.
const withoutHeadline = (clip: Clip | undefined): Clip | undefined => (clip === undefined ? undefined : { ...clip, headline: '' });

const sceneHtml = (s: Scene, i: number, clips: readonly Clip[]): string => {
  const open = `<section id="s${String(i)}" class="scene ${s.kind}">`;
  switch (s.kind) {
    case 'verdict':
      return `${open}<p class=tag>VERDICT</p><h1 class=said>${esc(verdictWords(clips))}</h1></section>`;
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
