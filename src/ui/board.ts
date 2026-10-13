import { cellAt } from '../engine/rules';
import type { Hole, P, Terrain } from '../engine/types';
import type { BallState, GameState, MoveOption } from '../game/game';
import type { ScreenPt } from './fx';
import { center, sketchCircle, wobblyLine } from './sketch';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

const INK = '#3d3d40';

/** One drawn pencil line that can be revealed progressively. */
export interface LiveStroke {
  path: SVGPathElement;
  set(t: number): void;
  tip(t: number): ScreenPt;
}

export class Board {
  readonly svg: SVGSVGElement;
  private terrainSvg: SVGSVGElement;
  private terrain: SVGGElement;
  private shotsLayer: SVGGElement;
  private ballsLayer: SVGGElement;
  private targetsLayer: SVGGElement;
  private hole: Hole | null = null;
  private defs: SVGDefsElement;
  private inkSvg: SVGSVGElement;
  private rings: HTMLDivElement;
  private graphites = new Map<string, string>();

  constructor(container: HTMLElement) {
    // The patterned terrain is the costliest thing to rasterise, so it gets its own static layer: shots, balls and
    // targets change every turn and live in a transparent SVG on top, which repaints alone.
    this.terrainSvg = el('svg', { class: 'board board-terrain', 'aria-hidden': 'true' });
    const tdefs = el('defs', {}, this.terrainSvg);
    tdefs.innerHTML = `
      <pattern id="pg-stipple" patternUnits="userSpaceOnUse" width="0.5" height="0.5">
        <rect width="0.5" height="0.5" fill="#e4e4e1"/>
        <circle cx="0.07" cy="0.11" r="0.018" fill="#c9c9c6"/>
        <circle cx="0.31" cy="0.06" r="0.014" fill="#cfcfcc"/>
        <circle cx="0.21" cy="0.29" r="0.016" fill="#c6c6c3"/>
        <circle cx="0.43" cy="0.37" r="0.015" fill="#cdcdca"/>
        <circle cx="0.12" cy="0.44" r="0.013" fill="#d0d0cd"/>
        <circle cx="0.39" cy="0.19" r="0.012" fill="#c9c9c6"/>
      </pattern>
      <pattern id="pg-hatch" patternUnits="userSpaceOnUse" width="0.2" height="0.2" patternTransform="rotate(45)">
        <rect width="0.2" height="0.2" fill="#f4f3ef"/>
        <line x1="0" y1="0" x2="0" y2="0.2" stroke="#c4c4c0" stroke-width="0.045"/>
      </pattern>
      <pattern id="pg-water" patternUnits="userSpaceOnUse" width="0.5" height="0.5">
        <rect width="0.5" height="0.5" fill="#7d8084"/>
        <circle cx="0.1" cy="0.2" r="0.02" fill="#72757a"/>
        <circle cx="0.35" cy="0.4" r="0.02" fill="#878a8e"/>
      </pattern>
      <radialGradient id="pg-cup" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stop-color="#555"/>
        <stop offset="1" stop-color="#2b2b2b"/>
      </radialGradient>`;
    this.terrain = el('g', { class: 'terrain' }, this.terrainSvg);
    container.appendChild(this.terrainSvg);
    this.svg = el('svg', { class: 'board board-play', role: 'img', 'aria-label': 'Golf hole' });
    this.defs = el('defs', {}, this.svg);
    this.shotsLayer = el('g', { class: 'shots' }, this.svg);
    this.ballsLayer = el('g', { class: 'balls' }, this.svg);
    this.targetsLayer = el('g', { class: 'targets' }, this.svg);
    container.appendChild(this.svg);
    // Lines being drawn live on their own composited layer, so a frame of pencil only repaints that layer.
    this.inkSvg = el('svg', { class: 'board-ink', 'aria-hidden': 'true' });
    container.appendChild(this.inkSvg);
    // Looping rings (active ball pulse, hole-out target) are HTML so they animate on the compositor.
    this.rings = document.createElement('div');
    this.rings.className = 'board-rings';
    container.appendChild(this.rings);
    // Rasterise a graphite stroke once, nearly invisibly, so the first live line has its pattern ready.
    const warm = this.stroke('M0.2 0.2 L0.6 0.2', INK, false, this.inkSvg);
    warm.setAttribute('opacity', '0.01');
    let n = 0;
    const tick = () => (++n < 6 ? requestAnimationFrame(tick) : warm.remove());
    requestAnimationFrame(tick);
  }

