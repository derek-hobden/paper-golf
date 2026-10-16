import { itemAt } from '../engine/assert';
import { cellAt, onGreen } from '../engine/rules';
import type { Hole, P, Terrain, Wind } from '../engine/types';
import { playerMarks, type BallState, type GameState, type MoveOption } from '../game/game';
import { playerInk } from '../game/ink';
import type { ScreenPt } from './fx';
import { ballBody, ballDefs, ballLight, shadowInner } from './golfball';
import { hitRadius, nearestWithin } from './hit';
import type { Bounds } from './flight';
import { center, rollDots, rollLine, sketchCircle, windCurve, wobblyLine } from './sketch';
import { WindSwirls } from './swirls';

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
}

const INK = '#3d3d40';

/** Spoken direction names, indexed by `Dir`. */
const DIR_WORDS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;

/** One drawn pencil line that can be revealed progressively. */
export interface LiveStroke {
  path: SVGPathElement;
  /** Plain function properties (not methods), so they can be passed around unbound. */
  set: (t: number) => void;
  tip: (t: number) => ScreenPt;
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
  private swirls: WindSwirls;

  constructor(container: HTMLElement) {
    // The patterned terrain is the costliest thing to rasterise, so it gets its own static layer: shots, balls and
    // targets change every turn and live in a transparent SVG on top, which repaints alone.
    this.terrainSvg = el('svg', { class: 'board board-terrain', 'aria-hidden': 'true' });
    const tdefs = el('defs', {}, this.terrainSvg);
    tdefs.innerHTML = `
      <pattern id="pg-stipple" patternUnits="userSpaceOnUse" width="0.5" height="0.5">
        <rect width="0.5" height="0.5" style="fill:var(--t-rough)"/>
        <g style="fill:var(--t-rough-fleck)">
          <circle cx="0.07" cy="0.11" r="0.018"/>
          <circle cx="0.31" cy="0.06" r="0.014"/>
          <circle cx="0.21" cy="0.29" r="0.016"/>
          <circle cx="0.43" cy="0.37" r="0.015"/>
          <circle cx="0.12" cy="0.44" r="0.013"/>
          <circle cx="0.39" cy="0.19" r="0.012"/>
        </g>
      </pattern>
      <pattern id="pg-hatch" patternUnits="userSpaceOnUse" width="0.2" height="0.2" patternTransform="rotate(45)">
        <rect width="0.2" height="0.2" style="fill:var(--t-sand)"/>
        <line x1="0" y1="0" x2="0" y2="0.2" stroke-width="0.045" style="stroke:var(--t-sand-line)"/>
      </pattern>
      <pattern id="pg-water" patternUnits="userSpaceOnUse" width="0.5" height="0.5">
        <rect width="0.5" height="0.5" style="fill:var(--t-water)"/>
        <circle cx="0.1" cy="0.2" r="0.02" style="fill:var(--t-water-dark)"/>
        <circle cx="0.35" cy="0.4" r="0.02" style="fill:var(--t-water-light)"/>
      </pattern>
      <radialGradient id="pg-cup" cx="0.4" cy="0.35" r="0.7">
        <stop offset="0" stop-color="#555"/>
        <stop offset="1" stop-color="#2b2b2b"/>
      </radialGradient>`;
    this.terrain = el('g', { class: 'terrain' }, this.terrainSvg);
    container.appendChild(this.terrainSvg);
    // Wind swirls: a canvas over the course and under the play layer (targets, lines, balls), never taking taps.
    const windCanvas = document.createElement('canvas');
    windCanvas.className = 'board-wind';
    windCanvas.setAttribute('aria-hidden', 'true');
    container.appendChild(windCanvas);
    this.swirls = new WindSwirls(windCanvas);
    this.svg = el('svg', { class: 'board board-play', role: 'img', 'aria-label': 'Golf hole' });
    this.defs = el('defs', {}, this.svg);
    // The golf ball and its pencil shadow are drawn once as symbols; each resting ball is a cheap <use>.
    this.defs.innerHTML = `
      ${ballDefs('pg-ball')}
      <symbol id="pg-ball" viewBox="-50 -50 100 100" overflow="visible">${ballBody()}${ballLight('pg-ball', 0)}</symbol>
      <symbol id="pg-ball-shadow" viewBox="-50 -30 100 60" overflow="visible">${shadowInner('pg-bs')}</symbol>`;
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
    const tick = () => {
      if (++n < 6) requestAnimationFrame(tick);
      else warm.remove();
    };
    requestAnimationFrame(tick);
  }

