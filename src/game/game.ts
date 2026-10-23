import { itemAt } from '../engine/assert';
import { COURSES, PROPER_HOLES, generateProperHole, properPar } from '../engine/generator';
import {
  MAX_STROKES,
  MULLIGANS_PER_ROUND,
  dotsApart,
  legalMoves,
  movesForRoll,
  resolveShot,
  type Move,
  type RollMove,
  type ShotResult,
} from '../engine/rules';
import { rainForHole } from '../engine/rain';
import { CALM, type Cell, type Dir, type Hole, type P, type Wind } from '../engine/types';
import { windForHole } from '../engine/wind';

export const PLAYER_COLORS = ['#2b2b2e', '#2856a8', '#c2412d', '#2f7d4a'];

export interface ShotRecord {
  from: P;
  dir: Dir;
  dist: number;
  landing: P;
  end: P;
  rolled: boolean;
  holed: boolean;
  kind: 'hit' | 'putt';
  /** The dots slopes rolled the ball onto, in order (a chain of slopes). Absent with no roll and in older saves. */
  rolls?: P[];
  /** The wind pushed the ball off where it came down (it ends on `end`). Absent when calm, for putts and in older saves. */
  blown?: true;
  /** A tap-in played automatically from next to the cup (no roll, no aim). Absent in older saves. */
  auto?: true;
}

export interface BallState {
  pos: P;
  strokes: number;
  holed: boolean;
  pickedUp: boolean;
  shots: ShotRecord[];
}

export interface PlayerState {
  name: string;
  color: string;
  /** Strokes per hole (null = not played yet). */
  scores: (number | null)[];
  mulligans: number;
}

export interface DiceState {
  value: number;
  /** The free tee-shot re-roll has been used (you must keep the second roll). */
  teeRerolled: boolean;
}

/** Holes in a round: the game is Proper golf, 18 holes of par 3, 4 and 5 (par 72). */
export const HOLES_IN_ROUND = PROPER_HOLES;

/** Par of hole `holeIndex` (0-based). */
export const holePar = (holeIndex: number) => properPar(holeIndex + 1);

/** Every hole's par, in order. */
export const roundPars = (): number[] => Array.from({ length: HOLES_IN_ROUND }, (_, i) => holePar(i));

/** Par for the whole round (72). */
export const ROUND_PAR = roundPars().reduce((a, b) => a + b, 0);

export interface GameState {
  version: 1;
  course: number;
  holeIndex: number;
  players: PlayerState[];
  balls: BallState[];
  current: number;
  dice: DiceState | null;
  holeDone: boolean;
  finished: boolean;
  /** Seeds every hole's wind (`windForHole`). Absent in rounds saved before wind: those stay calm throughout. */
  windSeed?: number;
  /** This hole's wind, rolled at its start and the same for every player. Absent (calm) in older saves. */
  wind?: Wind;
  /** Seeds every hole's rain (`rainForHole`). Absent in rounds saved before rain: those stay dry throughout. */
  rainSeed?: number;
  /** Whether this hole is rainy, rolled at its start and the same for every player. Absent (dry) in older saves. */
  rain?: boolean;
}

declare const persisted: unique symbol;
/** A round that may be saved: one `newGame` started or `loadState` loaded. A ?play= deep-link round never is. */
export type PersistedGame = GameState & { readonly [persisted]: true };

const persistedRounds = new WeakSet<GameState>();

function persist(state: GameState): asserts state is PersistedGame {
  persistedRounds.add(state);
}

/** `state` is a saved round (`newGame`, `loadState`), not a ?play= deep-link round (`newLinkGame`) or a copy. */
export const isPersisted = (state: GameState): state is PersistedGame => persistedRounds.has(state);

/**
 * A new round. `windSeed` fixes every hole's wind and `rainSeed` its rain, so the same pair of seeds replays the
 * same weather.
 */
export function newGame(course: number, names: string[], windSeed = 0, rainSeed = 0): PersistedGame {
  const state = startRound(course, names, windSeed, rainSeed);
  persist(state);
  return state;
}

function blankRound(course: number, names: readonly string[], windSeed = 0, rainSeed = 0): GameState {
  if (names.length < 1 || names.length > 4) throw new Error('1-4 players');
  const players = names.map((name, i) => ({
    name: name.trim() || `Player ${String(i + 1)}`,
    color: itemAt(PLAYER_COLORS, i, 'player colour'),
    scores: Array<number | null>(HOLES_IN_ROUND).fill(null),
    mulligans: MULLIGANS_PER_ROUND,
  }));
  return {
    version: 1,
    course,
    holeIndex: 0,
    players,
    balls: [],
    current: 0,
    dice: null,
    holeDone: false,
    finished: false,
    windSeed: windSeed >>> 0,
    rainSeed: rainSeed >>> 0,
  };
}

