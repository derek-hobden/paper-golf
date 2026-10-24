export type Terrain = 'rough' | 'fairway' | 'sand' | 'water' | 'tree';

export interface P {
  x: number;
  y: number;
}

/** Index 0..7 into DIRS: N, NE, E, SE, S, SW, W, NW. */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** A fixed 8-tuple, so `DIRS[dir]` with a `Dir` index is always defined. */
export const DIRS: readonly [P, P, P, P, P, P, P, P] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

export const DIR_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export interface Cell {
  t: Terrain;
  /** Slope arrow: landing here rolls the ball one space this way. */
  slope?: Dir;
  /** Visual variant for trees (pine vs. round). */
  v?: number;
}

export interface Hole {
  /**
   * The hole's id in the library (`src/engine/holeid.ts`): `b:<course>:<number>` on a built-in hole, `s:<key>` on one
   * the player saved. Absent on a hole being drawn in the builder and on one a `#h=` link carried.
   */
  id?: string;
  /** 0-based course index. */
  course: number;
  /** 1-based hole number within the course. */
  number: number;
  seed: number;
  w: number;
  h: number;
  /** Row-major, length w*h. */
  cells: Cell[];
  tee: P;
  cup: P;
  par: number;
}

/** The wind on a hole: it pushes the resting ball of every hit (never a putt) `strength` squares towards `dir`. */
export interface Wind {
  strength: 0 | 1 | 2;
  /** Where the wind blows to (DIRS index); meaningless when calm. */
  dir: Dir;
}

export const CALM: Wind = { strength: 0, dir: 0 };
