import { describe, expect, it } from 'vitest';
import { blankDraft, draftToHole } from '../src/engine/builder';
import { COURSES, GRID_H, GRID_W, PROPER_HOLES, generateProperHole, properPar } from '../src/engine/generator';
import {
  BUILTIN_COURSES,
  BUILTIN_HOLES_PER_COURSE,
  builtinHoleId,
  isHoleId,
  parseHoleId,
  savedHoleId,
} from '../src/engine/holeid';
import type { Hole } from '../src/engine/types';
import {
  COURSE_MISSING,
  COURSE_READY,
  HOLES_PER_COURSE,
  MAX_NAME,
  PICK_HOLES,
  addHole,
  cleanName,
  coursePar,
  courseStep,
  courseToDraft,
  deleteCourse,
  deleteHole,
  draftPar,
  draftToCourse,
  emptyLibrary,
  fillFromCourse,
  findCourse,
  findHole,
  holeName,
  holeSource,
  missingHoles,
  moveSlot,
  newCourseDraft,
  parseLibrary,
  pickGroups,
  practiceHole,
  putCourse,
  renameHole,
  replaceHole,
  setCourseName,
  setSlot,
  type CustomCourse,
  type Library,
} from '../src/game/library';
import { at, defined } from './helpers';

/** A playable 13x20 hole of rough with a tee and a pin on it, as the builder would hand one over. */
function drawnHole(par: 3 | 4 | 5 = 4): Hole {
  return defined(draftToHole({ ...blankDraft(), par, tee: { x: 2, y: 17 }, cup: { x: 2, y: 15 } }), 'drawn hole');
}

const eighteen = (course: number) => Array.from({ length: HOLES_PER_COURSE }, (_, i) => builtinHoleId(course, i + 1));

const course = (over: Partial<CustomCourse> = {}): CustomCourse => ({
  id: 'c:1',
  name: 'Pick & mix',
  saved: 10,
  holes: eighteen(0),
  ...over,
});

describe('hole ids', () => {
  it('names a built-in hole by its course and number, and a saved hole by its key', () => {
    expect(builtinHoleId(0, 1)).toBe('b:0:1');
    expect(parseHoleId('b:4:18')).toEqual({ kind: 'builtin', course: 4, number: 18 });
    expect(parseHoleId(savedHoleId('1700000000'))).toEqual({ kind: 'saved', key: '1700000000' });
    expect(isHoleId('b:0:1')).toBe(true);
    expect(isHoleId(7)).toBe(false);
  });

  it('reads nothing into an id it does not know', () => {
    for (const bad of ['', 'b:', 'b:0', 'b:0:0', 'b:0:19', 'b:5:1', 'b:-1:1', 'b:0:1:1', 'b: 0:1', 'b:0:1.5', 'b:01e1:1', 's:', 's:a:b', 'c:1', 'nope'])
      expect(parseHoleId(bad), bad).toBeNull();
  });

  it('is the shape of the built-in library, so an id can be read without the generator', () => {
    expect(BUILTIN_COURSES).toBe(COURSES.length);
    expect(BUILTIN_HOLES_PER_COURSE).toBe(PROPER_HOLES);
    expect(HOLES_PER_COURSE).toBe(PROPER_HOLES);
  });

  it('is carried by every generated hole, so a course slot keeps pointing at the same hole', () => {
    const hole = generateProperHole(2, 7);
    expect(hole.id).toBe('b:2:7');
    expect(parseHoleId(defined(hole.id, 'hole id'))).toEqual({ kind: 'builtin', course: 2, number: 7 });
  });
});

