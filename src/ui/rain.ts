import { mulberry32, randRange, type Rng } from '../engine/rng';
import { CALM, type Wind } from '../engine/types';
import type { Bounds } from './flight';
import { pencilPattern } from './pencil';
import { rainLook, spawnEverySec, spawnStreak, streakPoint, type RainLook, type Streak } from './rainlook';

/** Opacity bands a streak is drawn in, darkest at the head. */
const BANDS = 4;
/** Streak sample spacing in board units (a streak is straight, so its ends are nearly enough). */
const STEP = 0.4;
/** Backing-store pixels per CSS pixel, capped so a phone's 3x screen doesn't triple the fill cost. */
const MAX_DPR = 2;

interface Live {
  s: Streak;
  born: number;
}

/**
 * Light rain-blue pencil streaks on their own canvas over the board: short lines falling down the page, leaning
 * downwind, drawn at the head and fading behind it. Runs requestAnimationFrame only while the canvas is on the page,
 * the tab is visible and it is raining; under reduced motion (`still`) the shower is drawn once and never moves.
 * Frames read no layout: the canvas size is read by `fit()`, outside animation frames.
 */
export class RainStreaks {
  private ctx: CanvasRenderingContext2D | null;
  private look: RainLook = rainLook(false);
  private wind: Wind = CALM;
  private board: Bounds = { w: 1, h: 1 };
  private rng: Rng = mulberry32(1);
  private live: Live[] = [];
  private nextSpawn = 0;
  private every = Infinity;
  private clock = 0;
  private last = 0;
  private raf = 0;
  private still = false;
  private grain: CanvasPattern | null = null;
  private onVisibility = () => {
    if (document.hidden) this.pause();
    else this.resume();
  };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  /**
   * Rain on this hole (dry clears the canvas and stops), leaning with `wind`. `seed` varies the shower per hole;
   * `still` (reduced motion) draws one static shower instead of animating it.
   */
  set(rain: boolean, wind: Wind, board: Bounds, seed: number, still: boolean) {
    this.stop();
    this.look = rainLook(rain);
    this.wind = wind;
    this.board = board;
    this.still = still;
    this.rng = mulberry32(seed ^ 0xfa11ed);
    this.live = [];
    this.clock = 0;
    if (this.look.streaks === 0) return;
    this.every = spawnEverySec(this.look);
    // Pre-warm: the streaks already on their way, as if it had been raining all along, so the shower is there from
    // the first frame (and is the whole of it under reduced motion).
    const n = Math.ceil(this.look.fallSec[1] / this.every);
    for (let i = 0; i < n; i++) {
      const s = spawnStreak(this.rng, this.look, board, wind);
      this.live.push({ s, born: -(i + this.rng()) * this.every });
    }
    this.nextSpawn = this.interval();
    this.fit();
    if (still) {
      this.draw();
      return;
    }
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
      // Resizing a canvas clears it, and a still shower has no next frame to redraw it in.
      if (this.still) this.draw();
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
    if (this.raf || this.still || document.hidden || this.look.streaks === 0) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Seconds to the next streak: on average `spawnEverySec`, irregular so they never fall in step. */
  private interval = () => this.every * randRange(this.rng, 0.4, 1.6);

  private frame = (now: number) => {
    this.raf = 0;
    // Off the page (a menu replaced the board): stop for good.
    if (!this.canvas.isConnected) {
      this.stop();
      return;
    }
    // Clamp the step, so a dropped run of frames doesn't make the streaks jump.
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    this.clock += dt;
    while (this.clock >= this.nextSpawn) {
      this.live.push({ s: spawnStreak(this.rng, this.look, this.board, this.wind), born: this.nextSpawn });
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
    g.strokeStyle = this.pattern(g);
    const L = this.look.length;
    for (const { s, born } of this.live) {
      const head = (this.clock - born) * s.speed;
      const tail = Math.max(0, head - L);
      if (head <= 0) continue;
      // Walk the streak from the tail to the head, one opacity band at a time (each band shares its end point with
      // the next, so the line is unbroken).
      for (let b = 0; b < BANDS; b++) {
        const u0 = Math.max(tail, head - L * (1 - b / BANDS));
        const u1 = Math.max(tail, head - L * (1 - (b + 1) / BANDS));
        if (u1 <= u0) continue;
        const fresh = (b + 1) / BANDS;
        g.globalAlpha = this.look.alpha * fresh;
        // A pencil presses harder where it is drawing now; the width wavers a little along the line.
        g.lineWidth = Math.max(0.8, this.look.width * k * (0.6 + 0.5 * fresh) * (1 + 0.15 * Math.sin(u0 * 6.1 + s.phase)));
        g.beginPath();
        for (let u = u0; ; u = Math.min(u1, u + STEP)) {
          const p = streakPoint(s, u);
          if (u === u0) g.moveTo(p.x * k, p.y * ky);
          else g.lineTo(p.x * k, p.y * ky);
          if (u >= u1) break;
        }
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  /**
   * The pencil tile (`pencil.ts`) in the rain's own blue, made once for this canvas: the colour is the look's and
   * never changes with the weather (a dry hole simply draws nothing), so one tile serves every hole.
   */
  private pattern(g: CanvasRenderingContext2D): CanvasPattern | string {
    const made = this.grain ?? pencilPattern(g, this.look.color);
    if (typeof made !== 'string') this.grain = made;
    return made;
  }
}
