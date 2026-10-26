import { describe, expect, it } from 'vitest';
import { COURSES, PROPER_HOLES, generateProperHole } from '../src/engine/generator';
import { gridAt } from '../src/engine/grid';
import { mulberry32, pick, randInt } from '../src/engine/rng';
import { resolveShot } from '../src/engine/rules';
import { DIRS, type Dir, type Hole, type P, type Wind } from '../src/engine/types';
import { dirs } from './helpers';

// Derek's wind rule, stated once and checked against `resolveShot` on sampled shots over all 90 real holes, so a wrong
// rule fails `npm run check` instead of reaching Derek. Every past wrong rules.ts fails it: 581f606 (wind bolted on
// after slopes), b2c6d1a (slopes before the wind), 1592349 (clamped at the edge), de40ff9 (push stopped before trees).
//
// The rule (README "Wind"), with the ground's height (README "Elevation") ahead of it:
// 0. The hit carries its distance less the climb from the ball to the dot it would have come down on — uphill shorter,
//    downhill further — never less than 1 dot, and that one dot's height is the only one read. The whole flight below
//    is then flown at that carry.
// 1. The hit touches down on its un-winded aim (flight as without wind: the cup drops at touchdown or one dot short,
//    trees block unless hit from the fairway, water is flown over).
// 2. The wind pushes it its full vector from there, `strength` dots downwind; nothing in between counts. A hit from
//    the fairway is still in the air over its aim, so a wind carries it on over trees there, like any other dot it
//    flies over by rule 1 (issue 1: Derek's NE hit over the trees on Thunder Peaks 11). The page edge never stops it
//    either: an aim off the page counts when the wind brings it back.
// 3. Only the dot it ends on decides legality: off the page, water or trees means the shot is not offered; the cup holes.
// 4. Only then do slopes roll it on from that dot, chaining, stopping before off the page, water, trees or a dot
//    already rolled onto; the cup holes.
//
// Excluded, pending Derek's decision (pitfall audit item 10, not approved): the other two ways an aim on the page is
// not a dot the ball can rest on — water on it, and trees on it when the hit did not come from the fairway. Today
// both are always illegal, even when the wind would carry the ball onto rough; this test asserts nothing either way
// about them. Issue 1 settled the fairway-and-trees case above and only that one.
//
// The oracle below deliberately uses nothing from rules.ts, so a bug there cannot hide in the expectation.

const SEED = 20261017;
const SAMPLES = 300_000;
const STRENGTHS: readonly Wind['strength'][] = [0, 1, 2];

const holes: Hole[] = COURSES.flatMap((_, c) => Array.from({ length: PROPER_HOLES }, (_, n) => generateProperHole(c, n + 1)));

const onPage = (h: Hole, p: P) => p.x >= 0 && p.y >= 0 && p.x < h.w && p.y < h.h;
const terrain = (h: Hole, p: P) => gridAt(h.cells, h.w, p.x, p.y).t;
const slopeAt = (h: Hole, p: P) => gridAt(h.cells, h.w, p.x, p.y).slope;
const height = (h: Hole, p: P) => (onPage(h, p) ? (gridAt(h.cells, h.w, p.x, p.y).z ?? 0) : 0);
const restable = (h: Hole, p: P) => onPage(h, p) && terrain(h, p) !== 'water' && terrain(h, p) !== 'tree';
const same = (a: P, b: P) => a.x === b.x && a.y === b.y;
const move = (p: P, d: Dir, k: number): P => ({ x: p.x + DIRS[d].x * k, y: p.y + DIRS[d].y * k });
const key = (p: P) => `${String(p.x)},${String(p.y)}`;
const show = (p: P) => `(${key(p)})`;

type Case =
  | 'carried further by the ground'
  | 'cut short by the ground'
  | 'blown off the page'
  | 'blown into water'
  | 'blown into trees'
  | 'brought back onto the page'
  | 'carried on from trees'
  | 'blown off a slope'
  | 'blown, then rolled'
  | 'holed by the wind'
  | 'blown over the cup';

interface Expected {
  legal: boolean;
  holed: boolean;
  /** Where the ball ends (the cup when holed); only checked when legal. */
  end: P;
  cases: Case[];
}

