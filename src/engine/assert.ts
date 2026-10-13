/**
 * Checked reads for values the type system cannot prove are present (`noUncheckedIndexedAccess`).
 * Use these instead of `!` or `as`: a broken invariant fails loudly with a message, not as a later `undefined` crash.
 */

/** `value`, or throw `msg` when it is undefined. */
export function must<T>(value: T | undefined, msg: string): T {
  if (value === undefined) throw new Error(msg);
  return value;
}

/** `xs[i]`, throwing a RangeError when `i` is out of range. */
export function itemAt<T>(xs: ArrayLike<T>, i: number, what = 'item'): T {
  const v = xs[i];
  if (v === undefined) throw new RangeError(`${what} index ${String(i)} out of range (length ${String(xs.length)})`);
  return v;
}
