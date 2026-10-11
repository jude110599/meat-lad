/**
 * Deterministic asteroid shape. Server and client both derive the surface
 * from the room seed, so seam positions sent as unit directions land on the
 * same spot of the rendered mesh without shipping any geometry.
 */
export type Vec3 = [number, number, number];

export const ASTEROID_RADIUS = 2.2;

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

interface Lobe { k: Vec3; freq: number; amp: number; phase: number }

const lobeCache = new Map<number, Lobe[]>();
function lobes(seed: number): Lobe[] {
  let l = lobeCache.get(seed);
  if (l) return l;
  const r = rng(seed);
  l = [];
  for (let i = 0; i < 9; i++) {
    l.push({
      k: randomUnit(r),
      freq: 1 + r() * 4,
      amp: 0.09 / (1 + i * 0.35),
      phase: r() * Math.PI * 2,
    });
  }
  lobeCache.set(seed, l);
  return l;
}

export function randomUnit(r: () => number): Vec3 {
  const z = r() * 2 - 1;
  const t = r() * Math.PI * 2;
  const s = Math.sqrt(1 - z * z);
  return [s * Math.cos(t), s * Math.sin(t), z];
}

/** Radius of the asteroid along unit direction `d`. */
export function surfaceRadius(d: Vec3, seed: number): number {
  let h = 0;
  for (const { k, freq, amp, phase } of lobes(seed)) {
    h += Math.sin((d[0] * k[0] + d[1] * k[1] + d[2] * k[2]) * freq * Math.PI + phase) * amp;
  }
  return ASTEROID_RADIUS * (1 + h);
}

export function surfacePoint(d: Vec3, seed: number): Vec3 {
  const r = surfaceRadius(d, seed);
  return [d[0] * r, d[1] * r, d[2] * r];
}