  /** Graphite: the player's colour broken up by a fixed paper-grain speckle, as a cached stroke pattern. */
  private graphite(color: string): string {
    let id = this.graphites.get(color);
    if (!id) {
      id = `pg-graphite-${this.graphites.size}`;
      this.graphites.set(color, id);
      const p = el('pattern', { id, patternUnits: 'userSpaceOnUse', width: 0.8, height: 0.8 }, this.defs);
      el('rect', { width: 0.8, height: 0.8, fill: color }, p);
      el('image', { href: grainUrl(), width: 0.8, height: 0.8, preserveAspectRatio: 'none' }, p);
    }
    return `url(#${id})`;
  }

  /** A ring positioned over a grid dot, in board percentages so it follows any resize without JS. */
  private ring(c: { x: number; y: number }, color: string, cls: string, dashed = false): HTMLDivElement {
    const h = this.hole!;
    const d = document.createElement('div');
    d.className = `ring ${cls}`;
    d.style.left = `${((c.x - 0.5) / h.w) * 100}%`;
    d.style.top = `${((c.y - 0.5) / h.h) * 100}%`;
    d.style.width = `${100 / h.w}%`;
    d.style.height = `${100 / h.h}%`;
    d.innerHTML = `<svg viewBox="-0.5 -0.5 1 1"><circle r="0.42" fill="none" stroke="${color}" stroke-width="${dashed ? 0.09 : 0.04}" ${
      dashed ? 'stroke-dasharray="0.16 0.1"' : ''
    }/></svg>`;
    this.rings.appendChild(d);
    return d;
  }

  setHole(hole: Hole) {
    this.hole = hole;
    this.svg.setAttribute('viewBox', `0 0 ${hole.w} ${hole.h}`);
    this.inkSvg.setAttribute('viewBox', `0 0 ${hole.w} ${hole.h}`);
    this.terrainSvg.setAttribute('viewBox', `0 0 ${hole.w} ${hole.h}`);
    this.inkSvg.replaceChildren();
    this.rings.replaceChildren();
    this.terrain.replaceChildren();
    // Rough is the darker stippled ground under everything; the fairway is lighter, cut out of it in plain paper.
    el('rect', { width: hole.w, height: hole.h, fill: 'url(#pg-stipple)', class: 't-rough' }, this.terrain);
    const fills: Partial<Record<Terrain, string>> = {
      fairway: '#fbfaf6',
      sand: 'url(#pg-hatch)',
      water: 'url(#pg-water)',
    };
    for (const t of ['fairway', 'sand', 'water'] as Terrain[]) {
      el('path', { d: this.regionPath(hole, t), fill: fills[t]!, class: `t-${t}` }, this.terrain);
    }
    // Sand gets a soft dashed rim like a printed bunker.
    const dots = el('g', { class: 'dots' }, this.terrain);
    const icons = el('g', { class: 'icons' }, this.terrain);
    for (let y = 0; y < hole.h; y++)
      for (let x = 0; x < hole.w; x++) {
        const c = cellAt(hole, { x, y });
        const cx = x + 0.5;
        const cy = y + 0.5;
        if (c.t === 'tree') {
          icons.appendChild(treeIcon(cx, cy, c.v ?? 0));
          continue;
        }
        if (c.slope !== undefined) {
          const a = c.slope * 45;
          el(
            'path',
            { d: 'M0 -0.17 L0.15 0.11 L-0.15 0.11 Z', fill: '#6f6f72', transform: `translate(${cx} ${cy}) rotate(${a})` },
            icons,
          );
          continue;
        }
        el('circle', { cx, cy, r: 0.055, fill: c.t === 'water' ? '#a9abae' : c.t === 'fairway' ? '#a3a3a0' : '#8f8f8c' }, dots);
      }
    // Tee (printed ball) and cup.
    el('circle', { cx: hole.tee.x + 0.5, cy: hole.tee.y + 0.5, r: 0.24, fill: '#fbfaf6', stroke: INK, 'stroke-width': 0.085 }, icons);
    el('circle', { cx: hole.cup.x + 0.5, cy: hole.cup.y + 0.5, r: 0.3, fill: 'url(#pg-cup)' }, icons);
    this.shotsLayer.replaceChildren();
    this.ballsLayer.replaceChildren();
    this.targetsLayer.replaceChildren();
  }

