// PR 72's video: the motion explainer, then the evidence, then the verdict, 16:9 only.
// Each `## How to see it` step narrates one beat of BEATS, held for its seconds. A beat is an
// animated diagram (boxes and arrows popping in), a real terminal clip captured by CI (the
// `// walkthrough-evidence:` lines in the spec, in order), or the verdict card.
export type Beat = { readonly seconds: number } & (
  | { readonly kind: 'scene'; readonly scene: string }
  | { readonly kind: 'clip'; readonly clip: number }
  | { readonly kind: 'verdict' }
);

const SCENES = {
  ask: 'a|What Derek asked for|Review first:B;Pass:G;Video briefing:B/Review fails:R;Problems list:A;Fix and push:B',
  before: 'a|Before|Ready mark:K;Review:B;Video at the same time:R/Review fails:R;Video already made:R',
  after: 'a|After: part 2|Ready mark:K;Review:B;Passed:G;Passed label:G;Video:G/Changes asked:R;No video:K;Problems list:A',
  money: 'a|Before any money is spent|A real pass?:B;Covers this commit?:B;First video for it?:B;Pay once:G',
  briefing: 'a|The video is a briefing|Explainer:B;Evidence:G;Verdict:G',
  evidence: '|Evidence|Real runs on real pull requests:K/Before: PR 70:R;After: PR 72:G',
  why: 'a|Why the narration was empty|Budget 1,024 tokens:K;Thinking used all of it:R;No words left:R/No narration:R;No video:R',
  fix: 'a|The fix: PR 82, merged|Budget 16,000 tokens:G;Thinking fits:G;Words written:G/No text?:A;Ask once more:B;Still none: no video:K',
  afterFix: 'a|After the fix|First publish on the fixed script:B;This video:G',
} as const;

export const BEATS: readonly Beat[] = [
  { kind: 'scene', scene: 'ask', seconds: 7 },
  { kind: 'scene', scene: 'before', seconds: 8 },
  { kind: 'scene', scene: 'after', seconds: 12 },
  { kind: 'scene', scene: 'money', seconds: 9 },
  { kind: 'scene', scene: 'briefing', seconds: 6 },
  { kind: 'scene', scene: 'evidence', seconds: 4 },
  { kind: 'clip', clip: 0, seconds: 7 },
  { kind: 'clip', clip: 1, seconds: 7 },
  { kind: 'clip', clip: 2, seconds: 6 },
  { kind: 'clip', clip: 3, seconds: 6 },
  { kind: 'clip', clip: 4, seconds: 6 },
  { kind: 'clip', clip: 5, seconds: 6 },
  { kind: 'clip', clip: 6, seconds: 6 },
  { kind: 'clip', clip: 7, seconds: 8 },
  { kind: 'scene', scene: 'why', seconds: 8 },
  { kind: 'scene', scene: 'fix', seconds: 8 },
  { kind: 'clip', clip: 8, seconds: 7 },
  { kind: 'scene', scene: 'afterFix', seconds: 5 },
  // The card holds well past the last word. The publish asks for 2.2 words a second and the
  // voice speaks about 2.7, so the speech ends near 82% of the recording and the video is cut
  // 2 s after it: a card a quarter of the recording long is on screen while it is said.
  { kind: 'verdict', seconds: 40 },
];

