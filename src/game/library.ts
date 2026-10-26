/**
 * The holes and courses the player keeps on this device: the saved-hole and custom-course model, the guards that read
 * them back out of storage, and the lookups the screens draw. Pure — `src/main.ts` does the reading and writing, and
 * `src/ui/library.ts` draws it.
 *
 * Nothing here generates a hole to answer a question about one: a built-in hole's par comes from its number
 * (`properPar`), so a picker of all 90 holes costs nothing. Only `holeSource` generates, and only for the hole a
 * round is actually playing.
 */
import { itemAt } from '../engine/assert';
import { holeToDraft } from '../engine/builder';
import { COURSES, PROPER_HOLES, properPar } from '../engine/generator';
import { builtinHoleId, isHoleId, parseHoleId, savedHoleId } from '../engine/holeid';
import type { Cell, Hole } from '../engine/types';
import { also, arrayOf, intIn, isDir, isPoint, isString, oneOf, optional, shape } from './guards';
import { builtinSource, type HoleSource } from './game';

/** Holes in a custom course: the same 18 a Proper golf round plays. */
export const HOLES_PER_COURSE = PROPER_HOLES;

/** The longest a hole's or a course's name may be (what the name box accepts). */
export const MAX_NAME = 24;

/** A hole the player drew and kept. */
export interface SavedHole {
  /** `s:<key>`: what a course slot and a practice pick store. */
  id: string;
  name: string;
  /** When it was saved (ms since the epoch), so the list reads newest first. */
  saved: number;
  hole: Hole;
}

/** 18 holes the player picked, in order: any built-in hole, any saved hole, the same hole more than once if they like. */
export interface CustomCourse {
  /** `c:<key>`. */
  id: string;
  name: string;
  saved: number;
  /** Exactly `HOLES_PER_COURSE` hole ids. */
  holes: string[];
}

export interface Library {
  version: 1;
  holes: SavedHole[];
  courses: CustomCourse[];
}

export const emptyLibrary = (): Library => ({ version: 1, holes: [], courses: [] });

// ------------------------------------------------------------------ guards

const isCell = shape<Cell>({
  t: oneOf('rough', 'fairway', 'sand', 'water', 'tree'),
  slope: optional(isDir),
  v: optional(intIn(0, 1)),
  z: optional(oneOf(-1, 0, 1)),
});

/**
 * A hole read back out of storage: the shape guard covers every `Hole` field (a field added without one is a compile
 * error), and `holeToDraft` then holds it to a page the builder could have drawn — 13x20, that many cells, a par of
 * 3, 4 or 5, and the tee and the pin on the grid.
 */
const isHole = also(
  shape<Hole>({
    id: optional(isString),
    course: intIn(0),
    number: intIn(1),
    seed: intIn(),
    w: intIn(1),
    h: intIn(1),
    cells: arrayOf(isCell),
    tee: isPoint,
    cup: isPoint,
    par: intIn(1),
  }),
  (hole) => holeToDraft(hole) !== null,
);

const isSavedHoleId = (v: unknown): v is string => isHoleId(v) && parseHoleId(v)?.kind === 'saved';

const isSavedHole = shape<SavedHole>({ id: isSavedHoleId, name: isString, saved: intIn(0), hole: isHole });

const isCourseId = (v: unknown): v is string => typeof v === 'string' && /^c:[^:]+$/u.test(v);

const isCustomCourse = shape<CustomCourse>({
  id: isCourseId,
  name: isString,
  saved: intIn(0),
  holes: arrayOf(isHoleId, HOLES_PER_COURSE),
});

/**
 * The library in `v`. A saved hole or a course that does not read is dropped on its own, so one bad entry never costs
 * the player the rest; junk, a missing version or a version this release does not know reads as an empty library.
 * Names are trimmed to what the name box accepts, and a hole or course with a name left blank gets a plain one.
 */
export function parseLibrary(v: unknown): Library {
  const lib = emptyLibrary();
  if (typeof v !== 'object' || v === null || Reflect.get(v, 'version') !== 1) return lib;
  const holes: unknown = Reflect.get(v, 'holes');
  const courses: unknown = Reflect.get(v, 'courses');
  if (Array.isArray(holes)) {
    for (const h of holes) {
      if (!isSavedHole(h) || lib.holes.some((k) => k.id === h.id)) continue;
      // The hole carries the id it is kept under, whatever storage says: a round looks a hole up by that id, and
      // one that names a different one would say so on a card.
      lib.holes.push({ ...h, name: cleanName(h.name, 'Hole'), hole: { ...h.hole, id: h.id } });
    }
  }
  if (Array.isArray(courses)) {
    for (const c of courses) {
      if (!isCustomCourse(c) || lib.courses.some((k) => k.id === c.id)) continue;
      lib.courses.push({ ...c, name: cleanName(c.name, 'Course'), holes: [...c.holes] });
    }
  }
  return lib;
}

