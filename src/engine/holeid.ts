/**
 * What a saved course slot or a practice pick points at. A hole's id is a short string so it stores and compares as
 * one value: `b:<course>:<number>` for a built-in hole (the generator pins those layouts, so the id keeps naming the
 * same hole after an update), `s:<key>` for a hole the player saved on this device. Pure: no DOM, no storage.
 *
 * The two sizes below are the built-in library's shape, kept here so an id can be read without loading the generator
 * (`tests/library.test.ts` holds them to `COURSES.length` and `PROPER_HOLES`).
 */
export const BUILTIN_COURSES = 5;
export const BUILTIN_HOLES_PER_COURSE = 18;

export type HoleRef = { kind: 'builtin'; course: number; number: number } | { kind: 'saved'; key: string };

/** The id of built-in hole `number` (1..18) in course `course` (0..4). */
export const builtinHoleId = (course: number, number: number) => `b:${String(course)}:${String(number)}`;

/** The id of a hole saved under `key`. */
export const savedHoleId = (key: string) => `s:${key}`;

/** A digit string as a whole number (no signs, no spaces, no exponents), or null. */
function whole(s: string | undefined): number | null {
  if (s === undefined || !/^\d{1,4}$/u.test(s)) return null;
  return Number(s);
}

/** What `id` points at, or null when it is not a hole id at all (junk, or an id from a newer version). */
export function parseHoleId(id: string): HoleRef | null {
  if (id.startsWith('s:')) {
    const key = id.slice(2);
    return key === '' || key.includes(':') ? null : { kind: 'saved', key };
  }
  if (!id.startsWith('b:')) return null;
  const parts = id.slice(2).split(':');
  if (parts.length !== 2) return null;
  const course = whole(parts[0]);
  const number = whole(parts[1]);
  if (course === null || number === null) return null;
  if (course >= BUILTIN_COURSES || number < 1 || number > BUILTIN_HOLES_PER_COURSE) return null;
  return { kind: 'builtin', course, number };
}

/** Whether `v` is a hole id this version understands. */
export const isHoleId = (v: unknown): v is string => typeof v === 'string' && parseHoleId(v) !== null;
