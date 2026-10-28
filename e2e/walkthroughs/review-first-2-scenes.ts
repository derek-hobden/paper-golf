// PR 72's video: the motion explainer, then the evidence, then the verdict, 16:9 only.
// Each `## How to see it` step narrates one beat of BEATS, held for its seconds. A beat is an
// animated diagram (boxes and arrows popping in), a real terminal recording made by CI (the
// `// walkthrough-evidence:` lines in the spec, in order) played back in xterm.js, or the
// verdict card. Everything sits inside the safe area: SAFE, centred in the 1280x720 frame.
export type Beat = { readonly seconds: number } & (
  | { readonly kind: 'scene'; readonly scene: string }
  | { readonly kind: 'clip'; readonly clip: number }
  | { readonly kind: 'verdict' }
);

/** The frame, and the 85% of it that nothing is drawn outside. */
export const FRAME = { width: 1280, height: 720 } as const;
export const SAFE = { width: 1088, height: 612 } as const;

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
  undo: 'a|Undo|Revert the merge:B;As a pull request:B;Merged:G/The video is made on the ready mark again:K',
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
  { kind: 'clip', clip: 6, seconds: 7 },
  { kind: 'clip', clip: 7, seconds: 8 },
  { kind: 'scene', scene: 'why', seconds: 8 },
  { kind: 'scene', scene: 'fix', seconds: 8 },
  { kind: 'clip', clip: 8, seconds: 7 },
  { kind: 'scene', scene: 'afterFix', seconds: 5 },
  { kind: 'clip', clip: 9, seconds: 9 },
  { kind: 'scene', scene: 'undo', seconds: 7 },
  // The card holds well past the last word. The publish asks for 2.2 words a second and the
  // voice speaks about 2.7, so the speech ends near 82% of the recording and the video is cut
  // 2 s after it: a card a quarter of the recording long is on screen while it is said.
  { kind: 'verdict', seconds: 45 },
];

