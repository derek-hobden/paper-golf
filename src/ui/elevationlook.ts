import type { Elevation } from '../engine/rules';

/**
 * How raised and low ground looks — option B, the paper cut-out (Derek, 26 Oct 2026): raised ground is an extra sheet
 * glued on the page, low ground is pressed into it, and level ground is untouched. No lines, hatching, stipple or
 * numbers on the course. Pure markup and words (no DOM, no gameplay): `board.ts` only reads them. Distances are in
 * board units (1 = one grid space).
 */

/** A shadow cast outside the shape: its alpha blurred, offset, cut out of the shape itself, then flooded. */
function outerShadow(id: string, dx: number, dy: number, blur: number, color: string, opacity: number): string {
  return `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceAlpha" stdDeviation="${String(blur)}"/>
    <feOffset dx="${String(dx)}" dy="${String(dy)}" result="o"/>
    <feComposite in="o" in2="SourceAlpha" operator="out" result="s"/>
    <feFlood flood-color="${color}" flood-opacity="${String(opacity)}"/>
    <feComposite in2="s" operator="in"/>
  </filter>`;
}

/** A shadow inside the shape: the outside's alpha blurred, offset, kept only within the shape, then flooded. */
function innerShadow(id: string, dx: number, dy: number, blur: number, color: string, opacity: number): string {
  return `<filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
    <feComponentTransfer in="SourceAlpha"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer>
    <feGaussianBlur stdDeviation="${String(blur)}"/>
    <feOffset dx="${String(dx)}" dy="${String(dy)}"/>
    <feComposite in2="SourceAlpha" operator="in" result="s"/>
    <feFlood flood-color="${color}" flood-opacity="${String(opacity)}"/>
    <feComposite in2="s" operator="in"/>
  </filter>`;
}

/** The ink the shadows are cast in: the rough's darkest green, so a shadow reads as shade on grass, not as grey. */
export const SHADE = '#1f2e14';

/**
 * Each region is one merged path drawn several times, one effect each, in this order (bottom first). A filter only
 * ever reads the path's alpha, so the effects follow the merged outline and never show a seam between cells.
 */
export const ELEVATION_LAYERS = {
  raised: [
    { filter: 'pg-up-drop' },
    { filter: 'pg-up-edge' },
    { fill: '#fffef4', opacity: 0.16 },
    { filter: 'pg-up-hi' },
  ],
  low: [{ fill: SHADE, opacity: 0.1 }, { filter: 'pg-dn-press' }, { filter: 'pg-dn-hi' }],
} as const;

/** The filters the layers name, for the terrain layer's `<defs>`: static, drawn once with the hole. */
export function elevationFilters(): string {
  return [
    // Raised: a short crisp drop shadow below and right, a thin paper-white cut edge over it, a faint top-left highlight.
    outerShadow('pg-up-drop', 0.08, 0.12, 0.035, SHADE, 0.42),
    outerShadow('pg-up-edge', 0.035, 0.06, 0.001, '#fbfaf6', 1),
    innerShadow('pg-up-hi', 0.03, 0.04, 0.012, '#ffffff', 0.85),
    // Low: a soft shade along the top-left inside edge, a faint white catch of light along the bottom-right one.
    innerShadow('pg-dn-press', 0.07, 0.1, 0.035, SHADE, 0.55),
    innerShadow('pg-dn-hi', -0.03, -0.04, 0.012, '#ffffff', 0.5),
  ].join('');
}

const MINUS = '−';

/** The focused marker's tag: "+1 uphill · 1 shorter", "−2 downhill · 2 longer". */
export function elevationTag(e: Elevation): string {
  const by = Math.abs(e.change);
  const way = e.climb > 0 ? `+${String(e.climb)} uphill` : `${MINUS}${String(-e.climb)} downhill`;
  return `${way} · ${String(by)} ${e.change < 0 ? 'shorter' : 'longer'}`;
}

/** The compact tag a phone shows on every moved marker: "1 shorter", "2 longer". */
export function elevationShortTag(e: Elevation): string {
  return `${String(Math.abs(e.change))} ${e.change < 0 ? 'shorter' : 'longer'}`;
}

/** The tray's one line when every hit moves alike: "Downhill all round · 1 longer". */
export function allRoundLine(change: number): string {
  const by = String(Math.abs(change));
  return change > 0 ? `Downhill all round · ${by} longer` : `Uphill all round · ${by} shorter`;
}