function startRound(course: number, names: readonly string[], windSeed = 0, rainSeed = 0): GameState {
  const state = blankRound(course, names, windSeed, rainSeed);
  resetBalls(state);
  return state;
}

/** Holes a player drew. Not on the state object, so a save can never carry one (and a built round is never persisted). */
const builtHoles = new WeakMap<GameState, Hole>();

function cloneHole(hole: Hole): Hole {
  return {
    ...hole,
    tee: { ...hole.tee },
    cup: { ...hole.cup },
    cells: hole.cells.map((c): Cell => ({ ...c })),
  };
}

/**
 * One round on a hole the player drew. The usual weather (`windForHole`, `rainForHole`) and rules, one hole, and
 * not a saved round: it cannot overwrite the real one, and it is not a course best (`recordsCourseBest`).
 */
export function newBuiltRound(hole: Hole, names: readonly string[], windSeed = 0, rainSeed = 0): GameState {
  const state = blankRound(0, names, windSeed, rainSeed);
  builtHoles.set(state, cloneHole(hole));
  resetBalls(state);
  return state;
}

/** The hole this round was built from, if it is a built round. */
export function builtHole(state: GameState): Hole | undefined {
  return builtHoles.get(state);
}

/** How many holes this round plays: one for a built hole, 18 otherwise. */
export function holesInRound(state: GameState): number {
  return builtHoles.has(state) ? 1 : HOLES_IN_ROUND;
}

/** A finished built hole is not written into the course bests. Every other round is. */
export function recordsCourseBest(state: GameState): boolean {
  return !builtHoles.has(state);
}

function resetBalls(state: GameState) {
  const hole = currentHole(state);
  state.balls = state.players.map(() => ({ pos: { ...hole.tee }, strokes: 0, holed: false, pickedUp: false, shots: [] }));
  state.dice = null;
  state.holeDone = false;
  state.wind = state.windSeed === undefined ? CALM : windForHole(state.windSeed, state.course, state.holeIndex);
  state.rain = state.rainSeed === undefined ? false : rainForHole(state.rainSeed, state.course, state.holeIndex);
}

/** The wind on the current hole (calm in rounds saved before wind). */
export const holeWind = (state: GameState): Wind => state.wind ?? CALM;

/** Whether the current hole is rainy (dry in rounds saved before rain). */
export const holeRain = (state: GameState): boolean => state.rain ?? false;

export function currentHole(state: GameState): Hole {
  return builtHoles.get(state) ?? generateProperHole(state.course, state.holeIndex + 1);
}

export const ballDone = (b: BallState) => b.holed || b.pickedUp;

export function currentBall(state: GameState): BallState {
  return itemAt(state.balls, state.current, 'ball');
}

export function currentPlayer(state: GameState): PlayerState {
  return itemAt(state.players, state.current, 'player');
}

export function canTeeReroll(state: GameState): boolean {
  return !!state.dice && currentBall(state).strokes === 0 && !state.dice.teeRerolled;
}

export function canMulligan(state: GameState): boolean {
  return !!state.dice && currentPlayer(state).mulligans > 0;
}

/** Roll the die for the current player's shot (value 1..6 supplied by the caller). */
export function roll(state: GameState, value: number): void {
  assertDie(value);
  if (state.dice || state.holeDone || autoPuttMove(state)) throw new Error('cannot roll now');
  state.dice = { value, teeRerolled: false };
}

export function teeReroll(state: GameState, value: number): void {
  assertDie(value);
  if (!canTeeReroll(state)) throw new Error('no tee re-roll available');
  state.dice = { value, teeRerolled: true };
}

export function mulligan(state: GameState, value: number): void {
  assertDie(value);
  const dice = state.dice;
  if (!dice || !canMulligan(state)) throw new Error('no mulligan available');
  currentPlayer(state).mulligans--;
  state.dice = { value, teeRerolled: dice.teeRerolled };
}

function assertDie(v: number) {
  if (!Number.isInteger(v) || v < 1 || v > 6) throw new Error(`bad die value ${String(v)}`);
}

export type MoveOption = RollMove;