/** What the rule says a hit of `dist` in `dir` from `from` in wind `w` does, or null for an excluded case. */
function expected(h: Hole, from: P, dir: Dir, dist: number, w: Wind): Expected | null {
  const fromFairway = terrain(h, from) === 'fairway';
  const cases: Case[] = [];
  // Rule 0: the ground's height, worked out from the dot a level hit would have come down on and nothing else.
  const carry = Math.max(1, dist - (height(h, move(from, dir, dist)) - height(h, from)));
  if (carry !== dist) cases.push(carry > dist ? 'carried further by the ground' : 'cut short by the ground');
  for (let k = 1; k < carry; k++) {
    const p = move(from, dir, k);
    if (same(p, h.cup) && k === carry - 1) return { legal: true, holed: true, end: p, cases };
    if (onPage(h, p) && terrain(h, p) === 'tree' && !fromFairway) return { legal: false, holed: false, end: p, cases };
  }
  const touchdown = move(from, dir, carry);
  if (same(touchdown, h.cup)) return { legal: true, holed: true, end: touchdown, cases };

  const rest = move(touchdown, w.dir, w.strength);
  const blown = !same(rest, touchdown);
  if (onPage(h, touchdown) && !restable(h, touchdown)) {
    // Rule 2: calm, the ball comes down on the aim and stays there. In a wind, a hit from the fairway is still in the
    // air over trees on its aim and is carried on; water on the aim, and trees on it from off the fairway, are the
    // excluded cases above, so the rule says nothing about them.
    if (!blown) return { legal: false, holed: false, end: touchdown, cases };
    if (terrain(h, touchdown) !== 'tree' || !fromFairway) return null;
    cases.push('carried on from trees');
  }
  if (blown && !onPage(h, touchdown) && restable(h, rest)) cases.push('brought back onto the page');
  if (w.strength === 2 && same(move(touchdown, w.dir, 1), h.cup) && blown) cases.push('blown over the cup');
  if (!restable(h, rest)) {
    if (blown && onPage(h, touchdown))
      cases.push(!onPage(h, rest) ? 'blown off the page' : terrain(h, rest) === 'water' ? 'blown into water' : 'blown into trees');
    return { legal: false, holed: false, end: rest, cases };
  }
  if (same(rest, h.cup)) return { legal: true, holed: true, end: rest, cases: blown ? [...cases, 'holed by the wind'] : cases };
  if (blown && onPage(h, touchdown) && slopeAt(h, touchdown) !== undefined) cases.push('blown off a slope');

  const seen = new Set([key(rest)]);
  let at = rest;
  for (let s = slopeAt(h, at); s !== undefined; s = slopeAt(h, at)) {
    const next = move(at, s, 1);
    if (same(next, h.cup)) return { legal: true, holed: true, end: next, cases };
    if (!restable(h, next) || seen.has(key(next))) break;
    seen.add(key(next));
    at = next;
  }
  if (blown && !same(at, rest)) cases.push('blown, then rolled');
  return { legal: true, holed: false, end: at, cases };
}

describe("the wind rule over all 90 holes (Derek's words, README 'Wind')", () => {
  const rng = mulberry32(SEED);
  const mismatches: string[] = [];
  const seenCases = new Map<Case, number>();
  let checked = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const h = pick(rng, holes);
    const from = { x: randInt(rng, 0, h.w - 1), y: randInt(rng, 0, h.h - 1) };
    const dir = pick(rng, dirs);
    const dist = randInt(rng, 2, 7); // hits are 2..7 dots (die 1..6, +1 from the fairway); 1-dot shots are putts
    const w: Wind = { strength: pick(rng, STRENGTHS), dir: pick(rng, dirs) };
    if (!restable(h, from) || same(from, h.cup)) continue;
    const want = expected(h, from, dir, dist, w);
    if (!want) continue;
    checked++;
    for (const c of want.cases) seenCases.set(c, (seenCases.get(c) ?? 0) + 1);
    const got = resolveShot(h, from, dir, dist, w, false, true);
    const ok = got.legal === want.legal && (!want.legal || (got.holed === want.holed && same(got.end, want.end)));
    if (!ok)
      mismatches.push(
        `course ${String(h.course)} hole ${String(h.number)} from ${show(from)} dir ${String(dir)} dist ${String(dist)} ` +
          `wind ${String(w.strength)}/${String(w.dir)}: got legal=${String(got.legal)} holed=${String(got.holed)} end ${show(got.end)}, ` +
          `want legal=${String(want.legal)} holed=${String(want.holed)} end ${show(want.end)}`,
      );
  }

  it('resolveShot agrees with the rule on every sampled hit', () => {
    expect(checked).toBeGreaterThan(SAMPLES / 2);
    expect(mismatches.length, `${String(mismatches.length)} of ${String(checked)} hits break the rule, e.g.\n${mismatches.slice(0, 5).join('\n')}`).toBe(0);
  });

  it.each<Case>([
    'carried further by the ground',
    'cut short by the ground',
    'blown off the page',
    'blown into water',
    'blown into trees',
    'brought back onto the page',
    'carried on from trees',
    'blown off a slope',
    'blown, then rolled',
    'holed by the wind',
    'blown over the cup',
  ])('the sample covers: %s', (c) => {
    expect(seenCases.get(c) ?? 0).toBeGreaterThan(0);
  });
});