/** One terminal clip as scripts/ship/pr-video-evidence.sh writes it. */
export interface Clip {
  readonly caption: string;
  readonly command: string;
  readonly captured_at: string;
  readonly ok: boolean;
  readonly lines: readonly string[];
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
/** The clips in evidence.json, each checked field by field; anything else is no clip at all. */
export const parseClips = (x: unknown): Clip[] =>
  Array.isArray(x)
    ? x.flatMap((c: unknown) =>
        isRecord(c) && typeof c['caption'] === 'string' && typeof c['command'] === 'string' &&
        typeof c['captured_at'] === 'string' && typeof c['ok'] === 'boolean' && Array.isArray(c['lines'])
          ? [{
              caption: c['caption'],
              command: c['command'],
              captured_at: c['captured_at'],
              ok: c['ok'],
              lines: c['lines'].filter((l: unknown): l is string => typeof l === 'string'),
            }]
          : [],
      )
    : [];

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`);

let d = 0;
const scene = (id: string, s: string): string => {
  const [kind = '', title = '', rows = ''] = s.split('|');
  const row = (r: string): string =>
    r.split(';').map((b) => b.replace(/(.*):(.)/, (_, t: string, c: string) => `<b class=${c} style=--d:${String(d++)}>${t}</b>`)).join('');
  d = 0;
  return `<section id="s-${id}" class="${kind}"><h1>${title}</h1>${rows.split('/').map((r) => `<div>${row(r)}</div>`).join('')}</section>`;
};

/** A clip: its caption, the command as typed, then each line gh printed, one after another. */
export const clipHtml = (clip: Clip | undefined, n: number): string => {
  const body =
    clip === undefined
      ? '<p class=miss>No evidence was captured for this clip in this run.</p>'
      : `<pre><i>$ ${esc(clip.command)}</i>\n${clip.lines.map((l, i) => `<span style=--d:${String(i)}>${esc(l)}</span>`).join('\n')}</pre>` +
        `<small>Captured live from GitHub by CI at ${esc(clip.captured_at)}${clip.ok ? '' : ' (the command failed: this is its error)'}</small>`;
  return `<section id="c-${String(n)}" class="clip"><h2>${esc(clip?.caption ?? 'Evidence')}</h2>${body}</section>`;
};

const verdict = `<section id="s-verdict" class="verdict"><div class=card><p>Verdict</p><h1>Part 2 of 3: ready for Derek's approval</h1>
<div><b class=G style=--d:0>Review first</b><b class=G style=--d:1>Video after a pass</b><b class=G style=--d:2>Narration fixed</b></div>
<p class=next>Next: part 3, the motion explainers</p></div></section>`;

export const pageHtml = (clips: readonly Clip[]): string => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#fdfbf4;font:600 24px Arial,sans-serif;color:#fff}
section{display:none;text-align:center}h1{color:#23324a;font-size:48px}div{display:flex;justify-content:center;margin:40px 0}
b{padding:26px;border-radius:18px;margin-left:72px;position:relative;animation:pop .6s calc(.4s + .45s*var(--d)) both}
b:first-child{margin:0}.a b+b:before{content:'→';position:absolute;left:-56px;color:#23324a;font-size:44px}
b:last-child{animation:pop .6s calc(.4s + .45s*var(--d)) both,glow 1.6s calc(1s + .45s*var(--d)) infinite alternate}
.G{background:#3a8a55}.A{background:#e2a72e}.R{background:#d0573f}.B{background:#3e70b8}.K{background:#8a93a3}
@keyframes pop{from{opacity:0;transform:translateY(30px) scale(.8)}}@keyframes glow{to{box-shadow:0 0 0 10px #23324a22}}
.clip{width:1180px;text-align:left}.clip h2{color:#23324a;font-size:34px;margin:0 0 14px}
pre{background:#1d2633;color:#d8e1ec;font:14px/1.5 'DejaVu Sans Mono',monospace;padding:18px 22px;border-radius:12px;margin:0;white-space:pre-wrap;min-height:330px}
pre i{color:#8fd18f;font-style:normal}pre span{opacity:0;animation:line .2s calc(.9s + .22s*var(--d)) both}
@keyframes line{to{opacity:1}}small{display:block;color:#5b6676;font-size:15px;margin-top:10px}.miss{color:#5b6676}
.card{display:block;background:#fff;border:6px solid #3a8a55;border-radius:28px;padding:44px 64px;box-shadow:0 18px 50px #23324a33;animation:pop .7s .2s both}
.card p{color:#3a8a55;font-size:30px;margin:0}.card .next{color:#5b6676;font-size:26px}.card h1{margin:18px 0}
[data-beat] section{display:none}[data-beat] section.on{display:block}
</style><body>${Object.entries(SCENES).map(([id, s]) => scene(id, s)).join('')}${clips.map(clipHtml).join('')}${
  [...new Set(BEATS.flatMap((b) => (b.kind === 'clip' && b.clip >= clips.length ? [b.clip] : [])))].map((n) => clipHtml(undefined, n)).join('')
}${verdict}`;

/** The section a beat shows. */
export const beatId = (b: Beat): string => (b.kind === 'scene' ? `s-${b.scene}` : b.kind === 'clip' ? `c-${String(b.clip)}` : 's-verdict');
