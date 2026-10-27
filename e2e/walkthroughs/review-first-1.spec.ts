import { test } from '@playwright/test';

// PR 71's motion explainer: labelled boxes and arrows popping in, 16:9 only. The recorder films
// it for a diff that touches this file; the `## How to see it` steps narrate scene i, held S[i] s.
const S = [8, 9, 15, 9, 9, 9];
const SCENES = [
  'a|What Derek asked for|Review first:B;Pass:G;Video briefing:B/Review fails:R;Problems list:A;Fix, resubmit:B',
  'a|Before|Ready mark:K;Review and video at once:A;Video even if review fails:R',
  'a|After: part 1|Review:B;Changes asked:R;Findings file:A;Fix, push:B/Review again:B;Pass:G;Gate opens:G;Passed label:G/3 rounds:K;Then a person:K',
  '|Checks on this PR|check ✓:G;smoke ✓:G/ready-gate ✓:G;claude-review ✓:G',
  '|The Claude review|Passed:G;No blockers:G/4 small notes:A;Answered, fixes in parts 2 and 3:A',
  'a|Verdict|Ready to merge, part 1 of 3:G/Part 2:K;Part 3:K',
];

let d = 0;
const scene = (s: string): string => {
  const [kind = '', title = '', rows = ''] = s.split('|');
  const row = (r: string): string =>
    r.split(';').map((b) => b.replace(/(.*):(.)/, (_, t: string, c: string) => `<b class=${c} style=--d:${String(d++)}>${t}</b>`)).join('');
  d = 0;
  return `<section class="${kind}"><h1>${title}</h1>${rows.split('/').map((r) => `<div>${row(r)}</div>`).join('')}</section>`;
};

const HTML = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;height:100vh;display:grid;place-items:center;background:#fdfbf4;font:600 26px Arial,sans-serif;color:#fff}
section{display:none;text-align:center}h1{color:#23324a;font-size:50px}div{display:flex;justify-content:center;margin:40px 0}
b{padding:30px;border-radius:18px;margin-left:80px;position:relative;animation:pop .6s calc(.5s + .7s*var(--d)) both}
b:first-child{margin:0}.a b+b:before{content:'→';position:absolute;left:-62px;color:#23324a;font-size:46px}
.G{background:#3a8a55}.A{background:#e2a72e}.R{background:#d0573f}.B{background:#3e70b8}.K{background:#8a93a3}
@keyframes pop{from{opacity:0;transform:translateY(30px)}}
${SCENES.map((_, i) => `[data-scene="${String(i)}"] section:nth-child(${String(i + 1)})`).join()}{display:block}
</style><body>${SCENES.map(scene).join('')}`;

test.skip(({ isMobile }) => isMobile, 'the explainer is filmed once, at desktop size');
test('review first part 1 explainer', async ({ page }) => {
  test.setTimeout(90_000); // the chrome smoke project runs this too (its testIgnore drops the global one)
  await page.setContent(HTML);
  for (const [i, s] of S.entries()) {
    await page.evaluate((n) => (document.body.dataset['scene'] = String(n)), i);
    await page.waitForTimeout(s * 1_000);
  }
});
