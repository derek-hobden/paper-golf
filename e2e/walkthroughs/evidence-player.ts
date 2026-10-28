// The terminal recordings CI made (scripts/ship/pr-video-evidence.sh), played back in xterm.js
// at the size they were recorded at. The same playback as PR 72's walkthrough, kept here so a
// later walkthrough can use it without touching that one's scenes (which would make the
// recorder film PR 72's walkthrough too).
import type { Clip } from './review-first-2-scenes';

/** A wait for GitHub longer than this plays as this, and the clock under the clip says so. */
const WAIT = 0.3;

/** The recordings as the player reads them; nothing in them can close the script tag. */
export const clipsJson = (clips: readonly Clip[]): string =>
  `<script type="application/json" id="clips">${JSON.stringify(
    clips.map((c) => ({ cols: c.cols, rows: c.rows, stream: c.stream, timing: c.timing })),
  ).replace(/</g, '\\u003c')}</script>`;

/**
 * On a `play-clip` event ([n, seconds]) clip n's terminal opens with its prompt already on it,
 * so the box is never shown empty, and plays on in the order and at the pace it was recorded;
 * a recording longer than its beat allows is sped up, and the clock says how it was played.
 */
export const PLAYER = `const CLIPS = JSON.parse(document.getElementById('clips').textContent);
window.addEventListener('play-clip', (e) => {
  const [n, seconds] = e.detail;
  const c = CLIPS[n], el = document.getElementById('t-' + n), clock = document.getElementById('k-' + n);
  if (!c || !el || typeof Terminal !== 'function') return;
  el.textContent = '';
  const fontSize = Math.min(15, Math.floor(1028 / (c.cols * 0.6)), Math.floor(430 / (c.rows * 1.2)));
  const term = new Terminal({ cols: c.cols, rows: c.rows, fontSize, scrollback: 0, disableStdin: true, cursorBlink: true,
    fontFamily: "'Liberation Mono', 'DejaVu Sans Mono', monospace", theme: { background: '#1d2633', foreground: '#d8e1ec' } });
  term.open(el);
  const bytes = Uint8Array.from(atob(c.stream), (ch) => ch.charCodeAt(0));
  const first = c.timing.length > 0 ? c.timing[0][1] : 0;
  term.write(bytes.subarray(0, first));
  const rest = c.timing.slice(1);
  const total = rest.reduce((a, r) => a + r[0], 0);
  const waits = rest.map((r) => Math.min(r[0], ${String(WAIT)}));
  const shown = waits.reduce((a, w) => a + w, 0), budget = Math.max(0.5, seconds - 2.5);
  const k = shown > budget ? budget / shown : 1;
  const cut = rest.some((r) => r[0] > ${String(WAIT)});
  const how = (cut ? 'each wait for GitHub over ${String(WAIT)} s shown as ${String(WAIT)} s' : 'real speed') +
    (k === 1 ? '' : ', then played ' + (1 / k).toFixed(1) + '× faster');
  let at = 0, off = first;
  const marks = [];
  let real = 0;
  rest.forEach((r, i) => {
    at += waits[i] * k;
    real += r[0];
    marks.push([at, real]);
    const chunk = bytes.subarray(off, off + r[1]);
    off += r[1];
    setTimeout(() => term.write(chunk), at * 1000);
  });
  if (!clock) return;
  const t0 = performance.now();
  const tick = () => {
    const now = (performance.now() - t0) / 1000;
    const done = marks.filter((m) => m[0] <= now);
    const shownReal = done.length > 0 ? done[done.length - 1][1] : 0;
    clock.textContent = 'Recording time ' + shownReal.toFixed(1) + ' s of ' + total.toFixed(1) + ' s (' + how + ')';
    if (done.length < marks.length) setTimeout(tick, 50);
  };
  tick();
});`;

/** The CSS the clips need inside a scene. */
export const CLIP_CSS = `.clip{text-align:left}.clip h2{color:#23324a;font-size:30px;margin:0 0 12px}
.headline{color:#3a8a55;font-size:28px;margin:0 0 12px}
.term{display:block;width:max-content;min-height:20px;margin:0;padding:12px 14px;background:#1d2633;border-radius:12px}
small{display:block;color:#5b6676;font-size:14px;margin-top:10px}.clock{margin-top:4px;color:#3a8a55;min-height:17px}.miss{color:#5b6676}`;
