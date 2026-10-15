import { itemAt } from '../engine/assert';
import { COURSES, PROPER_HOLES, generateProperHole, properPar } from '../engine/generator';
import {
  MAX_STROKES,
  MULLIGANS_PER_ROUND,
  legalMoves,
  movesForRoll,
  resolveShot,
  type Move,
  type RollMove,
  type ShotResult,
} from '../engine/rules';
import type { Dir, Hole, P } from '../engine/types';

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
}

export function newGame(course: number, names: string[]): GameState {
  if (names.length < 1 || names.length > 4) throw new Error('1-4 players');
  const players = names.map((name, i) => ({
    name: name.trim() || `Player ${String(i + 1)}`,
    color: itemAt(PLAYER_COLORS, i, 'player colour'),
    scores: Array<number | null>(HOLES_IN_ROUND).fill(null),
    mulligans: MULLIGANS_PER_ROUND,
  }));
  const state: GameState = {
    version: 1,
    course,
    holeIndex: 0,
    players,
    balls: [],
    current: 0,
    dice: null,
    holeDone: false,
    finished: false,
  };
  resetBalls(state);
  return state;
}

function resetBalls(state: GameState) {
  const hole = currentHole(state);
  state.balls = state.players.map(() => ({ pos: { ...hole.tee }, strokes: 0, holed: false, pickedUp: false, shots: [] }));
  state.dice = null;
  state.holeDone = false;
}

export function currentHole(state: GameState): Hole {
  return generateProperHole(state.course, state.holeIndex + 1);
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
  return movesForRoll(currentHole(state), currentBall(state).pos, state.dice.value);
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
  return legalMoves(currentHole(state), ball.pos, 1).find((m) => m.result.holed) ?? null;
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
  const result = resolveShot(hole, ball.pos, dir, dist);
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
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const next = (state.current + i) % n;
    if (!ballDone(itemAt(state.balls, next, 'ball'))) {
      state.current = next;
      return;
    }
  }
  state.holeDone = true;
}

/** Move on after everyone has holed out. Honours: the best score on the last hole tees off first. */
export function nextHole(state: GameState): void {
  if (!state.holeDone) throw new Error('hole not finished');
  const last = state.holeIndex;
  if (last + 1 >= HOLES_IN_ROUND) {
    state.finished = true;
    return;
  }
  state.holeIndex++;
  resetBalls(state);
  let best = 0;
  let bestScore = Infinity;
  state.players.forEach((p, i) => {
    const s = p.scores[last] ?? 99;
    if (s < bestScore) {
      best = i;
      bestScore = s;
    }
  });
  state.current = best;
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

/** Score relative to par over the holes played so far (each hole against its own par). */
export function toPar(p: PlayerState): number {
  return p.scores.reduce<number>((a, s, i) => a + (s === null ? 0 : s - holePar(i)), 0);
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

/**
 * Load a saved round, or null when it can't be played on. Rounds saved before the game went dice-only carry a `mode`
 * (and Speed Golf ones a `club` per shot); both are dropped. Proper golf saves from when it was a choice carry
 * `golf: 'proper'`, also dropped. Old 12-hole par-6 rounds (no `golf`, or `golf: 'default'`, and a 12-slot card)
 * are not valid any more: they load as null, so the player simply starts a fresh 18-hole round.
 */
export function loadState(s: unknown): GameState | null {
  if (!isValidState(s)) return null;
  const g: GameState & { mode?: unknown; golf?: unknown } = { ...s };
  delete g.mode;
  delete g.golf;
  for (const b of g.balls) for (const shot of b.shots) delete (shot as ShotRecord & { club?: unknown }).club;
  return g;
}

export function isValidState(s: unknown): s is GameState {
  if (typeof s !== 'object' || s === null) return false;
  if ('golf' in s && s.golf !== 'proper') return false;
  return (
    'version' in s &&
    s.version === 1 &&
    'players' in s &&
    'balls' in s &&
    Array.isArray(s.players) &&
    Array.isArray(s.balls) &&
    s.players.length === s.balls.length &&
    s.players.length >= 1 &&
    'course' in s &&
    typeof s.course === 'number' &&
    s.course >= 0 &&
    s.course < COURSES.length &&
    'holeIndex' in s &&
    typeof s.holeIndex === 'number' &&
    s.holeIndex >= 0 &&
    s.holeIndex < HOLES_IN_ROUND &&
    s.players.every(
      (p: unknown) =>
        typeof p === 'object' && p !== null && 'scores' in p && Array.isArray(p.scores) && p.scores.length === HOLES_IN_ROUND,
    )
  );
}
