/**
 * Full-screen 2D overlay for the animated touches: a tumbling d6, a crumpled paper ball arcing over the page,
 * and a pencil that draws the lines. Every sprite is a small, pre-drawn DOM/SVG element that is only ever moved
 * with `transform`/`opacity`, so the compositor does the work and nothing is re-rasterised per frame.
 * Coordinates are CSS pixels, top-left origin.
 */

import { flightDuration, flightPos, type FlightLeg } from './flight';

export interface ScreenPt {
  x: number;
  y: number;
}

type Tween = { start: number; dur: number; update: (t: number) => void; resolve: () => void };

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const DEG = 180 / Math.PI;

const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.27, 0.27],
    [0.5, 0.5],
    [0.73, 0.73],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.27, 0.25],
    [0.73, 0.25],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.75],
    [0.73, 0.75],
  ],
};

const pipsSvg = (v: number) =>
  `<svg viewBox="0 0 100 100" aria-hidden="true">${PIPS[v]
    .map(([x, y]) => `<circle cx="${x * 100}" cy="${y * 100}" r="9.5" fill="#e9efe6"/><circle cx="${x * 100 - 1.2}" cy="${y * 100 - 1.2}" r="8.5" fill="#fff"/>`)
    .join('')}</svg>`;

/** Faces that can roll onto each other (anything but itself and its opposite; opposite faces sum to 7). */
const neighbours = (v: number) => [1, 2, 3, 4, 5, 6].filter((n) => n !== v && n !== 7 - v);

/** A crumpled paper ball: irregular facets in paper greys, drawn once. */
function paperBallSvg(): string {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const n = 11;
  const outer: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.3;
    const r = 44 + rnd() * 6;
    outer.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
  }
  const inner: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd();
    const r = 12 + rnd() * 14;
    inner.push([50 + Math.cos(a) * r, 50 + Math.sin(a) * r]);
  }
  const greys = ['#fbf9f3', '#f1eee5', '#e6e2d7', '#f7f4ec', '#ddd8cb', '#efebe1'];
  const tri = (p: [number, number][]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  let polys = '';
  for (let i = 0; i < n; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % n];
    const c = inner[Math.floor((i / n) * 5)];
    polys += `<polygon points="${tri([a, b, c])}" fill="${greys[Math.floor(rnd() * greys.length)]}"/>`;
  }
  for (let i = 0; i < 5; i++)
    polys += `<polygon points="${tri([inner[i], inner[(i + 1) % 5], [50, 50]])}" fill="${greys[Math.floor(rnd() * greys.length)]}"/>`;
  const creases = Array.from({ length: 7 }, (_, i) => {
    const a = outer[(i * 3) % n];
    const c = inner[i % 5];
    return `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${c[0].toFixed(1)}" y2="${c[1].toFixed(1)}"/>`;
  }).join('');
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
    <g stroke="#cfc9ba" stroke-width="0.8" stroke-linejoin="round">${polys}</g>
    <g stroke="#bdb6a5" stroke-width="0.7" opacity="0.7">${creases}</g>
    <polygon points="${tri(outer)}" fill="none" stroke="#b9b2a2" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}

// The pencil leans back towards the viewer and to the right: tip at (PT_X, PT_Y), eraser up and to the right.
const PT_X = 6;
const PT_Y = 92;
const PENCIL_SVG = `<svg width="132" height="100" viewBox="0 0 132 100" aria-hidden="true">
  <defs>
    <linearGradient id="fx-pshadow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#3c2a14" stop-opacity="0.3"/><stop offset="1" stop-color="#3c2a14" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="fx-pbody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#4a4a50"/><stop offset="0.45" stop-color="#232326"/><stop offset="1" stop-color="#121214"/>
    </linearGradient>
  </defs>
  <path d="M${PT_X} ${PT_Y} L74 88 L76 96 Z" fill="url(#fx-pshadow)"/>
  <g transform="translate(${PT_X} ${PT_Y}) rotate(-33)">
    <path d="M0 0 L5 -1.4 L5 1.4 Z" fill="#3a3a3d"/>
    <path d="M4.6 -1.6 L20 -5 L20 5 L4.6 1.6 Z" fill="#e2c08f"/>
    <path d="M4.6 -0.2 L20 -1 L20 5 L4.6 1.6 Z" fill="#cfa66e"/>
    <path d="M20 -5 L118 -7.5 L118 7.5 L20 5 Z" fill="url(#fx-pbody)"/>
    <path d="M20 -1.8 L118 -2.6" stroke="#5b5b62" stroke-width="1"/>
    <rect x="118" y="-8" width="11" height="16" rx="1.5" fill="#b9bcc2"/>
    <path d="M120.5 -8 V8 M124 -8 V8" stroke="#8f9298" stroke-width="0.9"/>
    <rect x="128.5" y="-7.6" width="10" height="15.2" rx="4" fill="#e98b8b"/>
  </g>
</svg>`;

