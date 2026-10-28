// PR 72's motion explainer: boxes and arrows popping in, one flow per scene, 16:9 only.
// Step i of `## How to see it` narrates scene i, held for its voice in pr-72-bee7f59.mp4.
export const SCENE_SECONDS = [5.5, 7, 12, 8.5, 6, 5, 2.5, 7];
const SCENES = [
  'a|What Derek asked for|Review first:B;Pass:G;Video briefing:B/Review fails:R;Problems list:A;Fix and push:B',
  'a|Before: main today|Ready mark:K;Review:B;Video at the same time:R/Review fails:R;Video already made:R',
  'a|After: part 2|Ready mark:K;Review:B;Passed:G;Passed label:G;Video:G/Changes asked:R;No video:K;Problems list:A',
  'a|Before any money is spent|A real pass?:B;Covers this commit?:B;First video for it?:B;Pay once:G',
  'a|The video is a briefing|Intent:B;What was built:B;Review results:A;Verdict card:G',
  '|Evidence|Ship tests ✓:G;Unit tests ✓:G/Build ✓:G;Label guard test ✓:G',
  '|What the review found|Part 1 review: 3 small notes:A/One round cap:G;Unlabelled finding kept:G;Label step guard:G',
  'a|Verdict|Part 2 of 3:G;Derek approves:B/Part 3: motion explainers:K',
];

let d = 0;
const scene = (s: string): string => {
  const [kind = '', title = '', rows = ''] = s.split('|');
  const row = (r: string): string =>
    r.split(';').map((b) => b.replace(/(.*):(.)/, (_, t: string, c: string) => `<b class=${c} style=--d:${String(d++)}>${t}</b>`)).join('');
  d = 0;
  return `<section class="${kind}"><h1>${title}</h1>${rows.split('/').map((r) => `<div>${row(r)}</div>`).join('')}</section>`;
};

export const SCENES_HTML = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#fdfbf4;font:600 24px Arial,sans-serif;color:#fff}
section{display:none;text-align:center}h1{color:#23324a;font-size:48px}div{display:flex;justify-content:center;margin:40px 0}
b{padding:26px;border-radius:18px;margin-left:72px;position:relative;animation:pop .6s calc(.5s + .45s*var(--d)) both}
b:first-child{margin:0}.a b+b:before{content:'→';position:absolute;left:-56px;color:#23324a;font-size:44px}
b:last-child{animation:pop .6s calc(.5s + .45s*var(--d)) both,glow 1.6s calc(1s + .45s*var(--d)) infinite alternate}
.G{background:#3a8a55}.A{background:#e2a72e}.R{background:#d0573f}.B{background:#3e70b8}.K{background:#8a93a3}
@keyframes pop{from{opacity:0;transform:translateY(30px) scale(.8)}}@keyframes glow{to{box-shadow:0 0 0 10px #23324a22}}
${SCENES.map((_, i) => `[data-scene="${String(i)}"] section:nth-child(${String(i + 1)})`).join()}{display:block}
</style><body>${SCENES.map(scene).join('')}`;
