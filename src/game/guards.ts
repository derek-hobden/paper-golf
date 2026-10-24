/**
 * The checks a value read from storage has to pass before anything plays on it. Every saved shape (a round in
 * `src/game/game.ts`, the saved holes and courses in `src/game/library.ts`) is built from a `GuardTable`, so a field
 * added without a guard is a compile error and every array is checked element by element. Pure: no DOM, no storage.
 */
import type { Dir, P } from '../engine/types';

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
export function shape<T>(fields: GuardTable<T>): Checked<T> {
  const guards: Readonly<Record<string, Guard<unknown>>> = fields;
  return checked(
    (v: unknown): v is T => typeof v === 'object' && v !== null && Object.entries(guards).every(([k, guard]) => guard(Reflect.get(v, k))),
  );
}

/**
 * `guard` and one condition more, for a saved shape that has to make sense as well as type-check (a saved hole is a
 * page the builder could have drawn). The result is still `Checked`, because `guard` checked every field.
 */
export function also<T>(guard: FieldGuard<T>, extra: (v: T) => boolean): Checked<T> {
  const g: Guard<T> = guard;
  return checked((v: unknown): v is T => g(v) && extra(v));
}

export function optional<T>(guard: FieldGuard<T>): Checked<T | undefined> {
  const g: Guard<T> = guard;
  return checked((v: unknown): v is T | undefined => v === undefined || g(v));
}

export function nullable<T>(guard: FieldGuard<T>): Checked<T | null> {
  const g: Guard<T> = guard;
  return checked((v: unknown): v is T | null => v === null || g(v));
}

/** `guard`, except that a save whose field fails it loads with `fallback` there instead (undefined: the field is dropped). */
export function orElse<T>(guard: FieldGuard<T>, fallback: T): Checked<T> & { readonly fallback: T } {
  const g: Guard<T> = guard;
  return Object.assign(checked((v: unknown): v is T => g(v)), { fallback });
}

export const oneOf =
  <const T extends readonly Primitive[]>(...values: T): Guard<T[number]> =>
  (v: unknown): v is T[number] =>
    values.some((x) => x === v);

/** A whole number in `lo..hi`. */
export const intIn =
  (lo = -Infinity, hi = Infinity): Guard<number> =>
  (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

export const isBoolean = (v: unknown): v is boolean => typeof v === 'boolean';
export const isString = (v: unknown): v is string => typeof v === 'string';
export const isDir: Guard<Dir> = oneOf(0, 1, 2, 3, 4, 5, 6, 7);
export const isPoint = shape<P>({ x: intIn(), y: intIn() });

/** A copy of the save `s` in which each field with a fallback (`orElse`) that fails its guard takes the fallback. */
export function withFallbacks(guards: Readonly<Record<string, Guard<unknown>>>, s: unknown): unknown {
  if (typeof s !== 'object' || s === null) return s;
  const fields = new Map<string, unknown>(Object.entries(s));
  for (const [k, guard] of Object.entries(guards)) {
    if (!('fallback' in guard) || guard(fields.get(k))) continue;
    if (guard.fallback === undefined) fields.delete(k);
    else fields.set(k, guard.fallback);
  }
  return Object.fromEntries(fields);
}
