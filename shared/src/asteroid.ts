/**
 * Deterministic planet shape. Server and client both derive the surface from
 * the room seed, so seam positions sent as unit directions land on the same
 * spot of the rendered mesh without shipping any geometry.
 *
 * The mined body is a small near-spherical planet: seas sit exactly at
 * ASTEROID_RADIUS (a flat water or lava surface), and continents rise a few
 * percent above it, with ridged mountain ranges inland. Saves only store seam
 * directions, so any world (old asteroid saves included) maps onto it.
 */
export type Vec3 = [number, number, number];

/** Sea-level radius. */
export const ASTEROID_RADIUS = 2.2;
/** Share of the surface above sea level, whatever the seed. */
export const LAND_FRACTION = 0.44;
/** Highest a mountain top rises above sea level, relative to the radius. */
export const MAX_RELIEF = 0.058;

/** mulberry32: small, fast, seedable PRNG returning floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomUnit(r: () => number): Vec3 {
  const z = r() * 2 - 1;
  const t = r() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - z * z));
  return [s * Math.cos(t), s * Math.sin(t), z];
}

interface Lobe {
  k: Vec3;
  freq: number;
  amp: number;
  phase: number;
}

interface Field {
  /** Broad continental swell (low frequency) plus coastline wiggle. */
  cont: Lobe[];
  /** Ridged mountain ranges. */
  ridge: Lobe[];
  ridgeNorm: number;
  /** Continental value at sea level, and the spans above and below it. */
  sea: number;
  up: number;
  down: number;
}

const fieldCache = new Map<number, Field>();

function sumLobes(d: Vec3, ls: Lobe[]): number {
  let h = 0;
  for (const { k, freq, amp, phase } of ls) h += Math.sin((d[0] * k[0] + d[1] * k[1] + d[2] * k[2]) * freq * Math.PI + phase) * amp;
  return h;
}

function ridgeSum(d: Vec3, f: Field): number {
  let h = 0;
  for (const { k, freq, amp, phase } of f.ridge) {
    const s = 1 - Math.abs(Math.sin((d[0] * k[0] + d[1] * k[1] + d[2] * k[2]) * freq * Math.PI + phase));
    h += s * s * amp;
  }
  return h * f.ridgeNorm;
}

function field(seed: number): Field {
  let f = fieldCache.get(seed);
  if (f) return f;
  const r = rng(seed);
  const cont: Lobe[] = [];
  for (let i = 0; i < 7; i++) cont.push({ k: randomUnit(r), freq: 0.55 + r() * 1.5 + i * 0.12, amp: 1 / (1 + i * 0.45), phase: r() * Math.PI * 2 });
  for (let i = 0; i < 4; i++) cont.push({ k: randomUnit(r), freq: 3 + r() * 2.5, amp: 0.16 / (1 + i * 0.4), phase: r() * Math.PI * 2 });
  const ridge: Lobe[] = [];
  let ra = 0;
  for (let i = 0; i < 5; i++) {
    const amp = 1 / (1 + i * 0.5);
    ra += amp;
    ridge.push({ k: randomUnit(r), freq: 3.2 + r() * 4.5, amp, phase: r() * Math.PI * 2 });
  }
  f = { cont, ridge, ridgeNorm: 1 / ra, sea: 0, up: 1, down: 1 };
  // Calibrate sea level so about LAND_FRACTION of the surface is land:
  // sample an even spiral of directions and take the quantile.
  const N = 1200;
  const vals = new Float64Array(N);
  const d: Vec3 = [0, 0, 0];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - ((i + 0.5) / N) * 2;
    const s = Math.sqrt(Math.max(0, 1 - y * y));
    d[0] = Math.cos(ga * i) * s;
    d[1] = y;
    d[2] = Math.sin(ga * i) * s;
    vals[i] = sumLobes(d, cont);
  }
  vals.sort();
  f.sea = vals[Math.floor(N * (1 - LAND_FRACTION))];
  f.up = Math.max(1e-6, vals[N - 1] - f.sea);
  f.down = Math.max(1e-6, f.sea - vals[0]);
  fieldCache.set(seed, f);
  return f;
}

/** What the surface is like along a direction (see `terrainAt`). */
export interface Terrain {
  /** Signed elevation: 0 at the coast, up to ~1 on the highest land, down to ~-1 in the deepest sea. */
  elev: number;
  /** Mountain-range strength 0..1 (0 at sea and on the coastal plains). */
  ridge: number;
  /** Height of the surface above sea level, relative to ASTEROID_RADIUS (0 at sea). */
  h: number;
}

const tmpTerrain: Terrain = { elev: 0, ridge: 0, h: 0 };
const UP: Vec3 = [0, 1, 0];
const dUnit: Vec3 = [0, 0, 0];
function unitTmp(d: Vec3, l: number): Vec3 {
  if (Math.abs(l - 1) < 1e-9) return d;
  dUnit[0] = d[0] / l;
  dUnit[1] = d[1] / l;
  dUnit[2] = d[2] / l;
  return dUnit;
}

function sstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Terrain along unit direction `d`. Returns a shared object unless `out` is given. */
export function terrainAt(dir: Vec3, seed: number, out: Terrain = tmpTerrain): Terrain {
  const f = field(seed);
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  const d = l > 1e-9 && Number.isFinite(l) ? unitTmp(dir, l) : UP;
  const c = sumLobes(d, f.cont) - f.sea;
  if (!(c > 0)) {
    out.elev = Number.isFinite(c) ? Math.max(-1, c / f.down) : 0;
    out.ridge = 0;
    out.h = 0;
    return out;
  }
  const t = Math.min(1, c / f.up);
  const inland = sstep(0.04, 0.4, t);
  const m = ridgeSum(d, f) * inland;
  out.elev = t;
  out.ridge = m;
  // A coastal shelf, a gentle continental rise and ridged ranges inland.
  out.h = 0.006 * Math.min(1, t * 8) + 0.02 * t + 0.032 * Math.pow(m, 1.5);
  return out;
}

/** Radius of the planet along unit direction `d`. */
export function surfaceRadius(d: Vec3, seed: number): number {
  return ASTEROID_RADIUS * (1 + terrainAt(d, seed).h);
}

export function surfacePoint(d: Vec3, seed: number): Vec3 {
  const r = surfaceRadius(d, seed);
  return [d[0] * r, d[1] * r, d[2] * r];
}