describe('the library in storage', () => {
  it('is empty for junk, for a missing version and for a version it does not know', () => {
    for (const bad of [null, 7, 'library', [], {}, { version: 2, holes: [], courses: [] }, { version: '1' }])
      expect(parseLibrary(bad), JSON.stringify(bad)).toEqual(emptyLibrary());
  });

  it('reads back what it wrote, holes and courses alike', () => {
    const one = addHole(emptyLibrary(), 'Windy corner', drawnHole(5), 1000);
    const lib = putCourse(one.lib, course({ holes: [one.id, ...eighteen(1).slice(1)] }));
    expect(parseLibrary(JSON.parse(JSON.stringify(lib)))).toEqual(lib);
  });

  it('drops one bad entry and keeps the rest', () => {
    const good = addHole(emptyLibrary(), 'Good', drawnHole(), 1).lib;
    const savedHole = at(good.holes, 0);
    const bad = [
      { ...savedHole, id: 'b:0:1' },
      { ...savedHole, id: 's:other', name: 7 },
      { ...savedHole, id: 's:other', saved: -1 },
      { ...savedHole, id: 's:other', hole: { ...savedHole.hole, par: 6 } },
      { ...savedHole, id: 's:other', hole: { ...savedHole.hole, cells: savedHole.hole.cells.slice(1) } },
      { ...savedHole, id: 's:other', hole: { ...savedHole.hole, tee: { x: GRID_W, y: 0 } } },
      { ...savedHole, id: 's:other', hole: { ...savedHole.hole, cup: { x: 0, y: GRID_H } } },
      { ...savedHole, id: 's:other', hole: { ...savedHole.hole, cells: [{ t: 'lava' }, ...savedHole.hole.cells.slice(1)] } },
      { ...savedHole, id: 's:other', hole: null },
    ];
    for (const entry of bad) {
      const lib = parseLibrary({ version: 1, holes: [entry, savedHole], courses: [] });
      expect(lib.holes.map((h) => h.name), JSON.stringify(entry).slice(0, 60)).toEqual(['Good']);
    }
    // The same id twice keeps the first.
    expect(parseLibrary({ version: 1, holes: [savedHole, { ...savedHole, name: 'Copy' }], courses: [] }).holes).toHaveLength(1);
  });

  it('drops a course that is not 18 holes it knows', () => {
    const ok = course();
    for (const bad of [
      { ...ok, id: 'x:1' },
      { ...ok, id: 'c:a:b' },
      { ...ok, holes: ok.holes.slice(1) },
      { ...ok, holes: [...ok.holes, 'b:0:1'] },
      { ...ok, holes: ['b:9:1', ...ok.holes.slice(1)] },
      { ...ok, holes: [1, ...ok.holes.slice(1)] },
      { ...ok, name: null },
      { ...ok, saved: 'yesterday' },
    ]) {
      expect(parseLibrary({ version: 1, holes: [], courses: [bad, { ...ok, id: 'c:2' }] }).courses.map((c) => c.id), JSON.stringify(bad).slice(0, 50)).toEqual(['c:2']);
    }
  });

  it('keeps the hole under the id it is kept by, whatever storage says', () => {
    const one = addHole(emptyLibrary(), 'One', drawnHole(4), 1);
    const stored = { ...at(one.lib.holes, 0), hole: { ...at(one.lib.holes, 0).hole, id: 's:somewhere-else' } };
    const lib = parseLibrary({ version: 1, holes: [stored], courses: [] });
    expect(defined(findHole(lib, one.id), 'saved hole').hole.id).toBe(one.id);
    expect(holeSource(lib).hole(one.id)?.id).toBe(one.id);
  });

  it('keeps names short and never blank', () => {
    expect(cleanName('  Windy corner  ', 'Hole')).toBe('Windy corner');
    expect(cleanName('   ', 'Hole')).toBe('Hole');
    expect(cleanName('x'.repeat(MAX_NAME + 10), 'Hole')).toBe('x'.repeat(MAX_NAME));
    const lib = parseLibrary({ version: 1, holes: [{ ...at(addHole(emptyLibrary(), 'a', drawnHole(), 1).lib.holes, 0), name: '  ' }], courses: [] });
    expect(at(lib.holes, 0).name).toBe('Hole');
  });
});

