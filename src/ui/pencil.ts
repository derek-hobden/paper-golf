import { mulberry32 } from '../engine/rng';

/** White pencil, the page's paper white (board.ts `grainUrl`), so a canvas stroke reads as chalk on the grass. */
export const PENCIL = [251, 250, 246] as const;

/** The flat colour to fall back on when a canvas pattern cannot be made. */
export const PENCIL_COLOR = `rgb(${PENCIL.join(',')})`;

/**
 * White pencil with the ground showing through its tooth: a fixed speckle tile, repeating. Made once by each thing
 * that draws with it (the wind's swirls, the rain's streaks) and cached there — building it reads no layout, but it
 * does rasterise a tile, so never call it inside an animation frame more than once.
 */
export function pencilPattern(g: CanvasRenderingContext2D): CanvasPattern | string {
  const s = 40;
  const tile = document.createElement('canvas');
  tile.width = tile.height = s;
  const t = tile.getContext('2d');
  if (!t) return PENCIL_COLOR;
  const img = t.createImageData(s, s);
  const rnd = mulberry32(11);
  for (let i = 0; i < s * s; i++) {
    img.data[i * 4] = PENCIL[0];
    img.data[i * 4 + 1] = PENCIL[1];
    img.data[i * 4 + 2] = PENCIL[2];
    const v = rnd();
    img.data[i * 4 + 3] = v > 0.7 ? Math.round(255 * (1 - (v - 0.7) * 2.6)) : 255;
  }
  t.putImageData(img, 0, 0);
  return g.createPattern(tile, 'repeat') ?? PENCIL_COLOR;
}