/** Every legal shot for the current player right now: a putt, plus a hit of the rolled distance or a green putt. */
export function availableMoves(state: GameState): MoveOption[] {
  if (state.holeDone || state.finished || !state.dice) return [];
  return movesForRoll(currentHole(state), currentBall(state).pos, state.dice.value, holeWind(state), holeRain(state));
}

/**
 * The tap-in due for the current player, or null. A ball resting on any of the 8 cells around the cup (a putt
 * always holes from there, whatever the lie) is putted in automatically at the start of its turn: no roll, no aim.
 * A turn whose die is already showing (an older save) plays as before.
 */
export function autoPuttMove(state: GameState): Move | null {
  if (state.holeDone || state.finished || state.dice) return null;
  const ball = currentBall(state);
  if (ballDone(ball)) return null;
  return legalMoves(currentHole(state), ball.pos, 1, CALM, holeRain(state)).find((m) => m.result.holed) ?? null;
}

/** Play the due tap-in: one stroke, holed. */
export function autoPutt(state: GameState): { result: ShotResult; record: ShotRecord } {
  const move = autoPuttMove(state);
  if (!move) throw new Error('no tap-in due');
  return playShot(state, move.dir, move.dist, 'putt', true);
}

/**
 * The shot that holes out with the current roll, or null. After a roll (or re-roll, or mulligan), when any legal
 * target for it is the cup, that shot is played for the player: nobody wants anything else. One stroke, like a
 * tapped shot; a putt is preferred when both a putt and a hit would drop (same score, gentler shot).
 */
export function autoHoleMove(state: GameState): MoveOption | null {
  const holing = availableMoves(state).filter((m) => m.result.holed);
  return holing.find((m) => m.kind === 'putt') ?? holing[0] ?? null;
}

/** Play the shot that holes out with the current roll. */
export function autoHole(state: GameState): { result: ShotResult; record: ShotRecord } {
  const move = autoHoleMove(state);
  if (!move) throw new Error('the roll cannot reach the cup');
  return playShot(state, move.dir, move.dist, move.kind, false);
}

/** Play a shot. Returns the resolved result for animation. */
export function shoot(state: GameState, dir: Dir, dist: number): { result: ShotResult; record: ShotRecord } {
  const option = availableMoves(state).find((m) => m.dir === dir && m.dist === dist);
  if (!option) throw new Error('illegal shot');
  return playShot(state, dir, dist, option.kind, false);
}

function playShot(
  state: GameState,
  dir: Dir,
  dist: number,
  kind: MoveOption['kind'],
  auto: boolean,
): { result: ShotResult; record: ShotRecord } {
  const hole = currentHole(state);
  const ball = currentBall(state);
  // The same weather the move was offered with: hits are blown, putts never; wet ground holds every shot where it
  // comes to rest.
  const result = resolveShot(hole, ball.pos, dir, dist, kind === 'hit' ? holeWind(state) : CALM, holeRain(state));
  const record: ShotRecord = {
    from: { ...ball.pos },
    dir,
    dist,
    landing: result.landing,
    end: result.end,
    rolled: result.rolled,
    holed: result.holed,
    kind,
  };
  if (result.rolls) record.rolls = result.rolls.map((p) => ({ ...p }));
  if (result.blown) record.blown = true;
  if (auto) record.auto = true;
  ball.shots.push(record);
  ball.strokes++;
  ball.pos = { ...result.end };
  state.dice = null;
  const player = currentPlayer(state);
  if (result.holed) {
    ball.holed = true;
    player.scores[state.holeIndex] = ball.strokes;
  } else if (ball.strokes >= MAX_STROKES) {
    ball.pickedUp = true;
    player.scores[state.holeIndex] = MAX_STROKES;
  }
  advanceTurn(state);
  return { result, record };
}

function advanceTurn(state: GameState) {
  const next = nextToPlay(state);
  if (next === null) state.holeDone = true;
  else state.current = next;
}

/**
 * The order players tee off on hole `holeIndex` (player indices). Hole 1: the order they were set up. Every later
 * hole: lowest score on the previous hole first (the honour), ties keeping their order from the previous tee. Derived
 * from the card alone, so saves, deep links and replays always agree on it.
 */
export function teeOrder(state: GameState, holeIndex = state.holeIndex): number[] {
  let order = state.players.map((_, i) => i);
  for (let h = 0; h < holeIndex; h++) {
    const score = (i: number) => itemAt(state.players, i, 'player').scores[h] ?? MAX_STROKES + 1;
    order = [...order].sort((a, b) => score(a) - score(b)); // stable: ties keep the previous tee's order
  }
  return order;
}

