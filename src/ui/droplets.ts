import { mulberry32, randRange, type Rng } from '../engine/rng';
import type { Bounds } from './flight';
import {
  BEAD,
  WATER_LIGHT,
  WATER_SHADE,
  dropletAt,
  dropletGone,
  dropletLook,
  dropletSpeed,
  spawnDroplet,
  type Droplet,
  type DropletLook,
} from './dropletlook';

/** Backing-store pixels per CSS pixel, capped so a phone's 3x screen doesn't triple the fill cost. */
const MAX_DPR = 2;
/**
 * The bead is painted once into a sprite and only ever scaled and placed after that. The sprite is made a little
 * bigger than the biggest bead on this screen (device pixels, not CSS ones) so its thin rim stays a thin rim rather
 * than being blurred away on the way down.
 */
const SPRITE_OVER = 1.4;
/** How much of the sprite the bead itself fills: the rest is the room its softest edges need. */
const FILL = 0.94;
/** Opacity bands the trail is drawn in, freshest at the bead. */
const BANDS = 5;

const rgba = (c: readonly [number, number, number], a: number) => `rgba(${c.join(',')},${String(a)})`;

interface Live {
  d: Droplet;
  /** The clock reading when it landed. */
  born: number;
}

/**
 * Water droplets on the camera lens: on a rainy hole the occasional bead lands on one canvas over the whole game
 * view, clings there for a moment and trickles down the screen, leaving a wet trail that fades, until it has worn away
 * or run off the bottom. The bead is painted once as a sprite (a soft dark rim, a bright crescent and a glint, clear
 * in the middle) and only ever scaled and placed, so a frame is three `drawImage` calls and a few short strokes.
 *
 * Runs requestAnimationFrame only while the canvas is on the page, the tab is visible and it is raining, and not at
 * all under reduced motion. Frames read no layout: the canvas size is read by `fit()`, outside animation frames.
 */
