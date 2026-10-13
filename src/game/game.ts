import { itemAt } from '../engine/assert';
import { HOLES_PER_COURSE, generateHole } from '../engine/generator';
import {
  MAX_STROKES,
  MULLIGANS_PER_COURSE,
  PAR,
  diceDistance,
  legalMoves,
  resolveShot,
  type Move,
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
    scores: Array<number | null>(HOLES_PER_COURSE).fill(null),
    mulligans: MULLIGANS_PER_COURSE,
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
  return generateHole(state.course, state.holeIndex + 1);
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
  if (state.dice || state.holeDone) throw new Error('cannot roll now');
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

export interface MoveOption extends Move {
  kind: 'hit' | 'putt';
}

/** Every legal shot for the current player right now: a putt, or a hit of the rolled distance. */
export function availableMoves(state: GameState): MoveOption[] {
  if (state.holeDone || state.finished || !state.dice) return [];
  const hole = currentHole(state);
  const ball = currentBall(state);
  const out: MoveOption[] = legalMoves(hole, ball.pos, 1).map((m) => ({ ...m, kind: 'putt' as const }));
  const dist = diceDistance(hole, ball.pos, state.dice.value);
  if (dist > 1) out.push(...legalMoves(hole, ball.pos, dist).map((m) => ({ ...m, kind: 'hit' as const })));
  return out;
}

/** Play a shot. Returns the resolved result for animation. */
export function shoot(state: GameState, dir: Dir, dist: number): { result: ShotResult; record: ShotRecord } {
  const option = availableMoves(state).find((m) => m.dir === dir && m.dist === dist);
  if (!option) throw new Error('illegal shot');
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
    kind: option.kind,
  };
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
  if (last + 1 >= HOLES_PER_COURSE) {
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

export function totalStrokes(p: PlayerState): number {
  return p.scores.reduce<number>((a, s) => a + (s ?? 0), 0);
}

/** Score relative to par over the holes played so far. */
export function toPar(p: PlayerState): number {
  return p.scores.reduce<number>((a, s) => a + (s === null ? 0 : s - PAR), 0);
}

export function scoreName(strokes: number): string {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - PAR;
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
 * Load a saved round. Rounds saved before the game went dice-only carry a `mode` (and Speed Golf ones a `club`
 * per shot); both are dropped, so an old Speed Golf round simply carries on as Dice Golf.
 */
export function loadState(s: unknown): GameState | null {
  if (!isValidState(s)) return null;
  const g: GameState & { mode?: unknown } = { ...s };
  delete g.mode;
  for (const b of g.balls) for (const shot of b.shots) delete (shot as ShotRecord & { club?: unknown }).club;
  return g;
}

export function isValidState(s: unknown): s is GameState {
  return (
    typeof s === 'object' &&
    s !== null &&
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
    s.course < 5 &&
    'holeIndex' in s &&
    typeof s.holeIndex === 'number' &&
    s.holeIndex >= 0 &&
    s.holeIndex < HOLES_PER_COURSE
  );
}