  /** Union of all cells of terrain t, with rounded outer corners (like the printed blobs). */
  private regionPath(hole: Hole, t: Terrain): string {
    const same = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < hole.w && y < hole.h && cellAt(hole, { x, y }).t === t;
    const r = 0.36;
    const e = 0.02;
    let d = '';
    for (let y = 0; y < hole.h; y++)
      for (let x = 0; x < hole.w; x++) {
        if (!same(x, y)) continue;
        const L = same(x - 1, y);
        const R = same(x + 1, y);
        const U = same(x, y - 1);
        const D = same(x, y + 1);
        const tl = !L && !U ? r : 0;
        const tr = !R && !U ? r : 0;
        const br = !R && !D ? r : 0;
        const bl = !L && !D ? r : 0;
        const x0 = x - (L ? e : 0);
        const x1 = x + 1 + (R ? e : 0);
        const y0 = y - (U ? e : 0);
        const y1 = y + 1 + (D ? e : 0);
        d +=
          `M${x0 + tl} ${y0}H${x1 - tr}` +
          (tr ? `A${tr} ${tr} 0 0 1 ${x1} ${y0 + tr}` : '') +
          `V${y1 - br}` +
          (br ? `A${br} ${br} 0 0 1 ${x1 - br} ${y1}` : '') +
          `H${x0 + bl}` +
          (bl ? `A${bl} ${bl} 0 0 1 ${x0} ${y1 - bl}` : '') +
          `V${y0 + tl}` +
          (tl ? `A${tl} ${tl} 0 0 1 ${x0 + tl} ${y0}` : '') +
          'Z';
      }
    return d;
  }

  /** Redraw every finished shot of every player (static). */
  renderShots(state: GameState) {
    this.shotsLayer.replaceChildren();
    this.inkSvg.replaceChildren();
    state.balls.forEach((b, i) => this.drawBallHistory(b, state.players[i].color, i));
  }

  private drawBallHistory(b: BallState, color: string, player: number) {
    b.shots.forEach((s, k) => {
      const seed = player * 1000 + k * 17 + 1;
      this.stroke(wobblyLine(s.from, s.landing, seed), color);
      if (s.rolled) this.stroke(wobblyLine(s.landing, s.end, seed + 5), color, true);
      if (!s.holed || s.rolled) this.stroke(sketchCircle(s.landing, 0.27, seed + 9), color);
    });
  }

  private stroke(d: string, color: string, dashed = false, layer: Element = this.shotsLayer): SVGPathElement {
    return el(
      'path',
      {
        d,
        fill: 'none',
        stroke: this.graphite(color),
        'stroke-width': 0.08,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: 0.9,
        ...(dashed ? { 'stroke-dasharray': '0.12 0.14' } : {}),
      },
      layer,
    );
  }

