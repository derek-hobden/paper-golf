/**
 * Course bests, stored as one JSON object of strokes keyed by `<prefix>:<course>`. Rounds are Proper golf (par 72),
 * whose bests are `proper:<course>`. Entries from the retired 12-hole par-6 round (`dice:<course>`, and older
 * `speed:<course>`) are kept in storage untouched but never shown or compared against a par-72 round.
 */
export type Bests = Record<string, number>;

export const bestKey = (course: number) => `proper:${String(course)}`;

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

/** The best round (strokes) on `course`, if any. */
export const courseBest = (bests: Bests, course: number): number | undefined => bests[bestKey(course)];

/** Record a finished round's low score on `course`; true when it is a new best (and `bests` changed). */
export function recordBest(bests: Bests, course: number, strokes: number): boolean {
  const prev = courseBest(bests, course);
  if (prev !== undefined && prev <= strokes) return false;
  bests[bestKey(course)] = strokes;
  return true;
}
