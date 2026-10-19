import { describe, expect, expectTypeOf, it } from 'vitest';
import { COURSES } from '../src/engine/generator';
import { CALM } from '../src/engine/types';
import {
  STATE_GUARDS,
  arrayOf,
  availableMoves,
  holeWind,
  isPersisted,
  isValidState,
  loadState,
  newGame,
  newLinkGame,
  roll,
  shoot,
  skipToHole,
  type BallState,
  type FieldGuard,
  type GameState,
  type GuardTable,
  type PersistedGame,
} from '../src/game/game';
import { OLD_12_HOLE_SAVE, OLD_PRE_PROPER_SAVE } from './legacy-saves';
import { at, defined } from './helpers';

type Path = readonly (string | number)[];

/** The object at `node`, or throw: the paths below only ever walk through objects and arrays. */
function objectAt(node: unknown, path: Path): object {
  if (typeof node !== 'object' || node === null) throw new Error(`no object at ${path.join('.')}`);
  return node;
}

/** A JSON copy of `save` with the field at `path` set to `value` (removed when `value` is undefined). */
function withField(save: unknown, path: Path, value: unknown): unknown {
  const copy: unknown = JSON.parse(JSON.stringify(save));
  let node = copy;
  for (const key of path.slice(0, -1)) node = Reflect.get(objectAt(node, path), key);
  const last = at(path, path.length - 1);
  if (value === undefined) Reflect.deleteProperty(objectAt(node, path), last);
  else Reflect.set(objectAt(node, path), last, value);
  return copy;
}

/**
 * A two-player save that uses every field, optional ones included: player 1 has hit (a shot with slope rolls, a
 * wind push and the tap-in mark), player 2's die is showing, and the round has its wind.
 */
function richSave(): unknown {
  const g = newGame(0, ['Ann', 'Bob'], 12345);
  roll(g, 4);
  const m = at(availableMoves(g), 0);
  shoot(g, m.dir, m.dist);
  roll(g, 3);
  let save = withField(g, ['balls', 0, 'shots', 0, 'rolls'], [{ x: 3, y: 4 }]);
  save = withField(save, ['balls', 0, 'shots', 0, 'blown'], true);
  save = withField(save, ['balls', 0, 'shots', 0, 'auto'], true);
  return withField(save, ['wind'], { strength: 1, dir: 2 });
}

const SHOT: Path = ['balls', 0, 'shots', 0];

/** One malformed value per guard: the first path element names the GameState field it is under. */
const MALFORMED: readonly [Path, unknown][] = [
  [['version'], 2],
  [['course'], 1.5],
  [['course'], COURSES.length],
  [['holeIndex'], 18],
  [['holeIndex'], -1],
  [['players'], 'Ann'],
  [['players'], []],
  [['players', 1], null],
  [['players', 1, 'name'], 5],
  [['players', 1, 'color'], null],
  [['players', 1, 'scores'], 'none'],
  [['players', 1, 'scores'], Array(12).fill(null)],
  [['players', 1, 'scores', 3], 'x'],
  [['players', 1, 'scores', 3], -1],
  [['players', 1, 'mulligans'], undefined],
  [['players', 1, 'mulligans'], 'six'],
  [['balls'], {}],
  [['balls', 2], { pos: { x: 1, y: 1 }, strokes: 0, holed: false, pickedUp: false, shots: [] }],
  [['balls', 1], { strokes: 1 }],
  [['balls', 1, 'pos'], undefined],
  [['balls', 0, 'pos', 'x'], 'x'],
  [['balls', 1, 'pos', 'y'], 1.5],
  [['balls', 1, 'strokes'], -1],
  [['balls', 1, 'holed'], 'no'],
  [['balls', 1, 'pickedUp'], undefined],
  [['balls', 0, 'shots'], 'none'],
  [['balls', 0, 'shots', 1], { from: { x: 1, y: 1 } }],
  [[...SHOT, 'from'], undefined],
  [[...SHOT, 'from', 'x'], 'x'],
  [[...SHOT, 'dir'], 8],
  [[...SHOT, 'dist'], 'far'],
  [[...SHOT, 'landing'], null],
  [[...SHOT, 'end'], { x: 1 }],
  [[...SHOT, 'rolled'], 'no'],
  [[...SHOT, 'holed'], undefined],
  [[...SHOT, 'kind'], 'chip'],
  [[...SHOT, 'rolls'], 'none'],
  [[...SHOT, 'rolls', 1], { x: '1', y: 2 }],
  [[...SHOT, 'blown'], false],
  [[...SHOT, 'auto'], 'yes'],
  [['current'], 'Bob'],
  [['current'], -1],
  [['current'], 0.5],
  [['current'], 2],
  [['dice'], 3],
  [['dice', 'value'], 7],
  [['dice', 'teeRerolled'], undefined],
  [['holeDone'], 'no'],
  [['holeDone'], undefined],
  [['finished'], 1],
  [['finished'], undefined],
  [['windSeed'], 1.5],
  [['wind'], { strength: 3, dir: 0 }],
];