  /** Start a progressively revealed stroke (line or circle). */
  liveStroke(d: string, color: string, dashed = false): LiveStroke {
    const path = this.stroke(d, color, false, this.inkSvg);
    // All geometry/layout reads happen here, once: a lookup table of the path's points in screen space and the
    // board's screen transform. Animation frames then only write styles.
    const len = path.getTotalLength();
    const ctm = this.svg.getScreenCTM();
    const N = 48;
    const pts: ScreenPt[] = [];
    for (let i = 0; i <= N; i++) {
      const p = path.getPointAtLength((len * i) / N);
      pts.push(ctm ? { x: ctm.a * p.x + ctm.c * p.y + ctm.e, y: ctm.b * p.x + ctm.d * p.y + ctm.f } : { x: 0, y: 0 });
    }
    path.style.strokeDasharray = `${len} ${len + 1}`;
    path.style.strokeDashoffset = `${len}`;
    let last = -1;
    return {
      path,
      set: (t: number) => {
        if (t >= 1) {
          path.style.strokeDasharray = dashed ? '0.12 0.14' : '';
          path.style.strokeDashoffset = '';
          return;
        }
        // Skip sub-pixel-ish updates: no point repainting for an unchanged frame.
        const off = Math.round(len * (1 - t) * 400) / 400;
        if (off === last) return;
        last = off;
        path.style.strokeDashoffset = `${off}`;
      },
      tip: (t: number) => {
        const f = Math.min(1, Math.max(0, t)) * N;
        const i = Math.min(N - 1, Math.floor(f));
        const k = f - i;
        return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
      },
    };
  }

  renderBalls(state: GameState, hidden: number | null = null) {
    this.ballsLayer.replaceChildren();
    this.rings.querySelectorAll('.pulse').forEach((r) => r.remove());
    const groups = new Map<string, number[]>();
    state.balls.forEach((b, i) => {
      if (b.holed || b.pickedUp || i === hidden) return;
      const k = `${b.pos.x},${b.pos.y}`;
      groups.set(k, [...(groups.get(k) ?? []), i]);
    });
    for (const idxs of groups.values()) {
      idxs.forEach((i, j) => {
        const b = state.balls[i];
        const off = idxs.length > 1 ? (j - (idxs.length - 1) / 2) * 0.22 : 0;
        const active = i === state.current && !state.holeDone;
        const c = center(b.pos);
        if (active) this.ring({ x: c.x + off, y: c.y }, state.players[i].color, 'pulse');
        el(
          'circle',
          {
            cx: c.x + off,
            cy: c.y,
            r: 0.25,
            fill: '#fdfcf8',
            stroke: state.players[i].color,
            'stroke-width': active ? 0.1 : 0.075,
          },
          this.ballsLayer,
        );
      });
    }
  }

