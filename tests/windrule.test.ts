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
// The rule (README "Wind"):
// 1. The hit touches down on its un-winded aim (flight as without wind: the cup drops at touchdown or one dot short,
//    trees block unless hit from the fairway, water is flown over).
// 2. The wind pushes it its full vector from there, `strength` dots downwind; nothing in between counts. In a wind the
//    ball never comes down on the aim, so the aim is one more dot flown over by rule 1: trees on it block only off the
//    fairway, water and the page edge never do (issue 1: Derek's NE hit over the trees on Thunder Peaks 11).
// 3. Only the dot it ends on decides legality: off the page, water or trees means the shot is not offered; the cup holes.
// 4. Only then do slopes roll it on from that dot, chaining, stopping before off the page, water, trees or a dot
//    already rolled onto; the cup holes.
//
// The oracle below deliberately uses nothing from rules.ts, so a bug there cannot hide in the expectation.

const SEED = 20261017;
const SAMPLES = 300_000;
const STRENGTHS: readonly Wind['strength'][] = [0, 1, 2];

const holes: Hole[] = COURSES.flatMap((_, c) => Array.from({ length: PROPER_HOLES }, (_, n) => generateProperHole(c, n + 1)));

const onPage = (h: Hole, p: P) => p.x >= 0 && p.y >= 0 && p.x < h.w && p.y < h.h;
const terrain = (h: Hole, p: P) => gridAt(h.cells, h.w, p.x, p.y).t;
const slopeAt = (h: Hole, p: P) => gridAt(h.cells, h.w, p.x, p.y).slope;
const restable = (h: Hole, p: P) => onPage(h, p) && terrain(h, p) !== 'water' && terrain(h, p) !== 'tree';
const same = (a: P, b: P) => a.x === b.x && a.y === b.y;
const move = (p: P, d: Dir, k: number): P => ({ x: p.x + DIRS[d].x * k, y: p.y + DIRS[d].y * k });
const key = (p: P) => `${String(p.x)},${String(p.y)}`;
const show = (p: P) => `(${key(p)})`;

type Case =
  | 'blown off the page'
  | 'blown into water'
  | 'blown into trees'
  | 'brought back onto the page'
  | 'carried on from water'
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

/** What the rule says a hit of `dist` in `dir` from `from` in wind `w` does. */
function expected(h: Hole, from: P, dir: Dir, dist: number, w: Wind): Expected {
  const fromFairway = terrain(h, from) === 'fairway';
  for (let k = 1; k < dist; k++) {
    const p = move(from, dir, k);
    if (same(p, h.cup) && k === dist - 1) return { legal: true, holed: true, end: p, cases: [] };
    if (onPage(h, p) && terrain(h, p) === 'tree' && !fromFairway) return { legal: false, holed: false, end: p, cases: [] };
  }
  const touchdown = move(from, dir, dist);
  if (same(touchdown, h.cup)) return { legal: true, holed: true, end: touchdown, cases: [] };

  const cases: Case[] = [];
  const rest = move(touchdown, w.dir, w.strength);
  const blown = !same(rest, touchdown);
  if (onPage(h, touchdown) && !restable(h, touchdown)) {
    // Rule 2: calm, the ball comes down on the aim and stays there; in a wind it is still in the air, so the aim is
    // one more dot flown over and only trees off the fairway stop it.
    const trees = terrain(h, touchdown) === 'tree';
    if (!blown || (trees && !fromFairway)) return { legal: false, holed: false, end: touchdown, cases };
    cases.push(trees ? 'carried on from trees' : 'carried on from water');
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
    checked++;
    for (const c of want.cases) seenCases.set(c, (seenCases.get(c) ?? 0) + 1);
    const got = resolveShot(h, from, dir, dist, w);
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
    'blown off the page',
    'blown into water',
    'blown into trees',
    'brought back onto the page',
    'carried on from water',
    'carried on from trees',
    'blown off a slope',
    'blown, then rolled',
    'holed by the wind',
    'blown over the cup',
  ])('the sample covers: %s', (c) => {
    expect(seenCases.get(c) ?? 0).toBeGreaterThan(0);
  });
});
