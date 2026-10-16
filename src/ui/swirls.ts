import { mulberry32, randRange, type Rng } from '../engine/rng';
import type { Dir, Wind } from '../engine/types';
import type { Bounds } from './flight';
import { spawnEverySec, spawnSwirl, swirlPoint, windLook, type Swirl, type WindLook } from './windlook';

/** White pencil, the page's paper white (board.ts `grainUrl`), so the wind reads as chalky strokes on the grass. */
const PENCIL = [251, 250, 246] as const;
/** Opacity bands a trail is drawn in, darkest at the head; more is smoother and costs more strokes per frame. */
const BANDS = 8;
/** Trail sample spacing in board units. */
const STEP = 0.07;
/** Backing-store pixels per CSS pixel, capped so a phone's 3x screen doesn't triple the fill cost. */
const MAX_DPR = 2;

interface Live {
  s: Swirl;
  born: number;
}

/**
 * White pencil wind swirls on their own canvas between the course and the play layer: short wavy strokes drawn at the
 * head and fading behind it as they cross the board downwind. Runs requestAnimationFrame only while the canvas is on
 * the page, the tab is visible and the wind blows (never under reduced motion). Frames read no layout: the canvas
 * size is read by `fit()`, outside animation frames.
 */
export class WindSwirls {
  private ctx: CanvasRenderingContext2D | null;
  private look: WindLook = windLook({ strength: 0, dir: 0 });
  private dir: Dir = 0;
  private board: Bounds = { w: 1, h: 1 };
  private rng: Rng = mulberry32(1);
  private live: Live[] = [];
  private nextSpawn = 0;
  private every = Infinity;
  private clock = 0;
  private last = 0;
  private raf = 0;
  private grain: CanvasPattern | null = null;
  private onVisibility = () => {
    if (document.hidden) this.pause();
    else this.resume();
  };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  /** Blow this wind (calm, or `still`, clears the canvas and stops). `seed` varies the strokes per hole. */
  set(wind: Wind, board: Bounds, seed: number, still: boolean) {
    this.stop();
    this.look = windLook(still ? { strength: 0, dir: 0 } : wind);
    this.dir = wind.dir;
    this.board = board;
    this.rng = mulberry32(seed ^ 0x5717e5);
    this.live = [];
    this.clock = 0;
    if (this.look.strokes === 0) return;
    this.every = spawnEverySec(this.look, board, this.dir);
    // Pre-warm: the strokes already on their way, as if the wind had been blowing all along, so it is there from the
    // first frame.
    const n = Math.ceil(this.look.crossSec[1] / this.every);
    for (let i = 0; i < n; i++) {
      const s = spawnSwirl(this.rng, this.look, board, this.dir);
      this.live.push({ s, born: -(i + this.rng()) * this.every });
    }
    this.nextSpawn = this.interval();
    this.fit();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resume();
  }

  /** Match the backing store to the canvas's CSS size (call on layout changes, never in a frame). */
  fit() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
  }

  stop() {
    this.pause();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private pause() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resume() {
    if (this.raf || document.hidden || this.look.strokes === 0) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Seconds to the next stroke: on average `spawnEverySec`, irregular so they never march in step. */
  private interval = () => this.every * randRange(this.rng, 0.4, 1.6);

  private frame = (now: number) => {
    this.raf = 0;
    // Off the page (a menu replaced the board): stop for good.
    if (!this.canvas.isConnected) {
      this.stop();
      return;
    }
    // Clamp the step, so a dropped run of frames doesn't make the strokes jump.
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    this.clock += dt;
    while (this.clock >= this.nextSpawn) {
      this.live.push({ s: spawnSwirl(this.rng, this.look, this.board, this.dir), born: this.nextSpawn });
      this.nextSpawn += this.interval();
    }
    this.live = this.live.filter((l) => (this.clock - l.born) * l.s.speed < l.s.travel);
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw() {
    const g = this.ctx;
    if (!g) return;
    const k = this.canvas.width / this.board.w;
    const ky = this.canvas.height / this.board.h;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = this.pattern(g);
    const L = this.look.length;
    for (const { s, born } of this.live) {
      const head = (this.clock - born) * s.speed;
      const tail = Math.max(0, head - L);
      if (head <= 0) continue;
      // Walk the trail from the tail to the head, one opacity band at a time (each band shares its end point with the
      // next, so the line is unbroken).
      for (let b = 0; b < BANDS; b++) {
        const u0 = Math.max(tail, head - L * (1 - b / BANDS));
        const u1 = Math.max(tail, head - L * (1 - (b + 1) / BANDS));
        if (u1 <= u0) continue;
        const fresh = (b + 1) / BANDS;
        g.globalAlpha = this.look.alpha * fresh;
        // A pencil presses harder where it is drawing now; the width wavers a little along the line.
        g.lineWidth = Math.max(0.8, this.look.width * k * (0.55 + 0.55 * fresh) * (1 + 0.18 * Math.sin(u0 * 5.3 + s.phase)));
        g.beginPath();
        for (let u = u0; ; u = Math.min(u1, u + STEP)) {
          const p = swirlPoint(s, u);
          if (u === u0) g.moveTo(p.x * k, p.y * ky);
          else g.lineTo(p.x * k, p.y * ky);
          if (u >= u1) break;
        }
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  /** White pencil with the ground showing through its tooth: a fixed speckle tile, made once. */
  private pattern(g: CanvasRenderingContext2D): CanvasPattern | string {
    if (this.grain) return this.grain;
    const fallback = `rgb(${PENCIL.join(',')})`;
    const s = 40;
    const tile = document.createElement('canvas');
    tile.width = tile.height = s;
    const t = tile.getContext('2d');
    if (!t) return fallback;
    const img = t.createImageData(s, s);
    const rnd = mulberry32(11);
    for (let i = 0; i < s * s; i++) {
      img.data[i * 4] = PENCIL[0];
      img.data[i * 4 + 1] = PENCIL[1];
      img.data[i * 4 + 2] = PENCIL[2];
      const v = rnd();
      img.data[i * 4 + 3] = v > 0.7 ? Math.round(255 * (1 - (v - 0.7) * 2.6)) : 255;
    }
    t.putImageData(img, 0, 0);
    this.grain = g.createPattern(tile, 'repeat');
    return this.grain ?? fallback;
  }
}