  /** Graphite: the player's colour broken up by a fixed paper-grain speckle, as a cached stroke pattern. */
  private graphite(color: string): string {
    let id = this.graphites.get(color);
    if (!id) {
      id = `pg-graphite-${String(this.graphites.size)}`;
      this.graphites.set(color, id);
      const p = el('pattern', { id, patternUnits: 'userSpaceOnUse', width: 0.8, height: 0.8 }, this.defs);
      el('rect', { width: 0.8, height: 0.8, style: `fill:${color}` }, p);
      el('image', { href: grainUrl(), width: 0.8, height: 0.8, preserveAspectRatio: 'none' }, p);
    }
    return `url(#${id})`;
  }

  /** A ring positioned over a grid dot, in board percentages so it follows any resize without JS. */
  private ring(c: { x: number; y: number }, color: string, cls: string, dashed = false): HTMLDivElement {
    const h = this.hole;
    if (!h) throw new Error('Board: ring() called before setHole()');
    const d = document.createElement('div');
    d.className = `ring ${cls}`;
    d.style.left = `${String(((c.x - 0.5) / h.w) * 100)}%`;
    d.style.top = `${String(((c.y - 0.5) / h.h) * 100)}%`;
    d.style.width = `${String(100 / h.w)}%`;
    d.style.height = `${String(100 / h.h)}%`;
    d.innerHTML = `<svg viewBox="-0.5 -0.5 1 1"><circle r="0.42" fill="none" style="stroke:${color}" stroke-width="${dashed ? '0.09' : '0.04'}" ${
      dashed ? 'stroke-dasharray="0.16 0.1"' : ''
    }/></svg>`;
    this.rings.appendChild(d);
    return d;
  }

