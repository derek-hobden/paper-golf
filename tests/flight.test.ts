import { describe, expect, it } from 'vitest';
import { CARRY, InputLock, flightDuration, flightLegs, flightPos, shotSteps } from '../src/ui/flight';

describe('ball flight', () => {
  it('carries most of the way, bounces forward and rolls out exactly onto the target', () => {
    for (let dist = 2; dist <= 7; dist++) {
      const legs = flightLegs(dist, 24, false);
      expect(legs[0]).toMatchObject({ from: 0, to: CARRY });
      expect(CARRY).toBeGreaterThanOrEqual(0.8);
      expect(CARRY).toBeLessThanOrEqual(0.85);
      // One or two decaying bounces, then a ground roll.
      const hops = legs.slice(1).filter((l) => l.height > 0);
      expect(hops.length).toBeGreaterThanOrEqual(1);
      expect(hops.length).toBeLessThanOrEqual(2);
      for (let i = 1; i < legs.length; i++) {
        expect(legs[i].from).toBe(legs[i - 1].to);
        expect(legs[i].height).toBeLessThan(legs[i - 1].height || Infinity);
      }
      expect(legs.at(-1)).toMatchObject({ to: 1, height: 0 });
      // About 1–1.5 s of flight.
      const dur = flightDuration(legs);
      expect(dur).toBeGreaterThanOrEqual(900);
      expect(dur).toBeLessThanOrEqual(1500);

      // Always moving forward, never below the ground, and at rest exactly on the target.
      let prev = 0;
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const p = flightPos(legs, t);
        expect(p.along).toBeGreaterThanOrEqual(prev - 1e-9);
        expect(p.lift).toBeGreaterThanOrEqual(0);
        prev = p.along;
      }
      expect(flightPos(legs, 1)).toEqual({ along: 1, lift: 0 });
      // Highest at the carry's apex.
      const apex = flightPos(legs, legs[0].dur / 2 / dur);
      expect(apex.lift).toBeCloseTo(legs[0].height, 5);
    }
  });

  it('putts stay on the ground', () => {
    const legs = flightLegs(1, 24, true);
    expect(legs).toHaveLength(1);
    for (let t = 0; t <= 1; t += 0.1) expect(flightPos(legs, t).lift).toBe(0);
    expect(flightPos(legs, 1)).toEqual({ along: 1, lift: 0 });
  });
});

describe('shot sequence', () => {
  it('flies and settles before the pencil draws the line', () => {
    expect(shotSteps({ holed: false, rolled: false })).toEqual(['fly', 'line', 'circle', 'lift-pencil', 'hide-ball']);
    expect(shotSteps({ holed: true, rolled: false })).toEqual(['fly', 'line', 'lift-pencil', 'sink']);
    expect(shotSteps({ holed: false, rolled: true })).toEqual(['fly', 'line', 'circle', 'roll', 'roll-line', 'lift-pencil', 'hide-ball']);
    expect(shotSteps({ holed: true, rolled: true })).toEqual(['fly', 'line', 'circle', 'roll', 'roll-line', 'lift-pencil', 'sink']);
  });

  it('blocks input while a shot is animating', async () => {
    const lock = new InputLock();
    let release!: () => void;
    const log: string[] = [];
    const shot = lock.run(
      () =>
        new Promise<void>((r) => {
          log.push('shot');
          release = r;
        }),
    );
    expect(lock.busy).toBe(true);
    // A second tap, a roll or a mulligan mid-flight is ignored.
    expect(await lock.run(() => void log.push('tap'))).toBe(false);
    expect(await lock.run(() => void log.push('roll'))).toBe(false);
    release();
    expect(await shot).toBe(true);
    expect(lock.busy).toBe(false);
    expect(await lock.run(() => void log.push('roll'))).toBe(true);
    expect(log).toEqual(['shot', 'roll']);
  });

  it('releases the lock even if the animation throws', async () => {
    const lock = new InputLock();
    await expect(lock.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(lock.busy).toBe(false);
  });
});