/** A name as it is kept: trimmed, at most `MAX_NAME` characters, never empty. */
export function cleanName(name: string, fallback: string): string {
  const trimmed = name.trim().slice(0, MAX_NAME).trim();
  return trimmed === '' ? fallback : trimmed;
}

// ------------------------------------------------------------------ changing it

/** A key no id in `taken` uses yet: the save time, with a counter when a second one lands in the same millisecond. */
function freshKey(taken: readonly string[], now: number): string {
  const base = String(Math.max(0, Math.trunc(now)));
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const key = `${base}-${String(n)}`;
    if (!taken.includes(key)) return key;
  }
}

/** Keep `hole` under `name`. The hole is stored with the id it is kept under, so a round can find it again. */
export function addHole(lib: Library, name: string, hole: Hole, now: number): { lib: Library; id: string } {
  const id = savedHoleId(freshKey(lib.holes.map((h) => h.id.slice(2)), now));
  const saved: SavedHole = { id, name: cleanName(name, 'Hole'), saved: now, hole: { ...hole, id } };
  return { lib: { ...lib, holes: [saved, ...lib.holes] }, id };
}

export function renameHole(lib: Library, id: string, name: string): Library {
  return { ...lib, holes: lib.holes.map((h) => (h.id === id ? { ...h, name: cleanName(name, h.name) } : h)) };
}

/**
 * Save `hole` back over the hole kept under `id` — what Save does to a hole opened from My holes. It keeps that id
 * (so every course slot and practice pick goes on pointing at it) and its name; an id that is not there changes
 * nothing.
 */
export function replaceHole(lib: Library, id: string, hole: Hole): Library {
  return { ...lib, holes: lib.holes.map((h) => (h.id === id ? { ...h, hole: { ...hole, id } } : h)) };
}

/** Forget a saved hole. Courses that used it keep the slot, which then reads as a hole that is gone. */
export function deleteHole(lib: Library, id: string): Library {
  return { ...lib, holes: lib.holes.filter((h) => h.id !== id) };
}

/** Add a course, or replace the one with the same id (editing one). The newest is listed first. */
export function putCourse(lib: Library, course: CustomCourse): Library {
  const rest = lib.courses.filter((c) => c.id !== course.id);
  return { ...lib, courses: [{ ...course, holes: [...course.holes] }, ...rest] };
}

export function deleteCourse(lib: Library, id: string): Library {
  return { ...lib, courses: lib.courses.filter((c) => c.id !== id) };
}

export const findHole = (lib: Library, id: string): SavedHole | undefined => lib.holes.find((h) => h.id === id);
export const findCourse = (lib: Library, id: string): CustomCourse | undefined => lib.courses.find((c) => c.id === id);

// ------------------------------------------------------------------ looking holes up

/**
 * Where a round finds the holes of a custom course: the built-in ones from the generator (the layout only when it is
 * played), the saved ones from `lib`. A hole that is gone answers null, which is what stops a round starting on it.
 */
export function holeSource(lib: Library): HoleSource {
  const saved = new Map(lib.holes.map((h) => [h.id, h.hole]));
  return {
    par(id) {
      return saved.get(id)?.par ?? builtinSource.par(id);
    },
    hole(id) {
      return saved.get(id) ?? builtinSource.hole(id);
    },
  };
}

/** What to call hole `id` on a card or in a list ("Meadow Links 1", a saved hole's name), or null when it is gone. */
export function holeName(lib: Library, id: string): string | null {
  const ref = parseHoleId(id);
  if (ref === null) return null;
  if (ref.kind === 'saved') return findHole(lib, id)?.name ?? null;
  const course = COURSES[ref.course];
  return course === undefined ? null : `${course.name} ${String(ref.number)}`;
}

/** The holes of `course` that are gone (their slot numbers, 1-based). Empty when it is ready to play. */
export function missingHoles(lib: Library, course: CustomCourse): number[] {
  const src = holeSource(lib);
  return course.holes.flatMap((id, i) => (src.par(id) === null ? [i + 1] : []));
}

/** The total par of a course's holes, counting a hole that is gone as 0. */
export function coursePar(lib: Library, course: CustomCourse): number {
  const src = holeSource(lib);
  return course.holes.reduce((a, id) => a + (src.par(id) ?? 0), 0);
}