describe('keeping holes', () => {
  it('saves a hole under a fresh id, newest first, with the id on the hole itself', () => {
    const first = addHole(emptyLibrary(), 'One', drawnHole(3), 500);
    const second = addHole(first.lib, 'Two', drawnHole(5), 500);
    expect(second.id).not.toBe(first.id);
    expect(second.lib.holes.map((h) => h.name)).toEqual(['Two', 'One']);
    expect(defined(findHole(second.lib, second.id), 'saved hole').hole.id).toBe(second.id);
    expect(holeName(second.lib, first.id)).toBe('One');
  });

  it('renames and deletes, leaving a course that used the hole to say so', () => {
    const one = addHole(emptyLibrary(), 'One', drawnHole(), 1);
    const withCourse = putCourse(one.lib, course({ holes: [one.id, ...eighteen(0).slice(1)] }));
    const renamed = renameHole(withCourse, one.id, '  Dog leg  ');
    expect(holeName(renamed, one.id)).toBe('Dog leg');
    expect(renameHole(renamed, one.id, '  ')).toEqual(renamed);

    const gone = deleteHole(renamed, one.id);
    expect(findHole(gone, one.id)).toBeUndefined();
    expect(holeName(gone, one.id)).toBeNull();
    const kept = defined(findCourse(gone, 'c:1'), 'course');
    expect(missingHoles(gone, kept)).toEqual([1]);
    expect(courseStep(gone, courseToDraft(kept))).toBe(COURSE_MISSING);
  });

  it('saves a changed hole back over itself, keeping its id and its name', () => {
    const one = addHole(emptyLibrary(), 'One', drawnHole(3), 1);
    const lib = putCourse(one.lib, course({ holes: [one.id, ...eighteen(0).slice(1)] }));
    const back = replaceHole(lib, one.id, drawnHole(5));
    const saved = defined(findHole(back, one.id), 'saved hole');
    expect(saved.name).toBe('One');
    expect(saved.hole.par).toBe(5);
    expect(saved.hole.id).toBe(one.id);
    expect(back.holes).toHaveLength(1);
    // The course slot still points at it, now with the new par.
    expect(missingHoles(back, defined(findCourse(back, 'c:1'), 'course'))).toEqual([]);
    expect(holeSource(back).par(one.id)).toBe(5);
    expect(replaceHole(lib, 's:nobody', drawnHole(4))).toEqual(lib);
  });

  it('replaces a course saved under the same id, and forgets a deleted one', () => {
    const lib = putCourse(putCourse(emptyLibrary(), course()), course({ name: 'Renamed' }));
    expect(lib.courses).toHaveLength(1);
    expect(at(lib.courses, 0).name).toBe('Renamed');
    expect(deleteCourse(lib, 'c:1').courses).toEqual([]);
  });
});

describe('looking a hole up', () => {
  const saved = addHole(emptyLibrary(), 'Mine', drawnHole(5), 1);
  const lib: Library = saved.lib;

  it('answers a built-in hole from its number, and a saved one from the library', () => {
    const src = holeSource(lib);
    expect(src.par('b:0:1')).toBe(properPar(1));
    expect(src.par(saved.id)).toBe(5);
    expect(src.hole('b:3:5')?.id).toBe('b:3:5');
    expect(src.hole(saved.id)?.par).toBe(5);
    expect(holeName(lib, 'b:0:1')).toBe('Meadow Links 1');
  });

  it('answers nothing for a hole that is gone or an id it cannot read', () => {
    const src = holeSource(lib);
    for (const bad of ['s:gone', 'b:9:9', 'junk']) {
      expect(src.par(bad), bad).toBeNull();
      expect(src.hole(bad), bad).toBeNull();
      expect(holeName(lib, bad), bad).toBeNull();
      expect(practiceHole(lib, bad), bad).toBeNull();
    }
  });

  it('hands practice the hole and what to call it', () => {
    expect(practiceHole(lib, saved.id)).toEqual({ hole: defined(findHole(lib, saved.id), 'hole').hole, name: 'Mine' });
    expect(practiceHole(lib, 'b:4:11')?.name).toBe('Thunder Peaks 11');
  });

  it('adds a course up against its own holes', () => {
    const mixed = putCourse(lib, course({ holes: [saved.id, ...eighteen(0).slice(1)] }));
    const c = defined(findCourse(mixed, 'c:1'), 'course');
    expect(missingHoles(mixed, c)).toEqual([]);
    expect(coursePar(mixed, c)).toBe(72 - properPar(1) + 5);
    expect(coursePar(deleteHole(mixed, saved.id), c)).toBe(72 - properPar(1));
  });
});

