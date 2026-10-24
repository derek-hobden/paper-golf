import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/engine/rng';
import {
  BEAD,
  dropletAt,
  dropletGone,
  dropletLook,
  dropletRun,
  dropletSpeed,
  spawnDroplet,
  type Droplet,
  type DropletLook,
} from '../src/ui/dropletlook';

// The look of the water droplets on the camera lens: where one lands, how long it clings, the stop-start way it runs
// down the screen and how it shrinks on the way. Pure numbers in CSS pixels, no DOM, so the animation in
// src/ui/droplets.ts has nothing to decide for itself.

const LENS = { w: 390, h: 844 };
const DESK = { w: 1280, h: 800 };

const look = dropletLook(true, 0);

/** The whole run of one droplet, sampled every 20ms from the moment it lands until it is gone. */
function trace(d: Droplet, l: DropletLook, lens: { w: number; h: number }) {
  const out: { t: number; x: number; y: number; r: number }[] = [];
  for (let t = 0; t <= 60; t += 0.02) {
    if (dropletGone(d, l, lens, t)) break;
    out.push({ t, ...dropletAt(d, t) });
  }
  return out;
}

describe('dropletLook', () => {
  it('has nothing on the lens on a dry hole', () => {
    for (const strength of [0, 1, 2] as const) {
      expect(dropletLook(false, strength).most).toBe(0);
      expect(dropletLook(false, strength).everySec).toBe(Infinity);
    }
  });

  it('is occasional and subtle on a rainy one: one every several seconds, about three at most', () => {
    expect(look.most).toBeGreaterThanOrEqual(2);
    expect(look.most).toBeLessThanOrEqual(3);
    expect(look.everySec).toBeGreaterThanOrEqual(3);
    expect(look.everySec).toBeLessThan(12);
    // Small beads, in a range of sizes, and translucent: the hole reads through them.
    expect(look.radius[0]).toBeGreaterThan(1);
    expect(look.radius[0]).toBeLessThan(look.radius[1]);
    expect(look.radius[1]).toBeLessThanOrEqual(14);
    expect(look.alpha).toBeGreaterThan(0);
    expect(look.alpha).toBeLessThan(1);
    expect(look.trailAlpha).toBeGreaterThan(0);
    expect(look.trailAlpha).toBeLessThan(look.alpha);
    // It sits still for a moment, then runs.
    expect(look.clingSec[0]).toBeGreaterThan(0.2);
    expect(look.clingSec[0]).toBeLessThanOrEqual(look.clingSec[1]);
    expect(look.speed[0]).toBeGreaterThan(0);
    expect(look.speed[0]).toBeLessThan(look.speed[1]);
    // Stop-start, never backwards: the two hesitations can only cancel the run, not reverse it.
    expect(look.stutter).toBeGreaterThan(0.5);
    expect(look.stutter).toBeLessThanOrEqual(1);
  });

  it('lands a little more often in a heavier rain, and is still occasional', () => {
    const [calm, breeze, blow] = [dropletLook(true, 0), dropletLook(true, 1), dropletLook(true, 2)];
    expect(breeze.everySec).toBeLessThan(calm.everySec);
    expect(blow.everySec).toBeLessThan(breeze.everySec);
    // A little: never more than half as long a wait again, and never a drizzle of them.
    expect(blow.everySec).toBeGreaterThan(calm.everySec / 2);
    expect(blow.everySec).toBeGreaterThanOrEqual(3);
    expect(blow.most).toBe(calm.most);
  });

  it('draws the bead as optics, not as a fill: a dark rim, a bright crescent and a glint', () => {
    expect(BEAD.rim).toBeGreaterThan(0);
    expect(BEAD.rimAt).toBeGreaterThan(0.5);
    expect(BEAD.rimAt).toBeLessThan(1);
    expect(BEAD.caustic).toBeGreaterThan(0);
    expect(BEAD.glint).toBeGreaterThan(0);
    expect(BEAD.glintSize).toBeLessThan(0.5);
    // The middle of the bead is nearly clear: it magnifies what is behind it rather than covering it.
    expect(BEAD.lift).toBeLessThan(0.2);
    // It stretches a little as it runs, like a bead of water pulled downwards.
    expect(BEAD.stretch).toBeGreaterThan(0);
    expect(BEAD.stretch).toBeLessThan(0.6);
  });
});

