/**
 * Row-major grid access (`cells[y * w + x]`). All grid reads go through here so an out-of-range (x, y) throws
 * instead of silently reading a neighbouring row or returning undefined.
 */
export function gridAt<T>(cells: readonly T[], w: number, x: number, y: number): T {
  const v = x >= 0 && x < w && y >= 0 ? cells[y * w + x] : undefined;
  if (v === undefined) {
    throw new RangeError(`grid read (${String(x)}, ${String(y)}) is outside the ${String(w)}×${String(cells.length / w)} grid`);
  }
  return v;
}