export class LensDroplets {
  private ctx: CanvasRenderingContext2D | null;
  private look: DropletLook = dropletLook(false, 0);
  private lens: Bounds = { w: 1, h: 1 };
  private rng: Rng = mulberry32(1);
  private live: Live[] = [];
  private nextSpawn = Infinity;
  private clock = 0;
  private last = 0;
  private raf = 0;
  /** Whether the last frame drew anything, so an empty lens is not cleared over and over. */
  private painted = false;
  private bead: HTMLCanvasElement | null = null;
  private beadSize = 0;
  private onVisibility = () => {
    if (document.hidden) this.pause();
    else this.resume();
  };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
  }

  /**
   * Let this hole's rain bead the lens (a dry hole clears it and stops), a little more often in a stronger wind.
   * `seed` varies the droplets per hole; `reduced` (reduced motion) leaves the lens clear.
   */
  set(rain: boolean, strength: 0 | 1 | 2, seed: number, reduced: boolean) {
    this.stop();
    if (reduced) return;
    this.look = dropletLook(rain, strength);
    if (this.look.most === 0) return;
    this.rng = mulberry32(seed ^ 0xd0b1e7);
    this.clock = 0;
    this.fit();
    // It has been raining all the while, so the hole opens with one bead already on the lens.
    this.live = [{ d: spawnDroplet(this.rng, this.look, this.lens), born: 0 }];
    this.nextSpawn = this.interval();
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resume();
  }

  /** Match the backing store to the canvas's CSS size (call on layout changes, never in a frame). */
  fit() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.lens = { w, h };
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const size = Math.round(this.look.radius[1] * 2 * dpr * SPRITE_OVER);
    if (size !== this.beadSize) {
      this.beadSize = size;
      this.bead = null;
    }
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
      // Resizing a canvas clears it.
      this.painted = false;
    }
  }

  stop() {
    this.pause();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.live = [];
    this.nextSpawn = Infinity;
    this.ctx?.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.painted = false;
  }

  private pause() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resume() {
    if (this.raf || document.hidden || this.look.most === 0) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Seconds to the next bead: on average `look.everySec`, irregular so they never land in step. */
  private interval = () => this.look.everySec * randRange(this.rng, 0.5, 1.6);

  private frame = (now: number) => {
    this.raf = 0;
    // Off the page: stop for good.
    if (!this.canvas.isConnected) {
      this.stop();
      return;
    }
    // Clamp the step, so a dropped run of frames doesn't make a bead jump.
    const dt = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    this.clock += dt;
    if (this.clock >= this.nextSpawn) {
      // Never more than `most` at once: a lens the player is trying to read the hole through stays mostly clear.
      if (this.live.length < this.look.most) this.live.push({ d: spawnDroplet(this.rng, this.look, this.lens), born: this.clock });
      this.nextSpawn = this.clock + this.interval();
    }
    this.live = this.live.filter((l) => !dropletGone(l.d, this.look, this.lens, this.clock - l.born));
    if (this.live.length > 0 || this.painted) this.draw();
    this.raf = requestAnimationFrame(this.frame);
  };

  private draw() {
    const g = this.ctx;
    if (!g) return;
    const sprite = this.sprite();
    g.setTransform(this.canvas.width / this.lens.w, 0, 0, this.canvas.height / this.lens.h, 0, 0);
    g.clearRect(0, 0, this.lens.w, this.lens.h);
    g.lineCap = 'round';
    for (const { d, born } of this.live) {
      const t = this.clock - born;
      const now = dropletAt(d, t);
      if (now.r <= 0) continue;
      this.trail(g, d, t);
      // A bead pulls out lengthways as it picks up speed and settles back when it stalls, and no two are quite the
      // same shape to begin with.
      const stretch = 1 + BEAD.stretch * Math.min(1, dropletSpeed(d, t) / this.look.speed[1]);
      const wide = (now.r / FILL) * (1 + 0.08 * Math.sin(d.phase));
      const tall = (now.r / FILL) * stretch;
      g.globalAlpha = this.look.alpha;
      if (sprite) g.drawImage(sprite, now.x - wide, now.y - tall, wide * 2, tall * 2);
    }
    g.globalAlpha = 1;
    this.painted = this.live.length > 0;
  }

  /** The wet track the bead has left over the last `trailFadeSec`: a cool shade with a brighter core, fading back. */
  private trail(g: CanvasRenderingContext2D, d: Droplet, t: number) {
    const span = this.look.trailFadeSec;
    for (let b = 0; b < BANDS; b++) {
      const t0 = t - (span * (b + 1)) / BANDS;
      const t1 = t - (span * b) / BANDS;
      if (t1 <= 0) continue;
      const from = dropletAt(d, Math.max(0, t0));
      const to = dropletAt(d, t1);
      const len = Math.hypot(to.x - from.x, to.y - from.y);
      if (len < 0.5) continue;
      const fade = 1 - b / BANDS;
      const w = Math.max(0.6, (from.r + to.r) * 0.5 * this.look.trailWidth * 2 * fade);
      g.beginPath();
      g.moveTo(from.x, from.y);
      g.lineTo(to.x, to.y);
      g.globalAlpha = this.look.trailAlpha * BEAD.trailShade * fade;
      g.lineWidth = w;
      g.strokeStyle = rgba(WATER_SHADE, 1);
      g.stroke();
      g.globalAlpha = this.look.trailAlpha * BEAD.trailCore * fade;
      g.lineWidth = w * 0.45;
      g.strokeStyle = rgba(WATER_LIGHT, 1);
      g.stroke();
    }
  }

  /**
   * The bead, painted once: nothing but optics, so it reads as water rather than a drawn circle. The middle is nearly
   * clear (what is behind it shows through, lifted a little as a lens does), light bends away from the rim into a soft
   * dark ring, gathers in a bright crescent on the far side from the light, and glints up and to the left.
   */
  private sprite(): HTMLCanvasElement | null {
    if (this.bead) return this.bead;
    const c = document.createElement('canvas');
    c.width = c.height = Math.max(16, this.beadSize);
    const g = c.getContext('2d');
    if (!g) return null;
    const m = c.width / 2;
    const R = m * FILL;
    const disc = (k = 1) => {
      g.beginPath();
      g.arc(m, m, R * k, 0, Math.PI * 2);
    };
    /** A ring of light or shade round the bead, strongest at one corner and gone at the opposite one. */
    const ring = (at: number, width: number, from: readonly [number, number], tint: readonly [number, number, number], a: number) => {
      const grad = g.createLinearGradient(m - from[0] * R, m - from[1] * R, m + from[0] * R, m + from[1] * R);
      grad.addColorStop(0.5, rgba(tint, 0));
      grad.addColorStop(0.85, rgba(tint, a * 0.4));
      grad.addColorStop(1, rgba(tint, a));
      g.strokeStyle = grad;
      g.lineWidth = R * width;
      disc(at);
      g.stroke();
    };

    // The glass under the bead shows straight through it: all that marks the water is the way its edge bends the
    // light away, which pinches dark just inside the rim.
    const body = g.createRadialGradient(m, m, 0, m, m, R);
    body.addColorStop(0, rgba(WATER_SHADE, 0));
    body.addColorStop(0.7, rgba(WATER_SHADE, BEAD.rim * 0.05));
    body.addColorStop(BEAD.rimAt, rgba(WATER_SHADE, BEAD.rim * 0.18));
    body.addColorStop(0.95, rgba(WATER_SHADE, BEAD.rim));
    body.addColorStop(0.99, rgba(WATER_SHADE, BEAD.rim * 0.3));
    body.addColorStop(1, rgba(WATER_SHADE, 0));
    g.fillStyle = body;
    disc();
    g.fill();

    // What the lens gathers: the middle reads a shade brighter, just off centre towards the light.
    const lift = g.createRadialGradient(m - R * 0.22, m - R * 0.24, 0, m - R * 0.22, m - R * 0.24, R * 0.55);
    lift.addColorStop(0, rgba(WATER_LIGHT, BEAD.lift));
    lift.addColorStop(1, rgba(WATER_LIGHT, 0));
    g.fillStyle = lift;
    disc();
    g.fill();

    g.save();
    disc();
    g.clip();
    // The light comes from up and to the left (as the ball's and the die's does): it bends through the bead into a
    // bright crescent along the far rim, and the near rim darkens against it.
    ring(BEAD.causticAt, 0.1, [0.8, 0.85], WATER_LIGHT, BEAD.caustic);
    ring(0.96, 0.07, [-0.85, -0.8], WATER_SHADE, BEAD.rim * 0.8);
    g.restore();

    // The glint, and the faint second one the far wall of the bead throws back.
    const spot = (x: number, y: number, size: number, a: number) => {
      const grad = g.createRadialGradient(x, y, 0, x, y, size);
      grad.addColorStop(0, rgba(WATER_LIGHT, a));
      grad.addColorStop(0.3, rgba(WATER_LIGHT, a * 0.75));
      grad.addColorStop(0.62, rgba(WATER_LIGHT, a * 0.18));
      grad.addColorStop(1, rgba(WATER_LIGHT, 0));
      g.fillStyle = grad;
      g.beginPath();
      g.ellipse(x, y, size, size * 0.78, -Math.PI / 4, 0, Math.PI * 2);
      g.fill();
    };
    spot(m - R * BEAD.glintAt, m - R * BEAD.glintAt, R * BEAD.glintSize, BEAD.glint);
    spot(m + R * 0.34, m + R * 0.46, R * BEAD.glintSize * 0.55, BEAD.glint * 0.16);

    this.bead = c;
    return c;
  }
}