describe('spawnDroplet', () => {
  it('lands with the whole bead on the lens, with room to run', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 300; i++) {
      const d = spawnDroplet(rng, look, LENS);
      expect(d.x - d.r).toBeGreaterThanOrEqual(0);
      expect(d.x + d.r).toBeLessThanOrEqual(LENS.w);
      expect(d.y - d.r).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThan(LENS.h);
      expect(d.r).toBeGreaterThanOrEqual(look.radius[0]);
      expect(d.r).toBeLessThanOrEqual(look.radius[1]);
      expect(d.cling).toBeGreaterThanOrEqual(look.clingSec[0]);
      expect(d.cling).toBeLessThanOrEqual(look.clingSec[1]);
      expect(d.speed).toBeGreaterThanOrEqual(look.speed[0]);
      expect(d.speed).toBeLessThanOrEqual(look.speed[1]);
      // The hesitations only ever slow the run down.
      expect(d.a.amp + d.b.amp).toBeLessThanOrEqual(look.stutter + 1e-9);
      expect(d.a.w).toBeGreaterThan(0);
      expect(d.b.w).toBeGreaterThan(0);
    }
  });

  it('varies: no two beads the same size, in the same place, for the same time', () => {
    const rng = mulberry32(19);
    const drops = Array.from({ length: 200 }, () => spawnDroplet(rng, look, LENS));
    expect(new Set(drops.map((d) => d.r)).size).toBeGreaterThan(150);
    expect(new Set(drops.map((d) => d.cling)).size).toBeGreaterThan(150);
    // Spread over the lens, not down one line.
    expect(Math.min(...drops.map((d) => d.x))).toBeLessThan(LENS.w * 0.25);
    expect(Math.max(...drops.map((d) => d.x))).toBeGreaterThan(LENS.w * 0.75);
    expect(Math.min(...drops.map((d) => d.y))).toBeLessThan(LENS.h * 0.25);
    expect(Math.max(...drops.map((d) => d.y))).toBeGreaterThan(LENS.h * 0.5);
  });

  it('is deterministic: the same seed lands the same droplet', () => {
    const one = spawnDroplet(mulberry32(7), look, LENS);
    const two = spawnDroplet(mulberry32(7), look, LENS);
    expect(one).toEqual(two);
    expect(spawnDroplet(mulberry32(8), look, LENS)).not.toEqual(one);
  });
});

describe('a droplet on the lens', () => {
  it('sits still where it landed, then goes', () => {
    const d = spawnDroplet(mulberry32(5), look, LENS);
    for (let t = 0; t <= d.cling; t += 0.05) {
      expect(dropletRun(d, t)).toBe(0);
      expect(dropletSpeed(d, t)).toBe(0);
      expect(dropletAt(d, t)).toEqual({ x: d.x, y: d.y, r: d.r });
    }
    expect(dropletRun(d, d.cling + 1)).toBeGreaterThan(0);
  });

  it('only ever runs down, and wanders only a little to the side', () => {
    const rng = mulberry32(31);
    for (let i = 0; i < 60; i++) {
      const d = spawnDroplet(rng, look, LENS);
      const path = trace(d, look, LENS);
      expect(path.length).toBeGreaterThan(10);
      let last = path[0] ?? { x: d.x, y: d.y, r: d.r };
      for (const p of path) {
        expect(p.y).toBeGreaterThanOrEqual(last.y - 1e-9);
        expect(p.r).toBeLessThanOrEqual(last.r + 1e-9);
        expect(Math.abs(p.x - d.x)).toBeLessThanOrEqual(2 * look.wander + 1e-9);
        last = p;
      }
    }
  });

  it('trickles stop-start: it runs on, slows almost to a halt, runs on again', () => {
    const d = spawnDroplet(mulberry32(13), look, LENS);
    const speeds: number[] = [];
    for (let t = d.cling + 0.05; t < d.cling + 6; t += 0.02) speeds.push(dropletSpeed(d, t));
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(0);
    // Not a steady slide: its quickest moment is several times its slowest.
    expect(Math.max(...speeds)).toBeGreaterThan(Math.min(...speeds) * 3);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(d.speed * (1 + look.stutter) + 1e-9);
  });

  it('shrinks as it runs and is gone in the end', () => {
    const rng = mulberry32(23);
    for (let i = 0; i < 40; i++) {
      const d = spawnDroplet(rng, look, LENS);
      expect(dropletGone(d, look, LENS, 0)).toBe(false);
      const path = trace(d, look, LENS);
      const last = path[path.length - 1] ?? { r: 0, y: 0 };
      expect(last.r).toBeLessThan(d.r);
      // Either it has worn away to nothing or it has run off the bottom of the lens.
      expect(last.r <= look.gone * 1.2 || last.y + last.r >= LENS.h).toBe(true);
      expect(dropletGone(d, look, LENS, 60)).toBe(true);
    }
  });

  it('runs on a wide screen as it does on a phone: the same bead, the same pace', () => {
    const phone = spawnDroplet(mulberry32(44), look, LENS);
    const desk = spawnDroplet(mulberry32(44), look, DESK);
    expect(desk.r).toBe(phone.r);
    expect(desk.speed).toBe(phone.speed);
    expect(dropletRun(desk, 4)).toBe(dropletRun(phone, 4));
  });
});