describe('save guards (one guard per GameState field)', () => {
  it('loads the full save that every case below breaks one field of', () => {
    const save = richSave();
    expect(isValidState(save)).toBe(true);
    expect(loadState(save)).toEqual(save);
  });

  it.each(MALFORMED.filter(([path]) => path[0] !== 'windSeed' && path[0] !== 'wind'))('rejects a save with a malformed %j', (path, value) => {
    const save = withField(richSave(), path, value);
    expect(isValidState(save)).toBe(false);
    expect(loadState(save)).toBeNull();
  });

  it('plays a malformed wind calm instead of trusting it, as before', () => {
    const badSeed = withField(richSave(), ['windSeed'], 1.5);
    expect(isValidState(badSeed)).toBe(false);
    expect('windSeed' in defined(loadState(badSeed), 'loaded')).toBe(false);
    const badWind = withField(richSave(), ['wind'], { strength: 3, dir: 0 });
    expect(isValidState(badWind)).toBe(false);
    expect(defined(loadState(badWind), 'loaded').wind).toEqual(CALM);
  });

  it('loads an 18-hole save from before wind and slopes: no windSeed, no wind, shots without rolls, blown or auto', () => {
    let save = withField(richSave(), ['windSeed'], undefined);
    save = withField(save, ['wind'], undefined);
    for (const f of ['rolls', 'blown', 'auto']) save = withField(save, [...SHOT, f], undefined);
    expect(isValidState(save)).toBe(true);
    const loaded = defined(loadState(save), 'loaded');
    expect(holeWind(loaded)).toEqual(CALM);
    expect(at(at(loaded.balls, 0).shots, 0)).not.toHaveProperty('rolls');
  });

  it('has a malformed case for every guard in the table', () => {
    const covered = new Set(MALFORMED.map(([path]) => path[0]));
    expect(Object.keys(STATE_GUARDS).filter((k) => !covered.has(k))).toEqual([]);
  });

  it('still loads every legacy save it loaded before, and rejects the old 12-hole rounds', () => {
    const old = newGame(3, ['A', 'B']);
    skipToHole(old, 10);
    expect(loadState({ ...structuredClone(old), golf: 'proper', mode: 'dice' })).toEqual(old);
    expect(loadState(structuredClone(OLD_12_HOLE_SAVE))).toBeNull();
    expect(loadState(structuredClone(OLD_PRE_PROPER_SAVE))).toBeNull();
  });

  it('a field without a guard, or an array guard that skips the elements, does not type-check', () => {
    expectTypeOf(STATE_GUARDS).toExtend<GuardTable<GameState>>();
    expectTypeOf(STATE_GUARDS).not.toExtend<GuardTable<GameState & { added: number }>>();
    expectTypeOf(Array.isArray).not.toExtend<FieldGuard<BallState[]>>();
    const handWritten = (v: unknown): v is BallState => typeof v === 'object' && v !== null;
    expectTypeOf(handWritten).not.toExtend<FieldGuard<BallState>>();
    expectTypeOf(arrayOf((v: unknown): v is number => typeof v === 'number')).toExtend<FieldGuard<number[]>>();
    expectTypeOf(STATE_GUARDS.balls).toExtend<FieldGuard<BallState[]>>();
  });
});

describe('only a saved round can be saved', () => {
  it('a new or loaded round is a saved round; a ?play= deep-link round never is', () => {
    const g = newGame(1, ['A', 'B'], 7);
    expect(isPersisted(g)).toBe(true);
    expect(isPersisted(defined(loadState(JSON.parse(JSON.stringify(g))), 'loaded'))).toBe(true);
    const link = newLinkGame({ course: 1, players: 2, holeIndex: 12 }, ['A', 'B', 'C']);
    expect(isPersisted(link)).toBe(false);
    expect(isPersisted(structuredClone(g))).toBe(false);
    expectTypeOf(link).not.toExtend<PersistedGame>();
    expectTypeOf(g).toExtend<PersistedGame>();
  });

  it('a deep-link round is the default-wind round skipped to its hole, with the linked number of players', () => {
    const link = newLinkGame({ course: 2, players: 3, holeIndex: 6 }, ['A', 'B', 'C', 'D']);
    const g = newGame(2, ['A', 'B', 'C']);
    skipToHole(g, 6);
    expect(link).toEqual(g);
    expect(at(link.players, 2).name).toBe('C');
  });
});
