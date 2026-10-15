// Generates the desk texture src/assets/wood.webp: light birch/oak planks with long, faint grain, gentle colour
// variation and soft seams. Seamless by construction: everything that varies along x uses whole cycles of the tile
// width, and the planks stack so a seam falls exactly on the tile's top edge.
//
//   node scripts/wood-texture.js wood.ppm && cwebp -q 80 -m 6 wood.ppm -o src/assets/wood.webp
//
// The tile is drawn at 1.5x and shown at 1024x684 CSS px (style.css `body`), so retina phones see it sharp enough
// for soft wood without the bytes of a 3x image.
import { writeFileSync } from 'node:fs';

const W = 1536;
const H = 1026;
const PLANKS = 3;
const PH = H / PLANKS;

/** Seeded PRNG (mulberry32), so the texture is reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20261015);
const TAU = Math.PI * 2;

/** A smooth 1D value-noise array: random knots every `step` samples, cosine-interpolated. */
function smoothNoise(length, step) {
  const knots = Array.from({ length: Math.ceil(length / step) + 2 }, () => rand() * 2 - 1);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const k = Math.floor(i / step);
    const f = (1 - Math.cos(((i % step) / step) * Math.PI)) / 2;
    out[i] = (knots[k] ?? 0) * (1 - f) + (knots[k + 1] ?? 0) * f;
  }
  return out;
}

/** Periodic in x (whole cycles over W): a few sines with random phases. */
function waves(count, maxCycles) {
  return Array.from({ length: count }, (_, i) => ({
    k: 1 + Math.floor(rand() * maxCycles),
    amp: (rand() * 0.6 + 0.4) / (i + 1),
    phase: rand() * TAU,
    drift: (rand() - 0.5) * 3,
  }));
}

function sumWaves(ws, x, yn) {
  let s = 0;
  for (const w of ws) s += w.amp * Math.sin((TAU * w.k * x) / W + w.phase + w.drift * yn);
  return s;
}

// Grain profile per plank, sampled with sub-pixel resolution across the plank (the grain runs along x).
const SUB = 4;
const planks = Array.from({ length: PLANKS }, () => {
  const len = Math.ceil(PH + 80) * SUB;
  const fine = smoothNoise(len, 6);
  const mid = smoothNoise(len, 24);
  const broad = smoothNoise(len, 70);
  const profile = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const f = fine[i] ?? 0;
    // Thin darker lines: sharpen the fine noise so most of it is plain wood with a streak here and there.
    const streak = Math.max(0, f) ** 3;
    profile[i] = 0.55 * streak + 0.2 * (mid[i] ?? 0) + 0.22 * (broad[i] ?? 0);
  }
  return {
    profile,
    warp: waves(5, 3),
    fade: waves(4, 6),
    tone: (rand() - 0.5) * 0.12,
  };
});

// Broad colour wash over the whole tile, periodic in both directions.
const washX = waves(3, 2);
const washY = Array.from({ length: 2 }, () => ({ k: 1 + Math.floor(rand() * 2), phase: rand() * TAU }));

const light = [234, 206, 163];
const dark = [198, 160, 110];

// Pores: short dark flecks along the grain, wrapping around the tile's left and right edges.
const pores = new Float32Array(W * H);
for (let n = 0; n < 2600; n++) {
  const x0 = Math.floor(rand() * W);
  const y0 = Math.floor(rand() * H);
  const len = 6 + Math.floor(rand() ** 2 * 40);
  const depth = 0.05 + rand() * 0.1;
  for (let d = 0; d < len; d++) {
    const taper = Math.sin((d / len) * Math.PI);
    pores[y0 * W + ((x0 + d) % W)] += depth * taper;
  }
}

const px = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  const p = Math.floor(y / PH);
  const plank = planks[p] ?? planks[0];
  if (plank === undefined) throw new Error('no planks');
  const v = y - p * PH;
  const yn = v / PH;
  let wy = 0;
  for (const w of washY) wy += 0.5 * Math.sin((TAU * w.k * y) / H + w.phase);
  for (let x = 0; x < W; x++) {
    const warp = 7 * sumWaves(plank.warp, x, yn);
    const at = Math.min(plank.profile.length - 2, Math.max(0, (v + 40 + warp) * SUB));
    const i = Math.floor(at);
    const grain = (plank.profile[i] ?? 0) * (i + 1 - at) + (plank.profile[i + 1] ?? 0) * (at - i);
    // Lines fade in and out along their length, each at its own place, so they read as long grain rather than
    // ruled stripes: the fade's phase follows the grain line (v + warp), not the row.
    const fade = 0.6 + 0.4 * Math.sin(sumWaves(plank.fade, x, (v + warp) / 9) * 2.2);
    let t = 0.42 + grain * fade + plank.tone + 0.05 * sumWaves(washX, x, wy) + 0.03 * wy;
    // Seams: a soft dark line on top of each plank, a hint of highlight on the edge just below it.
    if (v < 1) t -= 0.3;
    else if (v < 2) t -= 0.12;
    else if (v < 3) t += 0.04;
    else if (v >= PH - 1) t -= 0.06;
    t += pores[y * W + x] ?? 0;
    t += (rand() - 0.5) * 0.025;
    t = Math.min(1, Math.max(0, t));
    const o = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) px[o + c] = Math.round((light[c] ?? 0) * (1 - t) + (dark[c] ?? 0) * t);
  }
}

const out = process.argv[2];
if (out === undefined) throw new Error('usage: node scripts/wood-texture.js out.ppm');
writeFileSync(out, Buffer.concat([Buffer.from(`P6\n${String(W)} ${String(H)}\n255\n`), px]));