/**
 * Who plays next by golf etiquette, or null when every ball is holed or picked up. Until everyone has teed off, the
 * next player in the tee order; after that, the ball furthest from the cup (in dots, as shots measure), ties going
 * to the earlier player in this hole's tee order. Re-evaluated after every shot, so a player can play twice running.
 */
export function nextToPlay(state: GameState): number | null {
  const order = teeOrder(state);
  const live = order.filter((i) => !ballDone(itemAt(state.balls, i, 'ball')));
  const toTee = live.find((i) => itemAt(state.balls, i, 'ball').strokes === 0);
  if (toTee !== undefined) return toTee;
  const cup = currentHole(state).cup;
  let best: number | null = null;
  let bestDist = -1;
  for (const i of live) {
    const d = dotsApart(itemAt(state.balls, i, 'ball').pos, cup);
    if (d > bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

export type TurnReason = 'honour' | 'tee' | 'away';

/**
 * A one-character mark per player for their ball on the course: the first letter of each name when those are all
 * different (A, B, C), else the player number (default names "Player 1", "Player 2" all start with P).
 */
export function playerMarks(names: readonly string[]): string[] {
  const initials = names.map((n) => (n.trim()[0] ?? '').toUpperCase());
  const unique = initials.every((c, i) => c !== '' && initials.indexOf(c) === i);
  return unique ? initials : names.map((_, i) => String(i + 1));
}

/** Why the current player is up, for the turn banner: first off the tee, on the tee, or away. Null in solo play. */
export function turnReason(state: GameState): TurnReason | null {
  if (state.players.length < 2 || state.holeDone || state.finished) return null;
  if (currentBall(state).strokes > 0) return 'away';
  return teeOrder(state)[0] === state.current ? 'honour' : 'tee';
}

/** Move on after everyone has holed out. Honours: the best score on the last hole tees off first. */
export function nextHole(state: GameState): void {
  if (!state.holeDone) throw new Error('hole not finished');
  if (builtHoles.has(state) || state.holeIndex + 1 >= HOLES_IN_ROUND) {
    state.finished = true;
    return;
  }
  state.holeIndex++;
  resetBalls(state);
  state.current = itemAt(teeOrder(state), 0, 'tee order');
}

/** A whole number from a URL param, clamped to `lo..hi`; missing, junk or below-range values become `lo`. */
function clampParam(raw: string | null, lo: number, hi: number): number {
  const n = Math.trunc(Number(raw));
  return raw && Number.isFinite(n) && n >= lo ? Math.min(hi, n) : lo;
}

export interface DeepLink {
  course: number;
  players: number;
  holeIndex: number;
}

/**
 * The `?play=<course>&players=<n>&hole=<n>` debug/deep link, clamped so it always names a real start:
 * course 0..COURSES.length-1, 1..4 players, hole 1..18 (past the end → the last hole; 0, negative or junk → 1).
 * Older links' `golf=` and `mode=` params are ignored.
 */
export function parseDeepLink(q: Pick<URLSearchParams, 'get'>): DeepLink {
  return {
    course: clampParam(q.get('play'), 0, COURSES.length - 1),
    players: clampParam(q.get('players'), 1, PLAYER_COLORS.length),
    holeIndex: clampParam(q.get('hole'), 1, HOLES_IN_ROUND) - 1,
  };
}

/**
 * The round a deep link starts: `link.players` of `names` on its course, skipped to its hole. It plays the default
 * weather seeds, so screenshots and tests reproduce, and it is never a saved round, so it can't overwrite the real one.
 */
export function newLinkGame(link: DeepLink, names: readonly string[]): GameState {
  const state = startRound(link.course, names.slice(0, link.players));
  skipToHole(state, link.holeIndex);
  return state;
}

/** Jump a fresh round to `holeIndex` (capped at the last hole), marking earlier holes done. Never loops past the end. */
export function skipToHole(state: GameState, holeIndex: number): void {
  const target = Math.min(HOLES_IN_ROUND - 1, holeIndex);
  while (state.holeIndex < target && !state.finished) {
    state.holeDone = true;
    nextHole(state);
  }
}

export function totalStrokes(p: PlayerState): number {
  return p.scores.reduce<number>((a, s) => a + (s ?? 0), 0);
}

/** Score relative to par over the holes played so far. A built round's only hole is scored against the par the player picked. */
export function toPar(p: PlayerState, state?: GameState): number {
  const built = state === undefined ? undefined : builtHoles.get(state);
  return p.scores.reduce<number>((a, s, i) => a + (s === null ? 0 : s - (built !== undefined && i === 0 ? built.par : holePar(i))), 0);
}

/** One scorecard total: par and strokes over a run of holes (strokes count holes played so far). */
export interface CardTotal {
  label: 'Out' | 'In' | 'Total';
  par: number;
  strokes: number;
  /** Strokes against par over the holes of this run played so far. */
  toPar: number;
  /** At least one of these holes has a score. */
  played: boolean;
}

/** The scorecard's total rows for one player: Out (holes 1-9), In (10-18), then Total. */
export function cardTotals(p: PlayerState): CardTotal[] {
  const pars = roundPars();
  const sum = (label: CardTotal['label'], from: number, to: number): CardTotal => {
    const scores = p.scores.slice(from, to);
    return {
      label,
      par: pars.slice(from, to).reduce((a, b) => a + b, 0),
      strokes: scores.reduce<number>((a, s) => a + (s ?? 0), 0),
      toPar: scores.reduce<number>((a, s, i) => a + (s === null ? 0 : s - holePar(from + i)), 0),
      played: scores.some((s) => s !== null),
    };
  };
  return [sum('Out', 0, 9), sum('In', 9, 18), sum('Total', 0, pars.length)];
}

export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  if (d <= -4) return 'Condor!';
  if (d === -3) return 'Albatross!';
  if (d === -2) return 'Eagle!';
  if (d === -1) return 'Birdie!';
  if (d === 0) return 'Par';
  if (d === 1) return 'Bogey';
  if (d === 2) return 'Double bogey';
  return `+${String(d)}`;
}

export function formatToPar(n: number): string {
  return n === 0 ? 'E' : n > 0 ? `+${String(n)}` : String(n);
}

// ------------------------------------------------------------------ saves

/** A check that a value read from storage is a `T`. */
export type Guard<T> = (v: unknown) => v is T;

const CHECKED: unique symbol = Symbol('checked');

/** A guard built by `arrayOf`, `shape`, `optional`, `nullable` or `orElse`, so whatever it holds is checked too. */
export type Checked<T> = Guard<T> & { readonly [CHECKED]: true };

type Primitive = string | number | boolean;

/**
 * The guard a field of type `T` needs. A primitive (maybe null or undefined) takes any guard; an object or array only
 * a `Checked` one, so every array is checked per element (`arrayOf`) and every object per field (`shape`): a bare
 * `Array.isArray`, or a hand-written object guard that uses one, does not type-check.
 */
export type FieldGuard<T> = [Exclude<T, null | undefined>] extends [Primitive] ? Guard<T> : Checked<T>;

/** One guard per field of `T`, optional fields included: a field without a guard is a compile error. */
export type GuardTable<T> = { [K in keyof T]-?: FieldGuard<T[K]> };

const checked = <T>(guard: Guard<T>): Checked<T> => Object.assign(guard, { [CHECKED]: true as const });

/** An array whose every element passes `element`; with `length`, exactly that many. */
export function arrayOf<T>(element: FieldGuard<T>, length?: number): Checked<T[]> {
  const each: Guard<T> = element;
  return checked((v: unknown): v is T[] => Array.isArray(v) && (length === undefined || v.length === length) && v.every((x) => each(x)));
}

/** An object whose every field passes its guard in `fields` (fields it has beyond those are left alone). */
function shape<T>(fields: GuardTable<T>): Checked<T> {
  const guards: Readonly<Record<string, Guard<unknown>>> = fields;
  return checked(
    (v: unknown): v is T => typeof v === 'object' && v !== null && Object.entries(guards).every(([k, guard]) => guard(Reflect.get(v, k))),
  );
}

function optional<T>(guard: FieldGuard<T>): Checked<T | undefined> {
  const g: Guard<T> = guard;
  return checked((v: unknown): v is T | undefined => v === undefined || g(v));
}

function nullable<T>(guard: FieldGuard<T>): Checked<T | null> {
  const g: Guard<T> = guard;
  return checked((v: unknown): v is T | null => v === null || g(v));
}

/** `guard`, except that a save whose field fails it loads with `fallback` there instead (undefined: the field is dropped). */
function orElse<T>(guard: FieldGuard<T>, fallback: T): Checked<T> & { readonly fallback: T } {
  const g: Guard<T> = guard;
  return Object.assign(checked((v: unknown): v is T => g(v)), { fallback });
}

const oneOf =
  <const T extends readonly Primitive[]>(...values: T): Guard<T[number]> =>
  (v: unknown): v is T[number] =>
    values.some((x) => x === v);

/** A whole number in `lo..hi`. */
const intIn =
  (lo = -Infinity, hi = Infinity): Guard<number> =>
  (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
const isString = (v: unknown): v is string => typeof v === 'string';
const isDir = oneOf(0, 1, 2, 3, 4, 5, 6, 7);
const isPoint = shape<P>({ x: intIn(), y: intIn() });

const isShot = shape<ShotRecord>({
  from: isPoint,
  dir: isDir,
  dist: intIn(0),
  landing: isPoint,
  end: isPoint,
  rolled: isBoolean,
  holed: isBoolean,
  kind: oneOf('hit', 'putt'),
  rolls: optional(arrayOf(isPoint)),
  blown: optional(oneOf(true)),
  auto: optional(oneOf(true)),
});

/**
 * One guard per `GameState` field, from which `isValidState` and `loadState` are built: adding a field without a
 * guard is a compile error, and arrays are checked element by element (turn order reads every ball's spot, 583a387).
 */
export const STATE_GUARDS = {
  version: oneOf(1),
  course: intIn(0, COURSES.length - 1),
  holeIndex: intIn(0, HOLES_IN_ROUND - 1),
  players: arrayOf(
    shape<PlayerState>({
      name: isString,
      color: isString,
      scores: arrayOf(nullable(intIn(0)), HOLES_IN_ROUND),
      mulligans: intIn(0),
    }),
  ),
  balls: arrayOf(
    shape<BallState>({ pos: isPoint, strokes: intIn(0), holed: isBoolean, pickedUp: isBoolean, shots: arrayOf(isShot) }),
  ),
  current: intIn(0),
  dice: nullable(shape<DiceState>({ value: intIn(1, 6), teeRerolled: isBoolean })),
  holeDone: isBoolean,
  finished: isBoolean,
  // Rounds saved before wind have neither field and play calm; a malformed wind is dropped (calm) rather than trusted.
  windSeed: orElse(optional(intIn()), undefined),
  wind: orElse(optional(shape<Wind>({ strength: oneOf(0, 1, 2), dir: isDir })), CALM),
  // The same for rain: a round saved before it has neither field and plays dry, and a malformed rain is dropped (dry).
  rainSeed: orElse(optional(intIn()), undefined),
  rain: orElse(optional(isBoolean), false),
} satisfies GuardTable<GameState>;

const isRound = shape<GameState>(STATE_GUARDS);

/**
 * Load a saved round, or null when it can't be played on. Rounds saved before the game went dice-only carry a `mode`
 * (and Speed Golf ones a `club` per shot); both are dropped. Proper golf saves from when it was a choice carry
 * `golf: 'proper'`, also dropped. Old 12-hole par-6 rounds (no `golf`, or `golf: 'default'`, and a 12-slot card)
 * are not valid any more: they load as null, so the player simply starts a fresh 18-hole round.
 */
export function loadState(s: unknown): PersistedGame | null {
  const saved = withFallbacks(s);
  if (!isValidState(saved)) return null;
  const g: GameState & { mode?: unknown; golf?: unknown } = saved;
  delete g.mode;
  delete g.golf;
  for (const b of g.balls) for (const shot of b.shots) delete (shot as ShotRecord & { club?: unknown }).club;
  // Rounds saved under the old round-robin turns pick up by etiquette; a player whose die is showing keeps the turn.
  if (!g.dice && !g.holeDone && !g.finished) advanceTurn(g);
  persist(g);
  return g;
}

/** A copy of the save `s` in which each field with a fallback (`orElse`) that fails its guard takes the fallback. */
function withFallbacks(s: unknown): unknown {
  if (typeof s !== 'object' || s === null) return s;
  const fields = new Map<string, unknown>(Object.entries(s));
  for (const [k, guard] of Object.entries(STATE_GUARDS)) {
    if (!('fallback' in guard) || guard(fields.get(k))) continue;
    if (guard.fallback === undefined) fields.delete(k);
    else fields.set(k, guard.fallback);
  }
  return Object.fromEntries(fields);
}

export function isValidState(s: unknown): s is GameState {
  if (typeof s === 'object' && s !== null && 'golf' in s && s.golf !== 'proper') return false;
  return isRound(s) && s.players.length >= 1 && s.balls.length === s.players.length && s.current < s.players.length;
}
