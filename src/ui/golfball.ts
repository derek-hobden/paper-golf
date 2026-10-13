/**
 * The golf ball, drawn once as vector SVG markup and shared by the resting balls on the board, the flight sprite
 * in `#fx` and the legend icon. Coordinates are a 100×100 box centred on the origin (ball radius 50 including
 * the outline). The look is split in two so the flight sprite can spin the dimples under fixed lighting:
 * `ballBody` (white ball + dimples, may rotate) and `ballLight` (shading, specular highlight, pencil outline).
 */

/** Ball radius inside the box, to the middle of the outline. */
export const BALL_R = 45;

/**
 * Dimples: a hex grid on the visible hemisphere, each one squashed towards the rim like a dent seen at an angle,
 * so the ball reads as round even when flat-shaded. Subtle grey so it stays texture, not noise, at phone size.
 */
function dimples(): string {
  const s = 0.29;
  const a = 0.085;
  let out = '';
  for (let row = -5; row <= 5; row++)
    for (let col = -5; col <= 5; col++) {
      const u = (col + (row & 1 ? 0.5 : 0)) * s + 0.05;
      const v = row * s * 0.866 + 0.03;
      const rho = Math.hypot(u, v);
      if (rho > 0.9) continue;
      const fore = Math.sqrt(1 - rho * rho);
      const rx = (a * (0.35 + 0.65 * fore) * BALL_R).toFixed(2);
      const ry = (a * BALL_R).toFixed(2);
      const ang = ((Math.atan2(v, u) * 180) / Math.PI).toFixed(1);
      out += `<ellipse cx="${(u * BALL_R).toFixed(2)}" cy="${(v * BALL_R).toFixed(2)}" rx="${rx}" ry="${ry}" transform="rotate(${ang} ${(u * BALL_R).toFixed(2)} ${(v * BALL_R).toFixed(2)})"/>`;
    }
  return out;
}

let dimpleCache = '';

/** White ball with its dimple pattern (the part that may spin). */
export function ballBody(): string {
  dimpleCache ||= dimples();
  return `<circle r="${BALL_R}" fill="#fff"/><g fill="#5c5f66" fill-opacity="0.22">${dimpleCache}</g>`;
}

/** Gradients for `ballLight`, under a caller-chosen id prefix so several copies can share one document. */
export function ballDefs(id: string): string {
  return `<radialGradient id="${id}-shade" cx="0.38" cy="0.34" r="0.72">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/>
      <stop offset="0.5" stop-color="#4a4d55" stop-opacity="0.04"/>
      <stop offset="0.82" stop-color="#3d4048" stop-opacity="0.2"/>
      <stop offset="1" stop-color="#2e3038" stop-opacity="0.42"/>
    </radialGradient>
    <radialGradient id="${id}-spec" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff" stop-opacity="0.95"/>
      <stop offset="0.55" stop-color="#fff" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>`;
}

/**
 * Fixed lighting from the top-left (core shade + specular highlight) and the pencil outline. The outline uses
 * `currentColor`, so the player's colour comes from the `color` of whatever contains it.
 */
export function ballLight(id: string, outline = 9): string {
  return `<circle r="${BALL_R}" fill="url(#${id}-shade)"/>
    <ellipse cx="-15" cy="-17" rx="15" ry="10" transform="rotate(-38 -15 -17)" fill="url(#${id}-spec)"/>
    <circle cx="-17" cy="-19" r="3.4" fill="#fff"/>
    ${outline ? `<circle r="${BALL_R}" fill="none" stroke="currentColor" stroke-width="${outline}"/>` : ''}`;
}

/**
 * Ground shadow in the pencil-on-paper style: a soft graphite smudge with light hatching, offset down-right
 * (light from the top-left). Box is 100×60 centred on the origin.
 */
export function shadowSvg(id: string): string {
  return `<svg viewBox="-50 -30 100 60" aria-hidden="true">${shadowInner(id)}</svg>`;
}

/** The shadow's contents, for embedding in a `<symbol viewBox="-50 -30 100 60">`. */
export function shadowInner(id: string): string {
  return `<defs>
      <radialGradient id="${id}-sm" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stop-color="#3d3d40" stop-opacity="0.55"/>
        <stop offset="0.7" stop-color="#3d3d40" stop-opacity="0.3"/>
        <stop offset="1" stop-color="#3d3d40" stop-opacity="0"/>
      </radialGradient>
      <pattern id="${id}-ht" patternUnits="userSpaceOnUse" width="9" height="9" patternTransform="rotate(-50)">
        <line x1="0" y1="0" x2="0" y2="9" stroke="#3d3d40" stroke-width="2.6" stroke-opacity="0.45"/>
      </pattern>
    </defs>
    <ellipse rx="48" ry="27" fill="url(#${id}-sm)"/>
    <ellipse rx="38" ry="19" fill="url(#${id}-ht)"/>`;
}