  setHole(hole: Hole) {
    this.hole = hole;
    const viewBox = `0 0 ${String(hole.w)} ${String(hole.h)}`;
    this.svg.setAttribute('viewBox', viewBox);
    this.inkSvg.setAttribute('viewBox', viewBox);
    this.terrainSvg.setAttribute('viewBox', viewBox);
    this.inkSvg.replaceChildren();
    this.rings.replaceChildren();
    this.terrain.replaceChildren();
    // Rough is the darker stippled ground under everything; the fairway is lighter, cut out of it in plain paper.
    el('rect', { width: hole.w, height: hole.h, fill: 'url(#pg-stipple)', class: 't-rough' }, this.terrain);
    // The fairway (tee box included) is a very slightly off-white; the green round the cup is pure white on top of
    // it, so it stands out. Sand and water keep their own look on the green.
    const fills = {
      fairway: 'var(--t-fairway)',
      sand: 'url(#pg-hatch)',
      water: 'url(#pg-water)',
    } satisfies Partial<Record<Terrain, string>>;
    const terrainIs = (t: Terrain) => (p: P) => cellAt(hole, p).t === t;
    el('path', { d: this.regionPath(hole, terrainIs('fairway')), style: `fill:${fills.fairway}`, class: 't-fairway' }, this.terrain);
    const green = (p: P) => onGreen(hole, p) && (cellAt(hole, p).t === 'fairway' || cellAt(hole, p).t === 'rough');
    el('path', { d: this.regionPath(hole, green), style: 'fill:var(--t-green)', class: 't-green' }, this.terrain);
    for (const t of ['sand', 'water'] as const) {
      el('path', { d: this.regionPath(hole, terrainIs(t)), fill: fills[t], class: `t-${t}` }, this.terrain);
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
            { d: 'M0 -0.17 L0.15 0.11 L-0.15 0.11 Z', style: 'fill:var(--t-slope)', transform: `translate(${String(cx)} ${String(cy)}) rotate(${String(a)})` },
            icons,
          );
          continue;
        }
        el('circle', { cx, cy, r: 0.055, style: `fill:var(--t-dot-${c.t === 'water' || c.t === 'fairway' ? c.t : 'rough'})` }, dots);
      }
    // Tee (printed ball) and cup.
    el('circle', { cx: hole.tee.x + 0.5, cy: hole.tee.y + 0.5, r: 0.24, fill: '#fbfaf6', stroke: INK, 'stroke-width': 0.085 }, icons);
    const cx = hole.cup.x + 0.5;
    const cy = hole.cup.y + 0.5;
    // The cup has a white rim and a flag.
    el('circle', { cx, cy, r: 0.38, class: 'cup-rim' }, icons);
    el('circle', { cx, cy, r: 0.3, fill: 'url(#pg-cup)' }, icons);
    const flag = el('g', { class: 'flag', transform: `translate(${String(cx + 0.06)} ${String(cy - 0.06)})` }, icons);
    el('line', { x1: 0, y1: 0, x2: 0, y2: -0.95, 'stroke-width': 0.05, 'stroke-linecap': 'round', class: 'flag-pole' }, flag);
    el('path', { d: 'M0.02 -0.95 L0.46 -0.81 L0.02 -0.66 Z', class: 'flag-cloth' }, flag);
    this.shotsLayer.replaceChildren();
    this.ballsLayer.replaceChildren();
    this.targetsLayer.replaceChildren();
  }

  /** Blow this hole's wind across the board (pencil swirls); `still` (reduced motion) or calm shows none. */
  setWind(wind: Wind, still: boolean) {
    this.swirls.set(wind, this.size(), this.hole?.seed ?? 0, still);
  }

  /** Re-fit the wind canvas to the board's size, after a layout change. */
  fitWind() {
    this.swirls.fit();
  }

  /** Union of all cells matching `inRegion`, with rounded outer corners (like the printed blobs). */
  private regionPath(hole: Hole, inRegion: (p: P) => boolean): string {
    const same = (x: number, y: number) => x >= 0 && y >= 0 && x < hole.w && y < hole.h && inRegion({ x, y });
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
          `M${String(x0 + tl)} ${String(y0)}H${String(x1 - tr)}` +
          (tr ? `A${String(tr)} ${String(tr)} 0 0 1 ${String(x1)} ${String(y0 + tr)}` : '') +
          `V${String(y1 - br)}` +
          (br ? `A${String(br)} ${String(br)} 0 0 1 ${String(x1 - br)} ${String(y1)}` : '') +
          `H${String(x0 + bl)}` +
          (bl ? `A${String(bl)} ${String(bl)} 0 0 1 ${String(x0)} ${String(y1 - bl)}` : '') +
          `V${String(y0 + tl)}` +
          (tl ? `A${String(tl)} ${String(tl)} 0 0 1 ${String(x0 + tl)} ${String(y0)}` : '') +
          'Z';
      }
    return d;
  }

  /** Redraw every finished shot of every player (static). */
  renderShots(state: GameState) {
    this.shotsLayer.replaceChildren();
    this.inkSvg.replaceChildren();
    state.balls.forEach((b, i) => {
      this.drawBallHistory(b, playerInk(itemAt(state.players, i, 'player').color), i);
    });
  }

  private drawBallHistory(b: BallState, color: string, player: number) {
    b.shots.forEach((s, k) => {
      const seed = player * 1000 + k * 17 + 1;
      if (s.blown) {
        // Blown by the wind: one curve from the ball onto where it stopped, ringed there.
        this.stroke(windCurve(s.from, s.landing, s.end, seed, this.size()), color);
        if (!s.holed) this.stroke(sketchCircle(s.end, 0.27, seed + 9), color);
        return;
      }
      this.stroke(wobblyLine(s.from, s.landing, seed), color);
      if (s.rolled) this.stroke(rollLine(rollDots(s), seed + 5), color, true);
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
    const path = this.stroke(d, playerInk(color), false, this.inkSvg);
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
    path.style.strokeDasharray = `${String(len)} ${String(len + 1)}`;
    path.style.strokeDashoffset = String(len);
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
        path.style.strokeDashoffset = String(off);
      },
      tip: (t: number) => {
        const f = Math.min(1, Math.max(0, t)) * N;
        const i = Math.min(N - 1, Math.floor(f));
        const k = f - i;
        const a = itemAt(pts, i, 'stroke point');
        const b = itemAt(pts, i + 1, 'stroke point');
        return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      },
    };
  }

  renderBalls(state: GameState, hidden: number | null = null) {
    this.ballsLayer.replaceChildren();
    this.rings.querySelectorAll('.pulse').forEach((r) => {
      r.remove();
    });
    // In multiplayer each ball carries its player's mark, pencilled in their ink, so it's plain whose is furthest out.
    const marks = state.players.length > 1 ? playerMarks(state.players.map((p) => p.name)) : [];
    const groups = new Map<string, number[]>();
    state.balls.forEach((b, i) => {
      if (b.holed || b.pickedUp || i === hidden) return;
      const k = `${String(b.pos.x)},${String(b.pos.y)}`;
      groups.set(k, [...(groups.get(k) ?? []), i]);
    });
    for (const idxs of groups.values()) {
      idxs.forEach((i, j) => {
        const b = itemAt(state.balls, i, 'ball');
        const color = playerInk(itemAt(state.players, i, 'player').color);
        const off = idxs.length > 1 ? (j - (idxs.length - 1) / 2) * 0.22 : 0;
        const active = i === state.current && !state.holeDone;
        const c = center(b.pos);
        if (active) this.ring({ x: c.x + off, y: c.y }, color, 'pulse');
        const x = c.x + off;
        const g = el('g', { class: 'ball' }, this.ballsLayer);
        // Shadow peeks out down-right (light from the top-left), like the flight sprite's.
        el('use', { href: '#pg-ball-shadow', x: x - 0.14, y: c.y - 0.008, width: 0.46, height: 0.276 }, g);
        el('use', { href: '#pg-ball', x: x - 0.25, y: c.y - 0.25, width: 0.5, height: 0.5 }, g);
        // The outline is the player's pencil colour, so balls stay told apart in multiplayer.
        el(
          'circle',
          { cx: x, cy: c.y, r: 0.228, fill: 'none', style: `stroke:${color}`, 'stroke-width': active ? 0.055 : 0.042 },
          g,
        );
        const mark = marks[i];
        if (mark) {
          // Up and to the right; in a shared spot the balls shunted left get theirs on the left, a middle one's goes
          // on top, so marks don't collide.
          const side = off < 0 ? 'end' : off === 0 && idxs.length > 1 ? 'middle' : 'start';
          const mx = side === 'end' ? x - 0.28 : side === 'start' ? x + 0.28 : x;
          const t = el('text', { x: mx, y: c.y - (side === 'middle' ? 0.32 : 0.16), 'text-anchor': side, class: 'ball-mark', style: `fill:${color}` }, g);
          t.textContent = mark;
        }
      });
    }
  }

  setTargets(moves: MoveOption[], from: P, playerColor: string, onPick: (m: MoveOption) => void) {
    this.clearTargets();
    const color = playerInk(playerColor);
    const seen = new Set<string>();
    const F = center(from);
    // Guides first so the markers sit on top.
    const guides = el('g', { class: 'guides' }, this.targetsLayer);
    const marks = el('g', {}, this.targetsLayer);
    const sorted = [...moves].sort((a, b) => (a.kind === 'putt' ? 1 : 0) - (b.kind === 'putt' ? 1 : 0));
    const r = this.hitR();
    const spots: { c: { x: number; y: number }; m: MoveOption }[] = [];
    const owners = new Map<Element, MoveOption>();
    for (const m of sorted) {
      // The marker sits where the ball will really stop (after any slope roll or wind push), not where it lands.
      const key = `${String(m.result.end.x)},${String(m.result.end.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const T = center(m.result.landing);
      const L = center(m.result.end);
      const guide = { style: `stroke:${color}`, 'stroke-width': 0.035, 'stroke-dasharray': '0.04 0.12', 'stroke-linecap': 'round', opacity: m.kind === 'putt' ? 0.35 : 0.55 };
      if (m.result.blown) {
        // The wind bends the line: it leaves the ball heading where the shot is aimed and ends on its marker.
        // A touch bolder than a straight guide, so the bend reads on a phone.
        el('path', { ...guide, d: windCurve(from, m.result.landing, m.result.end, m.dir, this.size()), fill: 'none', class: 'wind-curve', 'stroke-width': 0.055, 'stroke-dasharray': '0.07 0.1', opacity: 0.75 }, guides);
      } else el('line', { ...guide, x1: F.x, y1: F.y, x2: T.x, y2: T.y }, guides);
      if (m.result.rolled && !m.result.blown) {
        // Touchdown: a faint dot, then a dashed line down the slope chain to the marker where the ball comes to rest.
        const points = rollDots(m.result)
          .map((p) => `${String(center(p).x)},${String(center(p).y)}`)
          .join(' ');
        el('circle', { cx: T.x, cy: T.y, r: 0.1, style: `fill:${color}`, opacity: 0.4 }, guides);
        el('polyline', { points, fill: 'none', class: 'roll-guide', style: `stroke:${color}`, 'stroke-width': 0.04, opacity: 0.5, 'stroke-dasharray': '0.06 0.06' }, guides);
      }
      const g = el('g', { class: `target ${m.kind}${m.result.holed ? ' holes' : ''}`, tabindex: 0, role: 'button' }, marks);
      g.setAttribute(
        'aria-label',
        `${m.kind === 'putt' ? 'Putt' : 'Hit'} ${String(m.dist)} ${DIR_WORDS[m.dir]}${m.result.holed ? ' — holes out' : ''}`,
      );
      // Invisible hit circle, >= 44 CSS px across even when cells are tiny (phones); overlaps go to the nearest.
      el('circle', { cx: L.x, cy: L.y, r, fill: 'transparent', class: 'hit' }, g);
      spots.push({ c: L, m });
      owners.set(g, m);
      el(
        'circle',
        {
          cx: L.x,
          cy: L.y,
          r: m.result.holed ? 0.42 : m.kind === 'putt' ? 0.2 : 0.28,
          'fill-opacity': m.kind === 'putt' ? 0.12 : 0.2,
          // The hole-out ring spins, so it is drawn on the compositor ring layer instead.
          style: m.result.holed ? 'fill:none;stroke:none' : `fill:${color};stroke:${color}`,
          'stroke-width': 0.06,
          'stroke-dasharray': m.kind === 'putt' ? '0.08 0.08' : '',
          class: 'mark',
        },
        g,
      );
      if (m.result.holed) this.ring(L, color, 'target-ring', true);
      g.addEventListener('keydown', (ev) => {
        const k = ev.key;
        if (k === 'Enter' || k === ' ') {
          ev.preventDefault();
          onPick(m);
        }
      });
    }
    // One tap handler for all markers: the nearest marker within reach wins, whichever circle is on top.
    marks.addEventListener('click', (ev) => {
      ev.preventDefault();
      const p = this.fromScreen(ev.clientX, ev.clientY);
      const i = p ? nearestWithin(spots.map((s) => s.c), p, this.hitR()) : -1;
      const hit = spots[i]?.m ?? (ev.target instanceof Element ? owners.get(ev.target.closest('.target') ?? ev.target) : undefined);
      if (hit) onPick(hit);
    });
  }

  /** Current hit radius in board units (cells change size when the window does). */
  private hitR(): number {
    return hitRadius(this.cellPx());
  }

  /** Re-fit the markers' hit circles to the current cell size, after a resize. */
  fitHits() {
    const r = String(this.hitR());
    this.targetsLayer.querySelectorAll('circle.hit').forEach((c) => {
      c.setAttribute('r', r);
    });
  }

  /** Board coordinates of a screen (CSS px) point. */
  private fromScreen(x: number, y: number): { x: number; y: number } | null {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return null;
    const pt = new DOMPoint(x, y).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  clearTargets() {
    this.targetsLayer.replaceChildren();
    this.rings.querySelectorAll('.target-ring').forEach((r) => {
      r.remove();
    });
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

  /** The board's size in dots (for wind curves aimed off the page). */
  size(): Bounds {
    return { w: this.hole?.w ?? 0, h: this.hole?.h ?? 0 };
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
  g.setAttribute('transform', `translate(${String(cx)} ${String(cy)})`);
  g.setAttribute('style', 'fill:var(--t-tree)');
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
