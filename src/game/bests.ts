/**
 * Course bests, stored as one JSON object of strokes keyed by `<prefix>:<course>`. Rounds are Proper golf (par 72),
 * whose bests are `proper:<course>`, and courses the player put together themselves, whose bests are
 * `custom:<course id>` — each custom course keeps its own best, against its own par. Entries from the retired
 * 12-hole par-6 round (`dice:<course>`, and older `speed:<course>`) are kept in storage untouched but never shown or
 * compared against a par-72 round.
 */
export type Bests = Record<string, number>;

export const bestKey = (course: number) => `proper:${String(course)}`;

/** The bests key of a custom course (`c:<key>`), which is its own course however its holes were picked. */
export const customBestKey = (courseId: string) => `custom:${courseId}`;

/** Saved bests: every finite numeric entry; anything else (junk, old formats, a non-object) is skipped, never thrown on. */
export function parseBests(v: unknown): Bests {
  const out: Bests = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const k of Object.keys(v)) {
    const n: unknown = Reflect.get(v, k);
    if (typeof n === 'number' && Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** The best round (strokes) under `key`, if any. */
export const bestAt = (bests: Bests, key: string): number | undefined => bests[key];

/** Record a finished round's low score under `key`; true when it is a new best (and `bests` changed). */
export function recordBestAt(bests: Bests, key: string, strokes: number): boolean {
  const prev = bestAt(bests, key);
  if (prev !== undefined && prev <= strokes) return false;
  bests[key] = strokes;
  return true;
}

/** The best round (strokes) on Proper golf `course`, if any. */
export const courseBest = (bests: Bests, course: number): number | undefined => bestAt(bests, bestKey(course));

/** Record a finished Proper golf round's low score on `course`; true when it is a new best. */
export const recordBest = (bests: Bests, course: number, strokes: number): boolean => recordBestAt(bests, bestKey(course), strokes);