  setTargets(moves: MoveOption[], from: P, color: string, onPick: (m: MoveOption) => void) {
    this.clearTargets();
    const seen = new Set<string>();
    const F = center(from);
    // Guides first so the markers sit on top.
    const guides = el('g', { class: 'guides' }, this.targetsLayer);
    const marks = el('g', {}, this.targetsLayer);
    const sorted = [...moves].sort((a, b) => (a.kind === 'putt' ? 1 : 0) - (b.kind === 'putt' ? 1 : 0));
    for (const m of sorted) {
      const key = `${m.result.landing.x},${m.result.landing.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const L = center(m.result.landing);
      el(
        'line',
        { x1: F.x, y1: F.y, x2: L.x, y2: L.y, stroke: color, 'stroke-width': 0.035, 'stroke-dasharray': '0.04 0.12', 'stroke-linecap': 'round', opacity: m.kind === 'putt' ? 0.35 : 0.55 },
        guides,
      );
      const g = el('g', { class: `target ${m.kind}${m.result.holed ? ' holes' : ''}`, tabindex: 0, role: 'button' }, marks);
      g.setAttribute(
        'aria-label',
        `${m.kind === 'putt' ? 'Putt' : 'Hit'} ${m.dist} ${['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'][m.dir]}${m.result.holed ? ' — holes out' : ''}`,
      );
      el('circle', { cx: L.x, cy: L.y, r: 0.5, fill: 'transparent', class: 'hit' }, g);
      el(
        'circle',
        {
          cx: L.x,
          cy: L.y,
          r: m.result.holed ? 0.42 : m.kind === 'putt' ? 0.2 : 0.28,
          fill: m.result.holed ? 'none' : color,
          'fill-opacity': m.kind === 'putt' ? 0.12 : 0.2,
          // The hole-out ring spins, so it is drawn on the compositor ring layer instead.
          stroke: m.result.holed ? 'none' : color,
          'stroke-width': 0.06,
          'stroke-dasharray': m.kind === 'putt' ? '0.08 0.08' : '',
          class: 'mark',
        },
        g,
      );
      if (m.result.holed) this.ring(L, color, 'target-ring', true);
      if (m.result.rolled && !m.result.holed) {
        const E = center(m.result.end);
        el('line', { x1: L.x, y1: L.y, x2: E.x, y2: E.y, stroke: color, 'stroke-width': 0.04, opacity: 0.5, 'stroke-dasharray': '0.06 0.06' }, g);
      }
      const pick = (ev: Event) => {
        ev.preventDefault();
        onPick(m);
      };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (ev) => {
        const k = (ev as KeyboardEvent).key;
        if (k === 'Enter' || k === ' ') pick(ev);
      });
    }
  }

  clearTargets() {
    this.targetsLayer.replaceChildren();
    this.rings.querySelectorAll('.target-ring').forEach((r) => r.remove());
  }

  private toScreenRaw(x: number, y: number): ScreenPt {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(x, y).matrixTransform(ctm);
    return { x: pt.x, y: pt.y };
  }

  /** Screen position (CSS px) of a grid dot. */
  toScreen(p: P): ScreenPt {
    return this.toScreenRaw(p.x + 0.5, p.y + 0.5);
  }

  cellPx(): number {
    return this.svg.getScreenCTM()?.a ?? 24;
  }

  get currentHole() {
    return this.hole;
  }
}

let grain = '';
/** A tiny paper-coloured speckle tile, rendered once and reused by every graphite stroke pattern. */
function grainUrl(): string {
  if (grain) return grain;
  const s = 48;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  if (!g) return (grain = 'data:,');
  const img = g.createImageData(s, s);
  let seed = 3;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < s * s; i++) {
    const v = rnd();
    img.data[i * 4] = 251;
    img.data[i * 4 + 1] = 250;
    img.data[i * 4 + 2] = 246;
    // Mostly solid graphite with scattered paper showing through, like a soft pencil on tooth.
    img.data[i * 4 + 3] = v > 0.72 ? Math.round((v - 0.72) * 700) : 0;
  }
  g.putImageData(img, 0, 0);
  return (grain = c.toDataURL());
}

function treeIcon(cx: number, cy: number, variant: number): SVGGElement {
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('transform', `translate(${cx} ${cy})`);
  g.setAttribute('fill', '#47474a');
  if (variant === 0) {
    // Pine: stacked triangles.
    el('path', { d: 'M0 -0.4 L0.2 -0.1 L0.12 -0.1 L0.28 0.16 L-0.28 0.16 L-0.12 -0.1 L-0.2 -0.1 Z' }, g);
    el('rect', { x: -0.045, y: 0.14, width: 0.09, height: 0.16 }, g);
  } else {
    // Round broadleaf.
    el('ellipse', { cx: 0, cy: -0.1, rx: 0.27, ry: 0.22 }, g);
    el('rect', { x: -0.045, y: 0.06, width: 0.09, height: 0.24 }, g);
  }
  return g;
}
