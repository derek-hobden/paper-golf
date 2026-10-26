import { describe, expect, it } from 'vitest';
import { MAX_RAIN_COST, PAR_WINDOWS, RAIN_WINDOWS, generateProperHole, validateHole } from '../src/engine/generator';
import { diceExpectedFromTee, puttComponent } from '../src/engine/solver';
import { defined } from './helpers';
import { EVERY_HOLE } from './sweep';

// Rain never breaks a hole. The solver values a hole as it plays in the rain (`diceExpectation(hole, true)`: hits one
// space shorter, no slope rolling the ball on) and `validateHole(hole, window, true)` judges it that way, so these
// cases hold every one of the 90 layouts finishable in the rain and its par still fair.
//
// Par itself does not move: it is the hole's number in `PROPER_PARS`, the same card wet or dry (AGENTS.md "the round",
// and bests stay comparable). What rain costs is strokes, and `RAIN_WINDOWS` and `MAX_RAIN_COST` in `generator.ts`
// are the windows it is allowed to cost them in, measured over all 90 holes: optimal play loses about a third of a
// stroke on a par 3, half on a par 4 and three quarters on a par 5, and never more than 1.5 (Thunder Peaks 9, a par
// 5, is the worst at +1.43). The generator holds a hole's heights to the same numbers (`liftHole`), so they live
// there and are read from there here. A change that makes rain harsher than that, or leaves a hole unfinishable,
// fails here.

describe('every hole in the rain', () => {
  it.each(EVERY_HOLE)('course $c hole $n is still finishable, and its par stays fair', ({ c, n }) => {
    const hole = generateProperHole(c, n);
    const window = defined(RAIN_WINDOWS[hole.par], 'rainy par window');
    // Finishable: the cup is still reachable by putting alone (wet ground only ever takes a slope ride away, so the
    // putts always walk the ball home) and optimal dice play from the tee is a finite number of strokes.
    expect(puttComponent(hole, hole.tee, true).has(hole.cup.y * hole.w + hole.cup.x)).toBe(true);
    const rain = diceExpectedFromTee(hole, true);
    expect(Number.isFinite(rain)).toBe(true);
    // Fair: inside the hole's rainy window, and no more than MAX_RAIN_COST worse than the dry hole it was made from.
    expect(validateHole(hole, window, true)).toMatchObject({ ok: true });
    const dry = diceExpectedFromTee(hole);
    expect(validateHole(hole, defined(PAR_WINDOWS[hole.par], 'dry par window'))).toMatchObject({ ok: true });
    expect(rain - dry).toBeLessThanOrEqual(MAX_RAIN_COST);
  });
});
