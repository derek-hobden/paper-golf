import { describe, expect, it } from 'vitest';
import { CARRY, InputLock, curvePoint, flightDuration, flightLegs, flightPos, shotSteps, windControl } from '../src/ui/flight';
import { center, windCurve } from '../src/ui/sketch';
import { at } from './helpers';

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
        const leg = at(legs, i);
        const prevLeg = at(legs, i - 1);
        expect(leg.from).toBe(prevLeg.to);
        expect(leg.height).toBeLessThan(prevLeg.height || Infinity);
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
      const carry = at(legs, 0);
      const apex = flightPos(legs, carry.dur / 2 / dur);
      expect(apex.lift).toBeCloseTo(carry.height, 5);
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
    const gate = { release: (): void => undefined };
    const log: string[] = [];
    const shot = lock.run(
      () =>
        new Promise<void>((r) => {
          log.push('shot');
          gate.release = r;
        }),
    );
    expect(lock.busy).toBe(true);
    // A second tap, a roll or a mulligan mid-flight is ignored.
    expect(await lock.run(() => void log.push('tap'))).toBe(false);
    expect(await lock.run(() => void log.push('roll'))).toBe(false);
    gate.release();
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

describe('wind-bent shot lines', () => {
  const from = { x: 2, y: 9 };
  const aim = { x: 2, y: 3 };

  it('leave the ball heading for the aim point and finish exactly on the wind-adjusted square', () => {
    for (const end of [{ x: 4, y: 3 }, { x: 0, y: 1 }, { x: 3, y: 4 }]) {
      const c = windControl(from, aim);
      expect(curvePoint(from, c, end, 0)).toEqual(from);
      expect(curvePoint(from, c, end, 1)).toEqual(end);
      // The start tangent (towards the control point) points straight at the aim.
      const cross = (c.x - from.x) * (aim.y - from.y) - (c.y - from.y) * (aim.x - from.x);
      expect(cross).toBeCloseTo(0, 9);
      // It bends: halfway along it is off the straight line from the ball to the end.
      const mid = curvePoint(from, c, end, 0.5);
      const off = (end.x - from.x) * (mid.y - from.y) - (end.y - from.y) * (mid.x - from.x);
      expect(Math.abs(off)).toBeGreaterThan(0.1);
    }
  });

  it('never run past the square the ball stops on in a headwind', () => {
    const end = { x: 2, y: 5 }; // blown back 2 towards the ball
    const c = windControl(from, aim);
    let prev = from.y;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const y = curvePoint(from, c, end, t).y;
      expect(y).toBeLessThanOrEqual(prev + 1e-9);
      expect(y).toBeGreaterThanOrEqual(end.y - 1e-9);
      prev = y;
    }
  });

  it('draw as one pencil curve from the ball onto the centre of the real square', () => {
    const end = { x: 4, y: 3 };
    const d = windCurve(from, aim, end, 7);
    const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
    expect(d).toMatch(/^M[\d.]+ [\d.]+ Q[\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
    expect(nums.slice(0, 2)).toEqual([center(from).x, center(from).y]);
    expect(nums.slice(4)).toEqual([center(end).x, center(end).y]);
    expect(windCurve(from, aim, end, 7)).toBe(d);
  });

  it('fly one curve with no separate roll for a blown shot, even one a slope rolled', () => {
    expect(shotSteps({ holed: false, rolled: true, blown: true })).toEqual(['fly', 'line', 'circle', 'lift-pencil', 'hide-ball']);
    expect(shotSteps({ holed: true, rolled: false, blown: true })).toEqual(['fly', 'line', 'lift-pencil', 'sink']);
  });
});
