// The motion kit: an illustrated motion explainer from data, with the narration from the same
// data. Flo on pr-99-58eefae.mp4: the video was plain text slides read aloud, and the voice said
// things the screen did not show ("Pull requests are proposed changes" over nothing at 0:04) and
// put words to the screen it did not have ("Stamped with the commit, its saved version" over
// "commit 58eefae" at 1:10). Here every scene is an animated diagram, and what it shows and what
// is said come from one list of lines:
//
// - A scene's `say` lines are spoken, in order, and shown on screen (a diagram node's label is
//   one of them, or a part of one, so it is spoken too: unsaidLabels refuses any other).
// - scriptOf() is the narration: one paragraph per scene, its `say` lines joined. The film leaves
//   it as script.json beside beats.json, and pr-video-publish.sh says it word for word, with no
//   model writing anything (SCENE_SCRIPT in pr-video-script.sh).
// - motionPage() refuses a text-only scene (illustrationProblems): every scene but a terminal
//   clip is an SVG drawing with shapes that move.
//
// scenesFromSteps() builds the scenes from a pull request's `## How to see it` steps, so a logic
// or CI change with no walkthrough of its own still gets an illustrated explainer (plan.ts
// 'motion', filmed by default.spec.ts).
import { writeFileSync } from 'node:fs';
import { CLIP_CSS, clipsJson, PLAYER } from './evidence-player';
import { type Clip, clipHtml } from './review-first-2-scenes';
import { reviewWords } from './review-first-scenes';
import { sceneCutCss } from './scene-cut';

// This file runs in Node, but tsconfig only loads browser types (no @types/node), as in beats.ts.
declare const process: { env: Record<string, string | undefined> };

export type Tone = 'plain' | 'bad' | 'good' | 'new';

export type Picture =
  /** Steps left to right, joined by arrows a marker travels along; `stop` halts it at the last, crossed out. */
  | { readonly kind: 'flow'; readonly nodes: readonly string[]; readonly tone?: Tone; readonly stop?: boolean }
  /** One step that splits two ways: the marker takes `yes`. `stamp` adds "Filmed at commit <sha>." */
  | { readonly kind: 'fork'; readonly from: string; readonly yes: string; readonly no: string; readonly stamp?: boolean }
  /** A terminal recording CI made (its caption has to be one of the scene's lines). */
  | { readonly kind: 'clip'; readonly clip: number }
  /** The review result: a shield whose tick draws itself, over the fixed review words. */
  | { readonly kind: 'review' };

