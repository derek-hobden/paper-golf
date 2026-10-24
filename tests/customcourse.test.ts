import { describe, expect, it } from 'vitest';
import { blankDraft, draftToHole } from '../src/engine/builder';
import { properPar } from '../src/engine/generator';
import { builtinHoleId } from '../src/engine/holeid';
import type { Hole } from '../src/engine/types';
import {
  HOLES_IN_ROUND,
  ROUND_PAR,
  builtHole,
  builtinSource,
  cardTotals,
  currentHole,
  holesInRound,
  isPersisted,
  isPractice,
  isValidState,
  loadState,
  newBuiltRound,
  newCustomGame,
  newPracticeRound,
  nextHole,
  oneHoleName,
  parAt,
  recordsCourseBest,
  roundPars,
  toPar,
  type GameState,
} from '../src/game/game';
import { addHole, emptyLibrary, holeSource, type CustomCourse } from '../src/game/library';
import { at, defined, holeOutWithPutt } from './helpers';

const drawn = (par: 3 | 4 | 5 = 5): Hole =>
  defined(draftToHole({ ...blankDraft(), par, tee: { x: 2, y: 17 }, cup: { x: 2, y: 15 } }), 'drawn hole');

/** A library with one saved hole, and a course of 17 built-in holes with that one third. */
function mixed(): { course: CustomCourse; source: ReturnType<typeof holeSource>; savedId: string } {
  const saved = addHole(emptyLibrary(), 'My par 5', drawn(5), 7);
  const holes = Array.from({ length: HOLES_IN_ROUND }, (_, i) => builtinHoleId(1, i + 1));
  holes[2] = saved.id;
  return { course: { id: 'c:7', name: 'Pick & mix', saved: 7, holes }, source: holeSource(saved.lib), savedId: saved.id };
}

const custom = (names = ['Ann']) => {
  const { course, source, savedId } = mixed();
  return { g: defined(newCustomGame(course, names, source, 1, 2), 'custom round'), course, source, savedId };
};

describe('a round on a custom course', () => {
  it('plays the 18 holes it was given, in order, built-in and saved alike', () => {
    const { g, course, savedId } = custom();
    expect(holesInRound(g)).toBe(HOLES_IN_ROUND);
    expect(g.customId).toBe('c:7');
    expect(g.customName).toBe('Pick & mix');
    expect(g.customHoles).toEqual(course.holes);
    expect(currentHole(g).id).toBe(builtinHoleId(1, 1));
    expect(builtHole(g)).toBeUndefined();

    for (let h = 0; h < 3; h++) {
      expect(currentHole(g).id, `hole ${String(h + 1)}`).toBe(at(course.holes, h));
      holeOutWithPutt(g);
      expect(g.holeDone).toBe(true);
      nextHole(g);
    }
    expect(currentHole(g).id).toBe(at(course.holes, 3));
    // The saved hole played as hole 3, with its own par.
    expect(parAt(g, 2)).toBe(5);
    expect(savedId.startsWith('s:')).toBe(true);
  });

  it('scores against its own pars, not the pars of Proper golf', () => {
    const { g } = custom();
    const pars = roundPars(g);
    expect(pars).toHaveLength(HOLES_IN_ROUND);
    expect(at(pars, 2)).toBe(5);
    expect(at(pars, 2)).not.toBe(properPar(3));
    expect(pars.reduce((a, b) => a + b, 0)).toBe(ROUND_PAR - properPar(3) + 5);

    const p = at(g.players, 0);
    p.scores[2] = 5;
    expect(toPar(p, g)).toBe(0);
    const totals = cardTotals(p, pars);
    expect(at(totals, 0)).toMatchObject({ label: 'Out', par: pars.slice(0, 9).reduce((a, b) => a + b, 0), strokes: 5, toPar: 0 });
    expect(at(totals, 2).par).toBe(pars.reduce((a, b) => a + b, 0));
  });

  it('is a saved round, and a course best, unlike a hole played on its own', () => {
    const { g } = custom();
    expect(isPersisted(g)).toBe(true);
    expect(recordsCourseBest(g)).toBe(true);
    expect(isPractice(g)).toBe(false);
  });

  it('is not started at all when one of its holes has gone', () => {
    const { course, source } = mixed();
    const gone = { ...course, holes: course.holes.map((h, i) => (i === 2 ? 's:gone' : h)) };
    expect(newCustomGame(gone, ['Ann'], source)).toBeNull();
    expect(newCustomGame({ ...course, holes: course.holes.slice(1) }, ['Ann'], source)).toBeNull();
  });

  it('carries on from the save, as long as every hole is still there', () => {
    const { g, source } = custom();
    const save: unknown = JSON.parse(JSON.stringify(g));
    const back = defined(loadState(save, source), 'loaded round');
    expect(back).toEqual(g);
    expect(currentHole(back).id).toBe(builtinHoleId(1, 1));
    expect(parAt(back, 2)).toBe(5);

    // Without the library (or with the saved hole deleted) there is no round to carry on.
    expect(loadState(save)).toBeNull();
    expect(loadState(save, holeSource(emptyLibrary()))).toBeNull();
  });

  it('carries on without the library when every hole is a built-in one', () => {
    const { source } = mixed();
    const holes = Array.from({ length: HOLES_IN_ROUND }, (_, i) => builtinHoleId(2, i + 1));
    const g = defined(newCustomGame({ id: 'c:8', name: 'Built-ins', holes }, ['Ann'], source), 'round');
    const back = defined(loadState(JSON.parse(JSON.stringify(g))), 'loaded round');
    expect(currentHole(back).id).toBe(builtinHoleId(2, 1));
    expect(builtinSource.par(builtinHoleId(2, 1))).toBe(properPar(1));
  });

  it('is never half a course in the save', () => {
    const { g } = custom();
    const save: unknown = JSON.parse(JSON.stringify(g));
    expect(isValidState(save)).toBe(true);
    const halves = [
      { ...g, customId: undefined },
      { ...g, customName: undefined },
      { ...g, customHoles: undefined },
    ];
    for (const [i, half] of halves.entries()) expect(isValidState(JSON.parse(JSON.stringify(half))), String(i)).toBe(false);
  });
});

describe('a round on one hole', () => {
  it('is a practice hole: one hole, its own name, no save and no best', () => {
    const hole = drawn(3);
    const g = newPracticeRound(hole, 'Thunder Peaks 11', ['Ann', 'Bob'], 3, 4);
    expect(holesInRound(g)).toBe(1);
    expect(oneHoleName(g)).toBe('Thunder Peaks 11');
    expect(isPractice(g)).toBe(true);
    expect(isPersisted(g)).toBe(false);
    expect(recordsCourseBest(g)).toBe(false);
    expect(parAt(g, 0)).toBe(3);
    expect(roundPars(g)).toEqual([3]);

    // The round plays its own copy: changing the hole afterwards changes nothing.
    hole.par = 5;
    expect(defined(builtHole(g), 'hole').par).toBe(3);
    expect(currentHole(g).cup).toEqual({ x: 2, y: 15 });

    holeOutWithPutt(g);
    holeOutWithPutt(g);
    expect(g.holeDone).toBe(true);
    nextHole(g);
    expect(g.finished).toBe(true);
  });

  it('is a hole just drawn: the same round, called Your hole', () => {
    const g: GameState = newBuiltRound(drawn(4), ['Ann']);
    expect(oneHoleName(g)).toBe('Your hole');
    expect(isPractice(g)).toBe(false);
    expect(recordsCourseBest(g)).toBe(false);
    expect(holesInRound(g)).toBe(1);
  });
});