describe('the hole picker', () => {
  it('shows every built-in course, and your own holes once there are some', () => {
    const groups = pickGroups(emptyLibrary());
    expect(groups.map((g) => g.name)).toEqual(COURSES.map((c) => c.name));
    const first = at(groups, 0);
    expect(first.items).toHaveLength(HOLES_PER_COURSE);
    expect(at(first.items, 0)).toEqual({ id: 'b:0:1', label: '1', par: properPar(1) });
    expect(first.items.map((i) => i.par)).toEqual(Array.from({ length: HOLES_PER_COURSE }, (_, n) => properPar(n + 1)));

    const mine = pickGroups(addHole(emptyLibrary(), 'Mine', drawnHole(3), 1).lib);
    const saved = at(mine, mine.length - 1);
    expect(saved.name).toBe('My holes');
    expect(at(saved.items, 0)).toMatchObject({ label: 'Mine', par: 3 });
  });
});

describe('putting a course together', () => {
  const lib = emptyLibrary();

  it('starts empty and says how many holes are still to go', () => {
    const draft = newCourseDraft(lib, 20);
    expect(draft.slots).toHaveLength(HOLES_PER_COURSE);
    expect(draft.slots.every((s) => s === null)).toBe(true);
    expect(courseStep(lib, draft)).toBe(`${PICK_HOLES} — 18 to go`);
    expect(draftPar(lib, draft)).toBe(0);
    expect(draftToCourse(draft, 20)).toBeNull();

    const one = setSlot(draft, 0, 'b:0:1');
    expect(courseStep(lib, one)).toBe(`${PICK_HOLES} — 17 to go`);
    expect(draftPar(lib, one)).toBe(properPar(1));
    expect(newCourseDraft(putCourse(lib, { ...course(), id: 'c:20' }), 20).id).not.toBe('c:20');
  });

  it('fills from a built-in course, then swaps and moves holes around', () => {
    const filled = fillFromCourse(newCourseDraft(lib, 1), 3);
    expect(filled.slots).toEqual(eighteen(3));
    expect(courseStep(lib, filled)).toBe(COURSE_READY);
    expect(draftPar(lib, filled)).toBe(72);

    const swapped = setSlot(filled, 0, 'b:4:11');
    expect(at(swapped.slots, 0)).toBe('b:4:11');
    const moved = moveSlot(swapped, 0, 1);
    expect(moved.slots.slice(0, 2)).toEqual(['b:3:2', 'b:4:11']);
    expect(moveSlot(moved, 1, -1)).toEqual(swapped);
    // Off either end nothing moves.
    expect(moveSlot(filled, 0, -1)).toEqual(filled);
    expect(moveSlot(filled, HOLES_PER_COURSE - 1, 1)).toEqual(filled);
    expect(moveSlot(filled, -1, 1)).toEqual(filled);
  });

  it('saves as a course with a name, and reads back as the draft it was', () => {
    const draft = setCourseName(fillFromCourse(newCourseDraft(lib, 1), 0), '  Mix  ');
    const saved = defined(draftToCourse(draft, 99), 'course');
    expect(saved).toEqual({ id: draft.id, name: 'Mix', saved: 99, holes: eighteen(0) });
    expect(courseToDraft(saved)).toEqual({ ...draft, name: 'Mix' });
    expect(defined(draftToCourse(setCourseName(draft, ''), 99), 'course').name).toBe('My course');
  });
});