// ------------------------------------------------------------------ the hole picker

export interface PickItem {
  id: string;
  /** What the button says: a hole number on a built-in course, the player's own name on a saved hole. */
  label: string;
  par: number;
}

export interface PickGroup {
  key: string;
  name: string;
  items: PickItem[];
}

/** One group per built-in course, then the player's own holes when there are any: what the shared picker shows. */
export function pickGroups(lib: Library): PickGroup[] {
  const groups: PickGroup[] = COURSES.map((c, i) => ({
    key: `b:${String(i)}`,
    name: c.name,
    items: Array.from({ length: HOLES_PER_COURSE }, (_, n) => ({
      id: builtinHoleId(i, n + 1),
      label: String(n + 1),
      par: properPar(n + 1),
    })),
  }));
  if (lib.holes.length > 0) {
    groups.push({
      key: 'saved',
      name: 'My holes',
      items: lib.holes.map((h) => ({ id: h.id, label: h.name, par: h.hole.par })),
    });
  }
  return groups;
}

// ------------------------------------------------------------------ putting a course together

/** A course being edited: 18 slots, each a hole id or still empty. */
export interface CourseDraft {
  id: string;
  name: string;
  slots: (string | null)[];
}

export const PICK_HOLES = 'Pick 18 holes';
export const COURSE_READY = 'Ready — tap Save course';
export const COURSE_MISSING = 'A hole in this course is gone — pick another for it';

/** A new, empty course. Its id is settled now, so saving it twice replaces it rather than making a second course. */
export function newCourseDraft(lib: Library, now: number): CourseDraft {
  const key = freshKey(lib.courses.map((c) => c.id.slice(2)), now);
  return { id: `c:${key}`, name: '', slots: Array<string | null>(HOLES_PER_COURSE).fill(null) };
}

export function courseToDraft(course: CustomCourse): CourseDraft {
  return { id: course.id, name: course.name, slots: [...course.holes] };
}

/** The course this draft saves as, or null while a slot is still empty. */
export function draftToCourse(draft: CourseDraft, now: number): CustomCourse | null {
  const holes: string[] = [];
  for (const id of draft.slots) {
    if (id === null) return null;
    holes.push(id);
  }
  return { id: draft.id, name: cleanName(draft.name, 'My course'), saved: now, holes };
}

export const setSlot = (draft: CourseDraft, i: number, id: string): CourseDraft => ({
  ...draft,
  slots: draft.slots.map((s, k) => (k === i ? id : s)),
});

export const setCourseName = (draft: CourseDraft, name: string): CourseDraft => ({ ...draft, name });

/** Swap slot `i` with the one `by` places along (−1 up, 1 down). Off either end, nothing moves. */
export function moveSlot(draft: CourseDraft, i: number, by: number): CourseDraft {
  const to = i + by;
  if (i < 0 || i >= draft.slots.length || to < 0 || to >= draft.slots.length) return draft;
  const slots = [...draft.slots];
  slots[i] = itemAt(draft.slots, to, 'course slot');
  slots[to] = itemAt(draft.slots, i, 'course slot');
  return { ...draft, slots };
}

/** Fill every slot with the 18 holes of built-in course `course`, in order: a start to swap holes into. */
export function fillFromCourse(draft: CourseDraft, course: number): CourseDraft {
  return { ...draft, slots: Array.from({ length: HOLES_PER_COURSE }, (_, n) => builtinHoleId(course, n + 1)) };
}

/** The one line that says what the course still needs, or that it is ready. Never asks the solver. */
export function courseStep(lib: Library, draft: CourseDraft): string {
  const empty = draft.slots.filter((s) => s === null).length;
  if (empty > 0) return `${PICK_HOLES} — ${String(empty)} to go`;
  const src = holeSource(lib);
  if (draft.slots.some((s) => s !== null && src.par(s) === null)) return COURSE_MISSING;
  return COURSE_READY;
}

/** The total par of what is picked so far (a hole that is gone, and an empty slot, count 0). */
export function draftPar(lib: Library, draft: CourseDraft): number {
  const src = holeSource(lib);
  return draft.slots.reduce((a, id) => a + (id === null ? 0 : (src.par(id) ?? 0)), 0);
}

/** A practice round's hole and what to call it, or null when that hole is gone. */
export function practiceHole(lib: Library, id: string): { hole: Hole; name: string } | null {
  const hole = holeSource(lib).hole(id);
  const name = holeName(lib, id);
  return hole === null || name === null ? null : { hole, name };
}
