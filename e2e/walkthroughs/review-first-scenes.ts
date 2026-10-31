// The review-first explainer (PR 73), in the plain-story order (AGENTS.md "Plain words for someone not in the loop"):
// why, before, what changes, after, matches the ask, risk, review, undo, the decision with the
// commit stamp, and the review
// result last, in plain words. Before and after are real terminal recordings CI made of the runs and comments the
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

/**
 * The scenes, in order, and how long each is filmed. Every word a scene shows is a quoted part of
 * its `## How to see it` step (stepLines), and the narration says quoted words as they are shown
 * (Gus on pr-73-ebc7387.mp4: a card said "made" while the voice said "bought"). A diagram's seconds
 * are its words at the narration's 2.2 a second, so the voice has nothing to pad with (the decision
 * scene's 30 s drew a paragraph about the merge that nothing on screen showed).
 */
export const SCENES: readonly (Scene & { readonly seconds: number })[] = [
  {
    kind: 'diagram', seconds: 14, tag: 'WHY', title: 'Before, a video could come before the review passed',
    rows: [['Ready started the review and the recording together'], ['A video could be bought for work the review turned down']],
  },
  { kind: 'clip', clip: 0, seconds: 8 },
  { kind: 'clip', clip: 1, seconds: 8 },
  {
    kind: 'diagram', seconds: 15, tag: 'WHAT CHANGES', title: 'The review first, then the video',
    rows: [['Ready starts the Claude review'], ['Changes asked: a problem list, and no video'], ['A pass adds the review-passed label, and that starts the recorder']],
  },
  { kind: 'clip', clip: 2, seconds: 8 },
  { kind: 'clip', clip: 3, seconds: 8 },
  { kind: 'clip', clip: 4, seconds: 8 },
  { kind: 'clip', clip: 5, seconds: 8 },
  {
    kind: 'diagram', seconds: 17, tag: 'MATCHES THE ASK', title: "Derek's request, point by point",
    rows: [['The review runs first'], ['Changes asked: the problems listed, and no video'], ['A video only after a pass, saying what was fixed'], ['The verdict first, and the decision with the commit']],
  },
  {
    kind: 'diagram', seconds: 12, tag: 'RISK', title: 'Pipeline, docs and walkthrough only',
    rows: [["Nothing in the game's code changes"], ['Each review round is paid: three at most, then a person looks']],
  },
  { kind: 'clip', clip: 6, seconds: 9 },
  {
    kind: 'diagram', seconds: 12, tag: 'UNDO', title: 'Revert the merge, as a pull request',
    rows: [['The docs and this explainer go back to before'], ['Nothing to clean up: no data, no settings']],
  },
  { kind: 'decision', seconds: 8 },
  { kind: 'verdict', seconds: 8 },
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
        return `- ${s.tag.toLowerCase()}: ${[s.title, ...s.rows.map((r) => r.join(' '))].map(q).join(', ')}`;
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

/** A review finding's kind, as the narration names it. */
const KIND_WORDS: Readonly<Record<string, string>> = {
  bug: 'bug', security: 'security problem', failing: 'spec gap', rule: 'rule problem',
};

/**
 * The review result as the narration says it, from the review clip's own counts (`round=`,
 * `found=`, `notes=`), word for word the fixed paragraph pr-video-script.sh says last, in plain
 * words for someone new to the pull request (Derek, 29 Oct 2026). A review command that failed says
 * why in its own clip, never as the result; without the clip the card says only what is certain,
 * since the video is made only after a pass.
 */
export const reviewWords = (clips: readonly Clip[]): string => {
  const safe = 'So this is safe to merge once a person approves it.';
  const lines = reviewClip(clips)?.lines ?? [];
  const value = (key: string): string | undefined =>
    lines.find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1).trim();
  const round = value('round');
  const notes = value('notes');
  if (round === undefined || !/^[1-9][0-9]*$/.test(round) || notes === undefined || !/^[0-9]+$/.test(notes)) {
    return `The automatic code review found no problems that block merging. ${safe}`;
  }
  const found = (value('found') ?? '')
    .split(' ')
    .map((pair) => ({ kind: pair.split(':')[0] ?? '', n: Number(pair.split(':')[1] ?? 0) }))
    .filter(({ n }) => Number.isInteger(n) && n > 0);
  const fixed = found.reduce((a, { n }) => a + n, 0);
  const foundWords = found
    .map(({ kind, n }) => `${String(n)} ${KIND_WORDS[kind] ?? 'problem'}${n === 1 ? '' : 's'}`)
    .join(' and ');
  const times = round === '2' ? 'twice' : round === '3' ? 'three times' : `${round} times`;
  const notesWords = notes === '0' ? '' : notes === '1'
    ? ' It left one small suggestion, which does not block anything.'
    : ` It left ${notes} small suggestions, which do not block anything.`;
  const looked = round === '1'
    ? 'The automatic code review read the whole change and found no problems that block merging.'
    : fixed === 0
      ? `The automatic code review read the whole change ${times}. It asked for changes first; they were made, and its last read found no problems that block merging.`
      : `The automatic code review read the whole change ${times}. First it found ${foundWords}; ${fixed === 1 ? 'it was' : 'they were'} fixed, and its last read found no problems that block merging.`;
  return `${looked}${notesWords} ${safe}`;
};

const withoutHeadline = (clip: Clip | undefined): Clip | undefined => (clip === undefined ? undefined : { ...clip, headline: '' });

const sceneHtml = (s: Scene, i: number, clips: readonly Clip[]): string => {
  const open = `<section id="s${String(i)}" class="scene ${s.kind}">`;
  switch (s.kind) {
    case 'verdict':
      return `${open}<p class=tag>REVIEW RESULT</p><h1 class=said>${esc(reviewWords(clips))}</h1></section>`;
    case 'diagram':
      return `${open}<p class=tag>${esc(s.tag)}</p><h1>${esc(s.title)}</h1>${s.rows
        .map((r) => `<div class=row>${r.map((b, k) => `<b style=--d:${String(k)}>${esc(b)}</b>`).join('')}</div>`)
        .join('')}</section>`;
    case 'clip':
      // The review clip without its headline: the verdict's words are said once, on the verdict
      // scene, and a green line over the terminal read as the opening left behind (Gus, 1:39).
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
.tag{color:#3e70b8;font-size:22px;letter-spacing:.14em;margin:0 0 10px}h1{font-size:44px;margin:0 0 26px}.sub{color:#5b6676;font-size:26px;margin:0 0 22px}
.row{display:flex;justify-content:center;gap:24px;margin:18px 0}
.row b{padding:18px 22px;border-radius:14px;background:#3e70b8;color:#fff;animation:pop .5s calc(.3s + .35s*var(--d,0)) both}
.row b.G{background:#3a8a55}.row b.K{background:#8a93a3}
.verdict h1{color:#3a8a55;font-size:38px;line-height:1.3}.stamp{display:inline-block;margin-top:24px;padding:12px 26px;border:3px solid #e3dcc8;border-radius:12px;font:700 24px 'Liberation Mono','DejaVu Sans Mono',monospace}
@keyframes pop{from{opacity:0;transform:translateY(20px)}}
${CLIP_CSS}
</style><body data-scene="0">${SCENES.map((s, i) => sceneHtml(s, i, clips)).join('')}${clipsJson(clips)}<script>${PLAYER}</script>`;