export interface MotionScene {
  /** What the scene is, for its `## How to see it` step (never shown: it is not said). */
  readonly tag: string;
  /** Spoken in order and shown on screen. The review scene's words are the review's own. */
  readonly say: readonly string[];
  readonly picture: Picture;
  /** How long the scene is filmed; beat mode then holds it for exactly its own words. */
  readonly seconds: number;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${String(c.charCodeAt(0))};`);
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The scenes as filmed: the review scene says the review's words, a stamped fork its commit. */
export const resolveScenes = (scenes: readonly MotionScene[], clips: readonly Clip[], sha: string): MotionScene[] =>
  scenes.map((s) => {
    if (s.picture.kind === 'review') return { ...s, say: [reviewWords(clips)] };
    if (s.picture.kind === 'fork' && s.picture.stamp === true) return { ...s, say: [...s.say, `Filmed at commit ${sha}.`] };
    return s;
  });

/** The words a scene's picture puts on screen, besides its lines. */
const labelsOf = (p: Picture, clips: readonly Clip[]): string[] => {
  switch (p.kind) {
    case 'flow':
      return [...p.nodes];
    case 'fork':
      return [p.from, p.yes, p.no];
    case 'clip': {
      const clip = clips[p.clip];
      return clip === undefined ? [] : [clip.caption];
    }
    case 'review':
      return [];
  }
};

/** Words on screen that the scene does not say: none is allowed. */
export const unsaidLabels = (scene: MotionScene, clips: readonly Clip[]): string[] => {
  const said = norm(scene.say.join(' '));
  return labelsOf(scene.picture, clips).filter((l) => !said.includes(norm(l)));
};

/** The narration: one paragraph per scene, exactly its lines, each ended as a sentence. */
export const scriptOf = (scenes: readonly MotionScene[]): string[] =>
  scenes.map((s) =>
    s.say.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l !== '').map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)).join(' '));

/** The `## How to see it` steps, one per scene, quoting every line it shows and says. */
export const stepLines = (scenes: readonly MotionScene[]): string[] =>
  scenes.map((s) => {
    if (s.picture.kind === 'review') return '- review result: the fixed review result, shown as it is said';
    const stamp = s.picture.kind === 'fork' && s.picture.stamp === true ? ', stamped with the commit it was filmed at' : '';
    return `- ${s.tag.toLowerCase()}: ${s.say.map((l) => `"${l}"`).join(', ')}${stamp}`;
  });

// --- drawing -------------------------------------------------------------------------------
const W = 1100;
const H = 330;
const COLOURS: Record<Tone, readonly [string, string]> = {
  plain: ['#3e70b8', '#eaf1fb'],
  bad: ['#c0392b', '#fdecea'],
  good: ['#3a8a55', '#e8f5ec'],
  new: ['#7a4fc4', '#f1ebfb'],
};

/** A label's lines, about `chars` wide, at most four. */
const wrap = (label: string, chars: number): string[] => {
  const out: string[] = [];
  for (const word of label.split(/\s+/)) {
    const last = out.at(-1);
    if (last !== undefined && last.length + 1 + word.length <= chars) out[out.length - 1] = `${last} ${word}`;
    else out.push(word);
  }
  return out.slice(0, 4);
};

const appear = (begin: number): string =>
  `<animate attributeName="opacity" from="0" to="1" begin="${begin.toFixed(2)}s" dur="0.4s" fill="freeze"/>`;

const node = (x: number, y: number, w: number, h: number, label: string, tone: Tone, begin: number): string => {
  const [stroke, fill] = COLOURS[tone];
  const lines = wrap(label, Math.max(8, Math.floor(w / 12)));
  const size = lines.length > 3 ? 18 : 21;
  const top = y + h / 2 - ((lines.length - 1) * size * 1.2) / 2;
  const text = lines
    .map((l, i) => `<text x="${String(x + w / 2)}" y="${(top + i * size * 1.2).toFixed(1)}" font-size="${String(size)}">${esc(l)}</text>`)
    .join('');
  const pulse = tone === 'new'
    ? `<animate attributeName="stroke-width" values="4;9;4" begin="${(begin + 0.4).toFixed(2)}s" dur="1.2s" repeatCount="3"/>`
    : '';
  return `<g opacity="0">${appear(begin)}<rect x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}" rx="18" fill="${fill}" stroke="${stroke}" stroke-width="4">${pulse}</rect>${text}</g>`;
};

/** Each scene's drawing names its own arrowhead: a hidden scene's marker draws nothing. */
let head = 'head-0';

const arrow = (x1: number, y1: number, x2: number, y2: number, begin: number, colour = '#8a93a3'): string => {
  const len = Math.hypot(x2 - x1, y2 - y1).toFixed(1);
  return `<path d="M${String(x1)} ${String(y1)} L${String(x2)} ${String(y2)}" stroke="${colour}" stroke-width="5" fill="none" marker-end="url(#${head})" stroke-dasharray="${len}" stroke-dashoffset="${len}"><animate attributeName="stroke-dashoffset" from="${len}" to="0" begin="${begin.toFixed(2)}s" dur="0.5s" fill="freeze"/></path>`;
};

const token = (points: readonly (readonly [number, number])[], begin: number, dur: number): string => {
  const [first] = points;
  if (first === undefined) return '';
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${String(x)} ${String(y)}`).join(' ');
  return `<circle r="13" cx="0" cy="0" fill="#e0a526" stroke="#fff" stroke-width="3" opacity="0">${appear(begin)}<animateMotion path="${path}" begin="${begin.toFixed(2)}s" dur="${dur.toFixed(2)}s" fill="freeze"/></circle>`;
};

const cross = (x: number, y: number, begin: number): string =>
  `<g opacity="0" stroke="#c0392b" stroke-width="9" stroke-linecap="round">${appear(begin)}<line x1="${String(x - 26)}" y1="${String(y - 26)}" x2="${String(x + 26)}" y2="${String(y + 26)}"/><line x1="${String(x + 26)}" y1="${String(y - 26)}" x2="${String(x - 26)}" y2="${String(y + 26)}"/></g>`;

const tick = (x: number, y: number, begin: number, scale = 1): string => {
  const d = `M${String(x - 24 * scale)} ${String(y)} L${String(x - 6 * scale)} ${String(y + 20 * scale)} L${String(x + 28 * scale)} ${String(y - 22 * scale)}`;
  return `<path d="${d}" stroke="#3a8a55" stroke-width="${String(10 * scale)}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="120" stroke-dashoffset="120"><animate attributeName="stroke-dashoffset" from="120" to="0" begin="${begin.toFixed(2)}s" dur="0.6s" fill="freeze"/></path>`;
};

const svg = (body: string): string =>
  `<svg class="picture" viewBox="0 0 ${String(W)} ${String(H)}" width="${String(W)}" height="${String(H)}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="${head}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#8a93a3"/></marker></defs>${body}</svg>`;

const flowSvg = (p: Extract<Picture, { kind: 'flow' }>): string => {
  const n = p.nodes.length;
  const gap = 70;
  const w = Math.min(300, (W - 40 - (n - 1) * gap) / n);
  const h = 170;
  const y = (H - h) / 2;
  const x0 = (W - (n * w + (n - 1) * gap)) / 2;
  const xs = p.nodes.map((_, i) => x0 + i * (w + gap));
  const tone = p.tone ?? 'plain';
  const parts = p.nodes.map((label, i) =>
    node(xs[i] ?? 0, y, w, h, label, p.stop === true && i === n - 1 ? 'bad' : tone, i * 0.7));
  for (let i = 0; i + 1 < n; i++) parts.push(arrow((xs[i] ?? 0) + w + 6, H / 2, (xs[i + 1] ?? 0) - 10, H / 2, i * 0.7 + 0.5));
  const start = n * 0.7;
  const pts = xs.map((x) => [x + w / 2, y - 22] as const);
  const travel = Math.max(1, (n - 1) * 0.9);
  parts.push(token(pts, start, travel));
  const lastX = (xs[n - 1] ?? 0) + w / 2;
  parts.push(p.stop === true ? cross(lastX, y - 22, start + travel) : tick(lastX, y - 30, start + travel, 0.7));
  return svg(parts.join(''));
};

const forkSvg = (p: Extract<Picture, { kind: 'fork' }>): string => {
  const w = 300;
  const h = 120;
  const parts = [
    node(40, (H - h) / 2, w, h, p.from, 'plain', 0),
    node(W - w - 40, 20, w, h, p.yes, 'good', 0.6),
    node(W - w - 40, H - h - 20, w, h, p.no, 'plain', 0.9),
    arrow(40 + w + 8, H / 2 - 10, W - w - 52, 20 + h / 2, 1.2, '#3a8a55'),
    arrow(40 + w + 8, H / 2 + 10, W - w - 52, H - 20 - h / 2, 1.4),
    token([[40 + w / 2, H / 2], [40 + w + 8, H / 2 - 10], [W - w - 52, 20 + h / 2]], 1.9, 1.2),
    tick(W - 20, 20 + h / 2, 3.2, 0.6),
  ];
  return svg(parts.join(''));
};

const reviewSvg = (): string =>
  svg(`<g opacity="0">${appear(0)}<path d="M550 30 L660 70 L660 170 Q660 260 550 300 Q440 260 440 170 L440 70 Z" fill="#e8f5ec" stroke="#3a8a55" stroke-width="7"/></g>` +
    `<circle cx="550" cy="165" r="0" fill="none" stroke="#3a8a55" stroke-width="3" opacity="0.5"><animate attributeName="r" from="60" to="150" begin="1.2s" dur="1.2s" fill="freeze"/><animate attributeName="opacity" from="0.6" to="0" begin="1.2s" dur="1.2s" fill="freeze"/></circle>` +
    tick(552, 160, 0.6, 1.6));

/** The lines shown under the picture: those a node does not already show in full. */
const captionLines = (s: MotionScene, clips: readonly Clip[]): string[] => {
  if (s.picture.kind === 'clip') return [];
  const shown = new Set(labelsOf(s.picture, clips).map(norm));
  return s.say.filter((l) => !shown.has(norm(l)));
};

const sceneHtml = (s: MotionScene, i: number, clips: readonly Clip[]): string => {
  head = `head-${String(i)}`;
  const open = `<section id="s${String(i)}" class="scene ${s.picture.kind}">`;
  const said = captionLines(s, clips).map((l) => `<p class=said>${esc(l)}</p>`).join('');
  switch (s.picture.kind) {
    case 'flow':
      return `${open}${flowSvg(s.picture)}${said}</section>`;
    case 'fork':
      return `${open}${forkSvg(s.picture)}${said}</section>`;
    case 'review':
      return `${open}${reviewSvg()}${said}</section>`;
    case 'clip':
      return `${open}${clipHtml(clips[s.picture.clip], s.picture.clip)}</section>`;
  }
};

/** Why a page's scenes are not all illustrated: one line per text-only scene. A terminal clip is evidence, not a slide. */
export const illustrationProblems = (html: string): string[] => {
  const problems: string[] = [];
  const sections = html.match(/<section id="s\d+" class="scene [a-z]+">[\s\S]*?<\/section>/g) ?? [];
  if (sections.length === 0) problems.push('the page has no scenes');
  sections.forEach((sec, i) => {
    if (sec.includes('class="scene clip"')) return;
    const shapes = (sec.match(/<(rect|circle|path|line|polygon|polyline|ellipse)\b/g) ?? []).length;
    const moves = /<animate(Motion|Transform)?\b/.test(sec);
    if (!sec.includes('<svg') || shapes < 3 || !moves) {
      problems.push(`scene ${String(i + 1)} is text only: it needs an animated diagram (an SVG with shapes that move), not words alone`);
    }
  });
  return problems;
};

/** The page: every scene drawn, cut from one to the next. Throws on a text-only scene or an unsaid word. */
export const motionPage = (scenes: readonly MotionScene[], clips: readonly Clip[]): string => {
  const unsaid = scenes.flatMap((s, i) => unsaidLabels(s, clips).map((l) => `scene ${String(i + 1)} shows "${l}" and never says it`));
  if (unsaid.length > 0) throw new Error(`motion: ${unsaid.join('; ')}`);
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;width:1280px;height:720px;display:grid;place-items:center;background:#fdfbf4;font:600 22px Arial,sans-serif;color:#23324a;overflow:hidden}
.scene{max-width:1100px;max-height:612px;box-sizing:border-box;text-align:center}
${sceneCutCss(scenes.length)}
svg.picture text{text-anchor:middle;dominant-baseline:middle;fill:#23324a;font:600 21px Arial,sans-serif}
.said{font-size:30px;line-height:1.3;margin:14px auto 0;max-width:1050px;animation:up .5s .8s both}
@keyframes up{from{opacity:0;transform:translateY(14px)}}
${CLIP_CSS}
</style><body data-scene="0">${scenes.map((s, i) => sceneHtml(s, i, clips)).join('')}${clipsJson(clips)}<script>${PLAYER}</script>`;
  const problems = illustrationProblems(html);
  if (problems.length > 0) throw new Error(`motion: ${problems.join('; ')}`);
  return html;
};

/**
 * Leaves the narration as script.json beside the recorder's clips (VIDEO_OUT is its clips
 * directory), next to beats.json, where pr-video-publish.sh reads it. Outside the recorder it
 * does nothing.
 */
export const saveScript = (scenes: readonly MotionScene[]): void => {
  const out = process.env['VIDEO_OUT'];
  if (out === undefined || out === '') return;
  writeFileSync(`${out.replace(/\/+$/, '').replace(/\/[^/]*$/, '')}/script.json`, JSON.stringify(scriptOf(scenes)));
};

// --- from a pull request's steps ------------------------------------------------------------
const STEP = /^\s*(?:[-*+]|\d+[.)])?\s*([a-z][a-z ]{1,30}):\s*(.*)$/i;

/** A step's label and the phrases it quotes, or undefined for a step of another shape. */
export const labelledStep = (line: string): { label: string; quotes: string[]; rest: string } | undefined => {
  const m = STEP.exec(line);
  if (m === null) return undefined;
  const rest = m[2] ?? '';
  const quotes = [...rest.matchAll(/"([^"]+)"/g)].map((q) => q[1] ?? '').filter((q) => q.trim() !== '');
  return { label: (m[1] ?? '').trim().toLowerCase(), quotes, rest };
};

const secondsFor = (say: readonly string[]): number =>
  Math.max(5, Math.ceil(say.join(' ').split(/\s+/).length / 2.2) + 2);

/**
 * The scenes for a pull request's own `label: "phrase", "phrase"` steps: before is a flow the
 * marker cannot finish, what changes is the new step pulsing, after reaches its end, the
 * decision splits two ways, and the review result is last. Each quoted phrase is a node, said
 * and shown. A step that quotes nothing, or of another shape, gives no scene.
 */
export const scenesFromSteps = (lines: readonly string[]): MotionScene[] => {
  const scenes: MotionScene[] = [];
  for (const line of lines) {
    const step = labelledStep(line);
    if (step === undefined) continue;
    const { label, quotes } = step;
    if (label.includes('review')) {
      scenes.push({ tag: 'review result', say: [], picture: { kind: 'review' }, seconds: 10 });
      continue;
    }
    if (quotes.length === 0) continue;
    const nodes = quotes.slice(0, 4);
    const say = quotes;
    const seconds = secondsFor(say);
    if (label.includes('decision') && quotes.length >= 3) {
      const [from = '', yes = '', no = ''] = quotes;
      scenes.push({ tag: label, say: [from, yes, no], picture: { kind: 'fork', from, yes, no, stamp: true }, seconds });
    } else if (label.includes('before')) {
      scenes.push({ tag: label, say, picture: { kind: 'flow', nodes, stop: true }, seconds });
    } else if (label.includes('change')) {
      scenes.push({ tag: label, say, picture: { kind: 'flow', nodes, tone: 'new' }, seconds });
    } else if (label.includes('after') || label.includes('live')) {
      scenes.push({ tag: label, say, picture: { kind: 'flow', nodes, tone: 'good' }, seconds });
    } else {
      scenes.push({ tag: label, say, picture: { kind: 'flow', nodes }, seconds });
    }
  }
  // The review result is always the last scene, as beat mode wants it.
  const review = scenes.filter((s) => s.picture.kind === 'review');
  return [...scenes.filter((s) => s.picture.kind !== 'review'), ...review.slice(0, 1)];
};