/** One terminal recording as scripts/ship/pr-video-evidence.sh writes it. */
export interface Clip {
  readonly caption: string;
  readonly command: string;
  readonly captured_at: string;
  readonly ok: boolean;
  readonly cols: number;
  readonly rows: number;
  readonly recorder: string;
  readonly headline: string;
  /** The terminal's bytes, base64. */
  readonly stream: string;
  /** [seconds since the last chunk, bytes in this chunk], in order. */
  readonly timing: readonly (readonly [number, number])[];
  readonly lines: readonly string[];
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0 && x <= 400;
const timingOf = (x: unknown): (readonly [number, number])[] | undefined => {
  if (!Array.isArray(x)) return undefined;
  const out: (readonly [number, number])[] = [];
  for (const t of x) {
    if (!Array.isArray(t) || t.length !== 2) return undefined;
    const s: unknown = t[0], n: unknown = t[1];
    if (typeof s !== 'number' || typeof n !== 'number' || s < 0 || n < 0) return undefined;
    out.push([s, n]);
  }
  return out;
};
/** The clips in evidence.json, each checked field by field; anything else is no clip at all. */
export const parseClips = (x: unknown): Clip[] =>
  Array.isArray(x)
    ? x.flatMap((c: unknown) => {
        if (!isRecord(c)) return [];
        const { caption, command, captured_at, ok, cols, rows, recorder, headline, stream, lines } = c;
        const timing = timingOf(c['timing']);
        return typeof caption === 'string' && typeof command === 'string' && typeof captured_at === 'string' &&
          typeof ok === 'boolean' && isCount(cols) && isCount(rows) && typeof recorder === 'string' &&
          typeof headline === 'string' && typeof stream === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(stream) &&
          timing !== undefined && Array.isArray(lines)
          ? [{
              caption, command, captured_at, ok, cols, rows, recorder, headline, stream, timing,
              lines: lines.filter((l: unknown): l is string => typeof l === 'string'),
            }]
          : [];
      })
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

/** A clip: its caption, the review's words for a review clip, the terminal, then the recorder's stamp. */
export const clipHtml = (clip: Clip | undefined, n: number): string => {
  const body =
    clip === undefined
      ? '<p class=miss>No evidence was captured for this clip in this run.</p>'
      : `${clip.headline === '' ? '' : `<p class=headline>${esc(clip.headline)}</p>`}<div class=term id="t-${String(n)}"></div>` +
        `<small>Recorded live by CI (${esc(clip.recorder)}) at ${esc(clip.captured_at)}, in a ${String(clip.cols)}×${String(clip.rows)} terminal${clip.ok ? '' : '. The command failed: this is its error'}</small>`;
  return `<section id="c-${String(n)}" class="clip"><h2>${esc(clip?.caption ?? 'Evidence')}</h2>${body}</section>`;
};

const verdict = `<section id="s-verdict" class="verdict"><div class=card><p>Verdict</p><h1>Part 2 of 3: ready for Derek's approval</h1>
<div><b class=G style=--d:0>Review first</b><b class=G style=--d:1>Video after a pass</b><b class=G style=--d:2>Narration fixed</b></div>
<p class=next>Next: part 3, the motion explainers</p></div></section>`;

// On a `play-clip` event ([n, seconds]), plays clip n back in xterm.js (loaded by the spec as window.Terminal) at the size it was
// recorded at, every chunk in order. A pause longer than 0.6 s is cut to 0.6 s, and the whole
// recording is sped up when it would not finish two seconds before its beat ends.
const player = `const CLIPS = JSON.parse(document.getElementById('clips').textContent);
window.addEventListener('play-clip', (e) => {
  const [n, seconds] = e.detail;
  const c = CLIPS[n], el = document.getElementById('t-' + n);
  if (!c || !el || typeof Terminal !== 'function') return;
  el.textContent = '';
  const fontSize = Math.min(15, Math.floor(${String(SAFE.width - 60)} / (c.cols * 0.6)), Math.floor(430 / (c.rows * 1.2)));
  const term = new Terminal({ cols: c.cols, rows: c.rows, fontSize, scrollback: 0, disableStdin: true, cursorBlink: false,
    fontFamily: "'Liberation Mono', 'DejaVu Sans Mono', monospace", theme: { background: '#1d2633', foreground: '#d8e1ec' } });
  term.open(el);
  const bytes = Uint8Array.from(atob(c.stream), (ch) => ch.charCodeAt(0));
  const delays = c.timing.map((t) => Math.min(t[0], 0.6));
  const total = delays.reduce((a, b) => a + b, 0), budget = Math.max(0.5, seconds - 2.4);
  const k = total > budget ? budget / total : 1;
  let at = 0.4, off = 0;
  c.timing.forEach((t, i) => {
    at += delays[i] * k;
    const chunk = bytes.subarray(off, off + t[1]);
    off += t[1];
    setTimeout(() => term.write(chunk), at * 1000);
  });
});`;

export const pageHtml = (clips: readonly Clip[]): string => `<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:${String(FRAME.width)}px;height:${String(FRAME.height)}px;display:grid;place-items:center;background:#fdfbf4;font:600 22px Arial,sans-serif;color:#fff;overflow:hidden}
section{display:none;text-align:center;max-width:${String(SAFE.width)}px;max-height:${String(SAFE.height)}px;box-sizing:border-box}
h1{color:#23324a;font-size:44px;margin:0 0 8px}section>div,.card>div{display:flex;justify-content:center;margin:34px 0}
b{padding:20px 22px;border-radius:16px;margin-left:56px;position:relative;animation:pop .6s calc(.4s + .45s*var(--d)) both}
b:first-child{margin:0}.a b+b:before{content:'→';position:absolute;left:-44px;color:#23324a;font-size:38px}
b:last-child{animation:pop .6s calc(.4s + .45s*var(--d)) both,glow 1.6s calc(1s + .45s*var(--d)) infinite alternate}
.G{background:#3a8a55}.A{background:#e2a72e}.R{background:#d0573f}.B{background:#3e70b8}.K{background:#8a93a3}
@keyframes pop{from{opacity:0;transform:translateY(30px) scale(.8)}}@keyframes glow{to{box-shadow:0 0 0 10px #23324a22}}
.clip{text-align:left}.clip h2{color:#23324a;font-size:30px;margin:0 0 12px}
.headline{color:#3a8a55;font-size:28px;margin:0 0 12px}
.term{display:inline-block;margin:0;padding:12px 14px;background:#1d2633;border-radius:12px}
small{display:block;color:#5b6676;font-size:14px;margin-top:10px}.miss{color:#5b6676}
.card{display:block;max-width:900px;background:#fff;border:5px solid #3a8a55;border-radius:24px;padding:34px 48px;box-shadow:0 14px 40px #23324a33;animation:pop .7s .2s both}
.card p{color:#3a8a55;font-size:26px;margin:0}.card .next{color:#5b6676;font-size:22px}.card h1{font-size:38px;margin:14px 0}.card>div{margin:26px 0}
.card b{margin-left:40px}.card b:first-child{margin:0}
[data-beat] section{display:none}[data-beat] section.on{display:block}
</style><body>${Object.entries(SCENES).map(([id, s]) => scene(id, s)).join('')}${clips.map(clipHtml).join('')}${
  [...new Set(BEATS.flatMap((b) => (b.kind === 'clip' && b.clip >= clips.length ? [b.clip] : [])))].map((n) => clipHtml(undefined, n)).join('')
}${verdict}<script type="application/json" id="clips">${
  JSON.stringify(clips.map((c) => ({ cols: c.cols, rows: c.rows, stream: c.stream, timing: c.timing }))).replace(/</g, '\\u003c')
}</script><script>${player}</script>`;

/** The section a beat shows. */
export const beatId = (b: Beat): string => (b.kind === 'scene' ? `s-${b.scene}` : b.kind === 'clip' ? `c-${String(b.clip)}` : 's-verdict');