function div(cls: string, parent: HTMLElement, html = ''): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  parent.appendChild(d);
  return d;
}

export class Fx {
  private tweens: Tween[] = [];
  private raf = 0;
  private w = 1;

  private die: HTMLDivElement;
  private dieRoller: HTMLDivElement;
  private faceA: HTMLDivElement;
  private faceB: HTMLDivElement;
  private shadeA: HTMLDivElement;
  private shadeB: HTMLDivElement;
  private dieShadow: HTMLDivElement;
  private faceVals: [number, number] = [0, 0];
  private dieShown = false;
  private dieSize = 54;

  private ball: HTMLDivElement;
  private ballSpin: HTMLDivElement;
  private blob: HTMLDivElement;
  private pencil: HTMLDivElement;
  private pencilShown = false;
  private pencilAt: ScreenPt = { x: 0, y: 0 };

  /** Always on: plain DOM needs no WebGL. Kept for the caller's fallback paths. */
  readonly enabled = true;
  /** Respect reduced-motion: much shorter animations and no tumbling. */
  speed = 1;
  readonly reduced: boolean;

  constructor(root: HTMLElement) {
    this.dieShadow = div('fx-shadow', root);
    this.die = div('fx-die', root);
    this.dieRoller = div('fx-roller', this.die);
    this.faceB = div('fx-face', this.dieRoller);
    this.faceA = div('fx-face', this.dieRoller);
    this.shadeB = div('fx-shade', this.faceB);
    this.shadeA = div('fx-shade', this.faceA);
    this.blob = div('fx-shadow fx-blob', root);
    this.ball = div('fx-ball', root);
    this.ballSpin = div('fx-ball-spin', this.ball, paperBallSvg());
    div('fx-ball-light', this.ball);
    this.pencil = div('fx-pencil', root, PENCIL_SVG);
    for (const e of [this.die, this.dieShadow, this.ball, this.blob, this.pencil]) e.style.opacity = '0';
    this.setFace(this.faceA, 0, 1);
    this.setFace(this.faceB, 1, 2);
    this.sizeDie(54);
    this.warmUp();

    this.reduced = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.reduced) this.speed = 0.25;
    this.resize();
  }

  resize() {
    this.w = window.innerWidth;
  }

  /**
   * Rasterise every sprite once at load, invisibly (1% opacity for a few frames, while nothing else is going on),
   * so the first roll and first shot don't pay for first-time raster/shader setup mid-animation.
   */
  private warmUp() {
    const sprites = [this.die, this.dieShadow, this.ball, this.blob, this.pencil];
    const show = () => {
      this.rollFaces(0.6);
      this.shadeA.style.opacity = this.shadeB.style.opacity = '0.3';
      this.placeDieAt(window.innerWidth / 2, window.innerHeight - 60, 0, 10, 0.01);
      this.sizeBall(8);
      this.placeBall(window.innerWidth / 2, window.innerHeight - 60, 8, 0, 0);
      this.pencil.style.transform = `translate(${window.innerWidth / 2}px, ${window.innerHeight - 160}px)`;
      for (const e of sprites) e.style.opacity = '0.01';
    };
    const hide = () => {
      // A real animation already took the sprites over: leave them alone.
      if (this.tweens.length || this.dieShown || this.pencilShown) return;
      for (const e of sprites) e.style.opacity = '0';
      this.rollFaces(0);
    };
    const later = (fn: () => void) =>
      'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300);
    later(() => {
      show();
      // Hold for a few frames so the raster actually lands.
      let n = 0;
      const tick = () => (++n < 6 ? requestAnimationFrame(tick) : hide());
      requestAnimationFrame(tick);
    });
  }

  private loop = (now: number) => {
    this.raf = 0;
    const done: Tween[] = [];
    for (const tw of this.tweens) {
      if (!tw.start) tw.start = now;
      const t = Math.min(1, (now - tw.start) / tw.dur);
      tw.update(t);
      if (t >= 1) done.push(tw);
    }
    if (done.length) this.tweens = this.tweens.filter((tw) => !done.includes(tw));
    done.forEach((tw) => tw.resolve());
    if (this.tweens.length) this.raf = requestAnimationFrame(this.loop);
  };

  tween(durMs: number, update: (t: number) => void): Promise<void> {
    const dur = Math.max(1, durMs * this.speed);
    return new Promise((resolve) => {
      this.tweens.push({ start: 0, dur, update, resolve });
      if (!this.raf) this.raf = requestAnimationFrame(this.loop);
    });
  }

  // ---------------------------------------------------------------- die

  private setFace(el: HTMLDivElement, slot: 0 | 1, v: number) {
    if (this.faceVals[slot] === v) return;
    this.faceVals[slot] = v;
    // Pips go under the shade overlay.
    el.querySelector('svg')?.remove();
    el.insertAdjacentHTML('afterbegin', pipsSvg(v));
  }

  private sizeDie(size: number) {
    if (size === this.dieSize && this.die.style.width) return;
    this.dieSize = size;
    for (const e of [this.die, this.dieShadow]) {
      e.style.width = e.style.height = `${size}px`;
      e.style.marginLeft = e.style.marginTop = `${-size / 2}px`;
    }
    this.die.style.setProperty('--r', `${size * 0.2}px`);
  }

  /**
   * Orthographic cube rolling along the roller's x axis: the face coming up (A) is cos(φ) wide, the face going
   * down (B) is sin(φ) wide, side by side. φ = 0 shows A flat on top.
   */
  private rollFaces(phi: number) {
    const s = this.dieSize;
    const c = Math.max(0.0001, Math.cos(phi));
    const sn = Math.max(0.0001, Math.sin(phi));
    const w = s * (c + sn);
    // Rolling towards +x: the old face (B) tips over the leading edge while the new one (A) comes up behind it.
    this.faceB.style.transform = `translateX(${w / 2 - (s * sn) / 2}px) scaleX(${sn})`;
    this.faceA.style.transform = `translateX(${-w / 2 + (s * c) / 2}px) scaleX(${c})`;
    this.shadeA.style.opacity = `${(1 - c) * 0.45}`;
    this.shadeB.style.opacity = `${(1 - sn) * 0.45}`;
  }

  private placeDieAt(x: number, y: number, lift: number, angle: number, opacity = 1) {
    const s = this.dieSize;
    const k = 1 + lift / (s * 5);
    this.die.style.transform = `translate(${x}px, ${y - lift * 0.8}px) rotate(${angle}deg) scale(${k})`;
    this.dieShadow.style.transform = `translate(${x + 3 + lift * 0.1}px, ${y + s * 0.1 + lift * 0.05}px) scale(${1.1 + lift / (s * 6)}, ${0.95 + lift / (s * 8)})`;
    this.die.style.opacity = `${opacity}`;
    this.dieShadow.style.opacity = `${opacity * 0.5 * (1 - Math.min(0.7, lift / (s * 3)))}`;
  }

  /** Throw the die so it tumbles in and comes to rest at `at`, showing `value` on top. */
  async rollDie(value: number, at: ScreenPt, size = 54): Promise<void> {
    this.sizeDie(size);
    this.dieShown = true;
    const restAngle = (Math.random() - 0.5) * 30;
    this.setFace(this.faceA, 0, value);
    if (this.reduced) {
      this.rollFaces(0);
      await this.tween(600, (t) => this.placeDieAt(at.x, at.y, 0, restAngle, t));
      return;
    }
    const fromRight = at.x < this.w * 0.6;
    const sx = fromRight ? this.w + size * 2 : -size * 2;
    const sy = at.y - Math.min(220, window.innerHeight * 0.25) * (Math.random() * 0.6 + 0.4);
    // Roll along the direction of travel: the roller turns the cube's roll axis that way (in 90° steps the
    // square looks the same), and the die body keeps the leftover angle.
    const travel = Math.atan2(at.y - sy, at.x - sx) * DEG;
    const quarter = Math.round(travel / 90) * 90;
    this.dieRoller.style.transform = `rotate(${quarter}deg)`;
    const spinFrom = travel - quarter;
    // Face sequence: seq[0] is the final value, seq[i+1] rolls onto seq[i].
    const turns = 6 + Math.floor(Math.random() * 3);
    const seq = [value];
    for (let i = 0; i < turns; i++) {
      const opts = neighbours(seq[i]);
      seq.push(opts[Math.floor(Math.random() * opts.length)]);
    }
    await this.tween(1150, (t) => {
      const e = easeOutCubic(t);
      const x = lerp(sx, at.x, e);
      const y = lerp(sy, at.y, e);
      const bounce = Math.abs(Math.cos(t * Math.PI * 3.2)) * (1 - t) ** 2 * size * 1.6;
      // Rolling slows to a stop a little before the die stops sliding.
      const theta = turns * (1 - Math.min(1, easeOutCubic(Math.min(1, t * 1.12))));
      const i = Math.min(turns - 1, Math.floor(theta));
      const phi = (theta - i) * (Math.PI / 2);
      this.setFace(this.faceA, 0, seq[i]);
      this.setFace(this.faceB, 1, seq[i + 1]);
      this.rollFaces(theta <= 0 ? 0 : phi);
      this.placeDieAt(x, y, bounce, lerp(spinFrom, restAngle, e), Math.min(1, t * 6));
    });
    this.rollFaces(0);
  }

  /** Show the die already at rest (e.g. after returning from the scorecard). */
  showDieStatic(value: number, at: ScreenPt, size = 54) {
    this.sizeDie(size);
    this.dieShown = true;
    this.setFace(this.faceA, 0, value);
    this.rollFaces(0);
    this.placeDieAt(at.x, at.y, 0, (value * 7) % 13 - 6);
  }

  async hideDie(): Promise<void> {
    if (!this.dieShown) return;
    this.dieShown = false;
    const base = this.die.style.transform;
    await this.tween(260, (t) => {
      this.die.style.transform = `${base} scale(${1 + t * 0.15})`;
      this.die.style.opacity = `${1 - t}`;
      this.dieShadow.style.opacity = `${0.5 * (1 - t)}`;
    });
  }

  /** Keep a resting die glued to its slot when the layout changes. */
  placeDie(at: ScreenPt, size = 54) {
    if (!this.dieShown) return;
    this.sizeDie(size);
    this.placeDieAt(at.x, at.y, 0, 0);
  }

  // ---------------------------------------------------------------- ball + pencil

  private placeBall(gx: number, gy: number, r: number, lift: number, angle: number, scale = 1) {
    // Seen from above, sell the arc 2.5D-style: lift the ball up the page and grow it, while its blob shadow
    // stays on the ground track, spreads and fades.
    const k = (1 + lift / (r * 9)) * scale;
    this.ball.style.transform = `translate(${gx}px, ${gy - lift * 0.75}px) scale(${k})`;
    this.ballSpin.style.transform = `rotate(${angle}deg)`;
    this.blob.style.transform = `translate(${gx + lift * 0.08}px, ${gy + lift * 0.05 + r * 0.15}px) scale(${scale * (1 + lift / (r * 14))})`;
    this.blob.style.opacity = `${0.55 * (1 - Math.min(0.65, lift / (r * 10)))}`;
  }

  private sizeBall(r: number) {
    const d = r * 2;
    this.ball.style.width = this.ball.style.height = `${d}px`;
    this.ball.style.marginLeft = this.ball.style.marginTop = `${-r}px`;
    const b = r * 2.4;
    this.blob.style.width = this.blob.style.height = `${b}px`;
    this.blob.style.marginLeft = this.blob.style.marginTop = `${-b / 2}px`;
  }

  /**
   * Fly the paper ball from a to b. `onProgress` is called every frame (0..1) so the caller can draw the pencil line;
   * `tip` (if given) returns where the pencil tip should be at that moment.
   */
  async flyBall(
    a: ScreenPt,
    b: ScreenPt,
    opts: { radius: number; height: number; dur: number; onProgress?: (t: number) => void; tip?: (t: number) => ScreenPt },
  ): Promise<void> {
    const r = opts.radius;
    this.sizeBall(r);
    this.ball.style.opacity = '1';
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const spin = ((dist / r) * DEG * (b.x >= a.x ? 1 : -1)) / 2;
    if (opts.tip) this.showPencil(opts.tip(0));
    await this.tween(opts.dur, (t) => {
      const e = opts.height > 0 ? easeInOutSine(t) : easeOutCubic(t);
      const lift = 4 * opts.height * e * (1 - e);
      this.placeBall(lerp(a.x, b.x, e), lerp(a.y, b.y, e), r, lift, spin * e);
      opts.onProgress?.(e);
      if (opts.tip) this.movePencil(opts.tip(e));
    });
  }

  /**
   * Play a whole shot's flight from a to b (see `flightLegs`): carry, small bounces and roll-out as one tween, so
   * the ball comes to rest exactly on b. The ball stays there, on the ground, until hidden.
   */
  async flyShot(a: ScreenPt, b: ScreenPt, legs: FlightLeg[], radius: number): Promise<void> {
    const r = radius;
    this.sizeBall(r);
    this.ball.style.opacity = '1';
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const spin = ((dist / r) * DEG * (b.x >= a.x ? 1 : -1)) / 2;
    await this.tween(flightDuration(legs), (t) => {
      const { along, lift } = flightPos(legs, t);
      this.placeBall(lerp(a.x, b.x, along), lerp(a.y, b.y, along), r, lift, spin * along);
    });
  }

  async sinkBall(at: ScreenPt, r: number): Promise<void> {
    await this.tween(380, (t) => {
      const e = easeOutCubic(t);
      this.placeBall(at.x, at.y, r, 0, 0, 1 - 0.65 * e);
      this.ball.style.opacity = `${1 - e * 0.6}`;
    });
    this.hideBall();
  }

  hideBall() {
    this.ball.style.opacity = '0';
    this.blob.style.opacity = '0';
  }

  showPencil(at: ScreenPt) {
    this.pencilShown = true;
    this.pencil.style.opacity = '1';
    this.movePencil(at);
  }

  movePencil(at: ScreenPt) {
    // A gentle hover wobble makes it feel hand-held.
    const wob = Math.sin(performance.now() / 70) * 0.6;
    this.pencilAt = at;
    this.pencil.style.transform = `translate(${at.x + wob - PT_X}px, ${at.y - PT_Y}px)`;
  }

  async pencilTrace(onProgress: (t: number) => void, tip: (t: number) => ScreenPt, dur: number): Promise<void> {
    this.showPencil(tip(0));
    await this.tween(dur, (t) => {
      onProgress(t);
      this.movePencil(tip(t));
    });
  }

  async liftPencil(): Promise<void> {
    if (!this.pencilShown) return;
    this.pencilShown = false;
    const p = this.pencilAt;
    await this.tween(220, (t) => {
      this.pencil.style.transform = `translate(${p.x - PT_X + t * 40}px, ${p.y - PT_Y - t * 50}px) scale(${1 + t * 0.25})`;
      this.pencil.style.opacity = `${1 - t}`;
    });
  }
}
