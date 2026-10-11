import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, LatheGeometry, MathUtils, Vector2, Vector3 } from 'three';
import { randomUnit, rng, surfaceRadius, type Vec3 } from '@starforge/shared';

/* ---------------- noise ---------------- */

function lattice(ix: number, iy: number, iz: number, s: number): number {
  let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f) ^ s;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth 3D value noise in [0, 1]. */
function noise3(x: number, y: number, z: number, s: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = lattice(ix, iy, iz, s);
  const b = lattice(ix + 1, iy, iz, s);
  const c = lattice(ix, iy + 1, iz, s);
  const d = lattice(ix + 1, iy + 1, iz, s);
  const e = lattice(ix, iy, iz + 1, s);
  const f = lattice(ix + 1, iy, iz + 1, s);
  const g = lattice(ix, iy + 1, iz + 1, s);
  const h = lattice(ix + 1, iy + 1, iz + 1, s);
  const x1 = a + (b - a) * fx;
  const x2 = c + (d - c) * fx;
  const x3 = e + (f - e) * fx;
  const x4 = g + (h - g) * fx;
  const y1 = x1 + (x2 - x1) * fy;
  const y2 = x3 + (x4 - x3) * fy;
  return y1 + (y2 - y1) * fz;
}

function nd(d: Vec3, k: number, off: number, s: number): number {
  return noise3(d[0] * k + off, d[1] * k + off * 0.7, d[2] * k - off * 1.3, s);
}

function fbm2(d: Vec3, k: number, off: number, s: number): number {
  return nd(d, k, off, s) * 0.65 + nd(d, k * 2.17, off + 13.1, s) * 0.35;
}


/* ---------------- indexed icosphere ---------------- */

const ICO_T = (1 + Math.sqrt(5)) / 2;
const ICO_V = [
  [-1, ICO_T, 0], [1, ICO_T, 0], [-1, -ICO_T, 0], [1, -ICO_T, 0],
  [0, -1, ICO_T], [0, 1, ICO_T], [0, -1, -ICO_T], [0, 1, -ICO_T],
  [ICO_T, 0, -1], [ICO_T, 0, 1], [-ICO_T, 0, -1], [-ICO_T, 0, 1],
].map(([x, y, z]) => {
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
});
const ICO_F = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/**
 * Unit geodesic sphere, indexed: every icosahedron face split into an
 * n×n triangle grid (the same vertices as IcosahedronGeometry(1, n - 1)),
 * shared edge and corner vertices welded exactly. Much faster than
 * IcosahedronGeometry + mergeVertices at high detail.
 */
function icoSphere(n: number): BufferGeometry {
  const nv = 10 * n * n + 2;
  const pos = new Float32Array(nv * 3);
  const index = new Uint32Array(20 * n * n * 3);
  let vc = 0;
  let ic = 0;
  const corner = new Int32Array(12).fill(-1);
  const edge = new Map<number, number>();
  const grid = new Int32Array((n + 1) * (n + 1));
  const put = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z) || 1;
    pos[vc * 3] = x / l;
    pos[vc * 3 + 1] = y / l;
    pos[vc * 3 + 2] = z / l;
    return vc++;
  };
  for (const [a, b, c] of ICO_F) {
    const A = ICO_V[a];
    const B = ICO_V[b];
    const C = ICO_V[c];
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        const x = A[0] * w + B[0] * u + C[0] * v;
        const y = A[1] * w + B[1] * u + C[1] * v;
        const z = A[2] * w + B[2] * u + C[2] * v;
        // Corners and edges are shared with neighbouring faces: key them by
        // (lower vertex, higher vertex, step from the lower one).
        let key = -1;
        let ci = -1;
        if (i === 0 && j === 0) ci = a;
        else if (i === n) ci = b;
        else if (j === n) ci = c;
        else if (j === 0) key = a < b ? (a * 12 + b) * (n + 1) + i : (b * 12 + a) * (n + 1) + (n - i);
        else if (i === 0) key = a < c ? (a * 12 + c) * (n + 1) + j : (c * 12 + a) * (n + 1) + (n - j);
        else if (i + j === n) key = b < c ? (b * 12 + c) * (n + 1) + j : (c * 12 + b) * (n + 1) + (n - j);
        let id: number;
        if (ci >= 0) {
          if (corner[ci] < 0) corner[ci] = put(x, y, z);
          id = corner[ci];
        } else if (key >= 0) {
          const got = edge.get(key);
          if (got === undefined) {
            id = put(x, y, z);
            edge.set(key, id);
          } else id = got;
        } else id = put(x, y, z);
        grid[i * (n + 1) + j] = id;
      }
    }
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n - i; j++) {
        const p0 = grid[i * (n + 1) + j];
        const p1 = grid[(i + 1) * (n + 1) + j];
        const p2 = grid[i * (n + 1) + j + 1];
        index[ic++] = p0;
        index[ic++] = p1;
        index[ic++] = p2;
        if (i + j < n - 1) {
          const p3 = grid[(i + 1) * (n + 1) + j + 1];
          index[ic++] = p1;
          index[ic++] = p3;
          index[ic++] = p2;
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(vc === nv ? pos : pos.slice(0, vc * 3), 3));
  g.setIndex(new BufferAttribute(ic === index.length ? index : index.slice(0, ic), 1));
  return g;
}

/* ---------------- asteroid ---------------- */

/**
 * Largest relative height the fine detail (craters, facets, ridges) may add
 * to or carve from the real mesh. The host's `surfaceRadius` stays
 * authoritative for where seams, rigs and strikes land, so this stays small;
 * the shading normals use a deeper version of the same relief.
 */
export const DETAIL_MAX = 0.024;

interface Crater {
  c: Vec3;
  /** Angular radius (rad). */
  a: number;
  /** Influence ends at this cosine (≈1.75 radii out). */
  cosOuter: number;
  depth: number;
  rim: number;
  dust: number;
}

/** A flat cut: the rock is chiselled toward one plane per spherical Voronoi cell. */
interface Plate {
  c: Vec3;
  n: Vec3;
  /** Plane offset along n. */
  k: number;
}

interface RockField {
  craters: Crater[];
  plates: Plate[];
  s: number;
}

const fieldCache = new Map<number, RockField>();

function rockField(seed: number): RockField {
  let f = fieldCache.get(seed);
  if (f) return f;
  const r = rng((Math.imul(seed, 2654435761) ^ 0x6a09e667) >>> 0);
  const craters: Crater[] = [];
  const add = (n: number, aMin: number, aMax: number, depth: number) => {
    for (let i = 0; i < n; i++) {
      const a = aMin + r() * (aMax - aMin);
      const dp = depth * (0.75 + r() * 0.5);
      craters.push({ c: randomUnit(r), a, cosOuter: Math.cos(Math.min(Math.PI, a * 1.75)), depth: dp, rim: dp * (0.32 + r() * 0.15), dust: 0.55 + r() * 0.45 });
    }
  };
  add(3, 0.36, 0.5, 0.02);
  add(9, 0.17, 0.3, 0.017);
  add(24, 0.075, 0.14, 0.011);

  // Plates: the local tangent plane of the shared surface, tilted a little
  // and sunk a touch so each reads as a chipped face.
  const plates: Plate[] = [];
  const d: Vec3 = [0, 0, 0];
  const at = (x: number, y: number, z: number, out: Vec3) => {
    const l = Math.hypot(x, y, z) || 1;
    d[0] = x / l;
    d[1] = y / l;
    d[2] = z / l;
    const rad = surfaceRadius(d, seed);
    out[0] = d[0] * rad;
    out[1] = d[1] * rad;
    out[2] = d[2] * rad;
    return out;
  };
  const p0: Vec3 = [0, 0, 0];
  const pa: Vec3 = [0, 0, 0];
  const pb: Vec3 = [0, 0, 0];
  for (let i = 0; i < 110; i++) {
    const c = randomUnit(r);
    const t1 = new Vector3(0, 1, 0);
    const cv = new Vector3(c[0], c[1], c[2]);
    if (Math.abs(c[1]) > 0.9) t1.set(1, 0, 0);
    t1.cross(cv).normalize();
    const t2 = new Vector3().crossVectors(cv, t1);
    const e = 0.03;
    at(c[0] + t1.x * e, c[1] + t1.y * e, c[2] + t1.z * e, pa);
    at(c[0] - t1.x * e, c[1] - t1.y * e, c[2] - t1.z * e, pb);
    const ax = new Vector3(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    at(c[0] + t2.x * e, c[1] + t2.y * e, c[2] + t2.z * e, pa);
    at(c[0] - t2.x * e, c[1] - t2.y * e, c[2] - t2.z * e, pb);
    const bx = new Vector3(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    const n = new Vector3().crossVectors(ax, bx);
    if (n.dot(cv) < 0) n.negate();
    if (!(n.lengthSq() > 1e-12)) n.copy(cv);
    n.normalize();
    const j = randomUnit(r);
    n.x += j[0] * 0.2;
    n.y += j[1] * 0.2;
    n.z += j[2] * 0.2;
    n.normalize();
    if (n.dot(cv) < 0.6) n.copy(cv);
    at(c[0], c[1], c[2], p0);
    const sink = 1 - 0.004 - r() * 0.006;
    const k = (n.x * p0[0] + n.y * p0[1] + n.z * p0[2]) * sink;
    plates.push({ c, n: [n.x, n.y, n.z], k });
  }
  f = { craters, plates, s: (seed * 7919) | 0 };
  fieldCache.set(seed, f);
  return f;
}

interface Detail {
  /** Relative height of the real mesh, ±DETAIL_MAX. */
  h: number;
  /** Deeper relief used only for the shading normals. */
  hs: number;
  /** Pale crater-floor dust, 0..1. */
  dust: number;
  /** Inside a crater bowl, 0..1. */
  pit: number;
  /** 1 on the crease between two plates, fading to 0 inside them. */
  crease: number;
}

const tmpDetail: Detail = { h: 0, hs: 0, dust: 0, pit: 0, crease: 0 };

function smooth(e0: number, e1: number, x: number): number {
  const t = MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Fine relief along unit direction `d` (where the shared surface has radius
 * `r0`): bowl craters with raised rims, chiselled plates and a few soft
 * ridges.
 */
function detailAt(d: Vec3, r0: number, field: RockField, out: Detail = tmpDetail): Detail {
  let hc = 0;
  let dust = 0;
  let pit = 0;
  for (const k of field.craters) {
    const dot = d[0] * k.c[0] + d[1] * k.c[1] + d[2] * k.c[2];
    if (dot < k.cosOuter) continue;
    const x = Math.acos(Math.min(1, dot)) / k.a;
    if (x < 1) {
      hc -= k.depth * (1 - smooth(0.18, 1, x));
      pit = Math.max(pit, 1 - smooth(0.45, 1, x));
      dust = Math.max(dust, (1 - smooth(0.5, 0.85, x)) * k.dust);
    }
    const rr = (x - 0.98) / 0.2;
    hc += k.rim * Math.exp(-rr * rr);
    if (x > 1) hc += k.rim * 0.25 * Math.exp(-(x - 1) * 3);
  }
  // Nearest two plates.
  let b1 = -2;
  let b2 = -2;
  let best: Plate | null = null;
  for (const p of field.plates) {
    const dot = d[0] * p.c[0] + d[1] * p.c[1] + d[2] * p.c[2];
    if (dot > b1) {
      b2 = b1;
      b1 = dot;
      best = p;
    } else if (dot > b2) b2 = dot;
  }
  let hf = 0;
  if (best) {
    const den = best.n[0] * d[0] + best.n[1] * d[1] + best.n[2] * d[2];
    if (den > 0.2 && r0 > 1e-6) hf = MathUtils.clamp(best.k / den / r0 - 1, -0.07, 0.07);
  }
  const ridge = 1 - Math.abs(2 * nd(d, 3.1, 4.3, field.s) - 1);
  const hn = 0.008 * (ridge * ridge * ridge - 0.3) + 0.006 * (nd(d, 8.5, 9.7, field.s) - 0.5);
  out.h = MathUtils.clamp(hc + hn + hf * 0.45, -DETAIL_MAX, DETAIL_MAX);
  out.hs = MathUtils.clamp(hc * 2.8 + hn * 1.6 + hf * 0.85, -0.11, 0.11);
  out.dust = dust;
  out.pit = pit;
  out.crease = 1 - smooth(0, 0.007, b1 - b2);
  return out;
}

const dTmp: Vec3 = [0, 0, 0];

/** Radius of the rendered rock (shared surface plus fine detail) along unit direction `d`. */
export function rockRadius(d: Vec3, seed: number): number {
  const r0 = surfaceRadius(d, seed);
  return r0 * (1 + detailAt(d, r0, rockField(seed)).h);
}

/**
 * Point on the rendered rock along a (not necessarily unit) local direction,
 * and the surface's true outward normal there (from finite differences), so
 * decals and crystals sit flush on crater walls and ridges.
 */
export function surfaceFrame(dir: Vector3, seed: number, outP: Vector3, outN: Vector3): void {
  const n = outN.copy(dir).normalize();
  if (!Number.isFinite(n.x) || n.lengthSq() < 0.5) n.set(0, 1, 0);
  const at = (x: number, y: number, z: number, v: Vector3) => {
    const l = Math.hypot(x, y, z) || 1;
    dTmp[0] = x / l;
    dTmp[1] = y / l;
    dTmp[2] = z / l;
    const r = rockRadius(dTmp, seed);
    return v.set(dTmp[0] * r, dTmp[1] * r, dTmp[2] * r);
  };
  at(n.x, n.y, n.z, outP);
  // Tangent frame around n.
  const t1 = sfT1.set(0, 1, 0);
  if (Math.abs(n.y) > 0.9) t1.set(1, 0, 0);
  t1.cross(n).normalize();
  const t2 = sfT2.crossVectors(n, t1);
  const e = 0.012;
  at(n.x + t1.x * e, n.y + t1.y * e, n.z + t1.z * e, sfA);
  at(n.x - t1.x * e, n.y - t1.y * e, n.z - t1.z * e, sfB);
  sfA.sub(sfB);
  at(n.x + t2.x * e, n.y + t2.y * e, n.z + t2.z * e, sfB);
  at(n.x - t2.x * e, n.y - t2.y * e, n.z - t2.z * e, sfC);
  sfB.sub(sfC);
  sfC.crossVectors(sfB, sfA);
  if (sfC.dot(n) < 0) sfC.negate();
  const l = sfC.length();
  if (l > 1e-9 && Number.isFinite(l)) outN.copy(sfC).divideScalar(l);
}
const sfT1 = new Vector3();
const sfT2 = new Vector3();
const sfA = new Vector3();
const sfB = new Vector3();
const sfC = new Vector3();

const BASALT_DARK = new Color('#2c2826');
const BASALT = new Color('#4b4541');
const BASALT_WARM = new Color('#5c4c40');
const RUST = new Color('#74391f');
const RUST_BRIGHT = new Color('#a05a30');
const IRON = new Color('#525a66');
const TAN = new Color('#8c7660');
const DUST = new Color('#a29581');
const CREVICE = new Color('#130f0e');

/**
 * Deterministic asteroid: a smooth geodesic sphere pushed out to the shared
 * surface function (so seam directions from the host land on the mesh),
 * plus small craters, chiselled plates and ridges. The vertex normals come
 * from a deeper version of that relief, so the craters and facets shade
 * boldly while the silhouette stays on the shared surface.
 *
 * Per vertex it bakes the albedo (basalt, rust and iron patches, strata,
 * pale dust in crater floors, dark creases and crevices) and an `aRock`
 * attribute: x = ambient occlusion, y = crater dust, z = where molten veins
 * run, w = iron (metallic) content. The rock shader adds the fine detail.
 *
 * Also returns a light, low-poly copy of the shared surface for tap raycasts.
 */
export function buildRock(seed: number, lite: boolean): { rock: BufferGeometry; hit: BufferGeometry } {
  const field = rockField(seed);
  const rock = icoSphere(lite ? 29 : 35);
  const pos = rock.attributes.position as BufferAttribute;
  const n = pos.count;
  const base = new Float32Array(n);
  const det = new Float32Array(n * 4);
  const shade = new Float32Array(n * 3);
  const d: Vec3 = [0, 0, 0];
  let minR = Infinity;
  let maxR = -Infinity;
  for (let i = 0; i < n; i++) {
    d[0] = pos.getX(i);
    d[1] = pos.getY(i);
    d[2] = pos.getZ(i);
    const r0 = surfaceRadius(d, seed);
    const dt = detailAt(d, r0, field);
    base[i] = r0;
    det[i * 4] = dt.hs;
    det[i * 4 + 1] = dt.dust;
    det[i * 4 + 2] = dt.pit;
    det[i * 4 + 3] = dt.crease;
    if (r0 < minR) minR = r0;
    if (r0 > maxR) maxR = r0;
    const rs = r0 * (1 + dt.hs);
    shade[i * 3] = d[0] * rs;
    shade[i * 3 + 1] = d[1] * rs;
    shade[i * 3 + 2] = d[2] * rs;
    const r = r0 * (1 + dt.h);
    pos.setXYZ(i, d[0] * r, d[1] * r, d[2] * r);
  }

  const rr = rng((seed ^ 0x51ed27) >>> 0);
  const strataAxis = randomUnit(rr);
  const strataFreq = 13 + rr() * 9;
  const s = field.s;
  const colors = new Float32Array(n * 3);
  const extra = new Float32Array(n * 4);
  const c = new Color();
  const span = Math.max(1e-3, maxR - minR);

  for (let i = 0; i < n; i++) {
    const len = Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i)) || 1;
    d[0] = pos.getX(i) / len;
    d[1] = pos.getY(i) / len;
    d[2] = pos.getZ(i) / len;
    const hN = (base[i] - minR) / span; // 0 = deepest valley, 1 = highest ridge
    const hs = det[i * 4];
    const dust = det[i * 4 + 1];
    const pit = det[i * 4 + 2];
    const crease = det[i * 4 + 3];

    const grain = nd(d, 7.3, 1.1, s);
    const broad = fbm2(d, 1.6, 2.2, s);
    c.copy(BASALT_DARK).lerp(BASALT, smooth(0.28, 0.72, broad));
    c.lerp(BASALT_WARM, smooth(0.45, 0.75, nd(d, 2.3, 17, s)) * 0.75);
    const rust = smooth(0.56, 0.74, fbm2(d, 2.1, 31, s));
    c.lerp(RUST, rust * 0.65).lerp(RUST_BRIGHT, rust * grain * 0.45);
    const iron = smooth(0.6, 0.76, nd(d, 3.1, 47, s)) * (1 - rust);
    c.lerp(IRON, iron * 0.8);
    c.lerp(TAN, smooth(0.58, 0.95, hN) * smooth(0.4, 0.7, nd(d, 4.2, 5, s)) * 0.55);
    // Layered strata bands.
    const strata = Math.sin((d[0] * strataAxis[0] + d[1] * strataAxis[1] + d[2] * strataAxis[2]) * strataFreq + broad * 5);
    c.multiplyScalar(0.9 + 0.1 * strata);
    // Crevices and creases between plates go dark; raised faces catch a little wear.
    const crevice = smooth(0.36, 0, hN);
    c.lerp(CREVICE, crevice * 0.5 + crease * 0.3);
    c.multiplyScalar(1 + MathUtils.clamp(hs * 4, -0.25, 0.25));
    // Pale dust settles in crater floors.
    c.lerp(DUST, dust * 0.42);
    c.multiplyScalar(0.88 + 0.24 * grain);
    c.toArray(colors, i * 3);

    const bowl = MathUtils.clamp(-hs / 0.06, 0, 1);
    extra[i * 4] = MathUtils.clamp(1 - crevice * 0.5 - bowl * 0.4 - crease * 0.25, 0.3, 1);
    extra[i * 4 + 1] = dust;
    extra[i * 4 + 2] = fbm2(d, 1.35, 63, s) + crevice * 0.12 * nd(d, 2, 9, s) - pit * 0.25;
    extra[i * 4 + 3] = iron;
  }
  // Molten veins over about a sixth of the surface, whatever the seed.
  const veinRaw = new Float32Array(n);
  for (let i = 0; i < n; i++) veinRaw[i] = extra[i * 4 + 2];
  veinRaw.sort();
  const cut = veinRaw[Math.floor(n * 0.83)];
  for (let i = 0; i < n; i++) extra[i * 4 + 2] = smooth(cut - 0.05, cut + 0.07, extra[i * 4 + 2]);
  rock.setAttribute('color', new BufferAttribute(colors, 3));
  rock.setAttribute('aRock', new BufferAttribute(extra, 4));
  // Normals from the deeper relief, then the real positions back.
  const real = rock.attributes.position;
  rock.setAttribute('position', new BufferAttribute(shade, 3));
  rock.computeVertexNormals();
  rock.setAttribute('position', real);
  rock.computeBoundingSphere();

  // Tap target: the shared surface at low resolution.
  const hit = icoSphere(12);
  const hp = hit.attributes.position as BufferAttribute;
  for (let i = 0; i < hp.count; i++) {
    d[0] = hp.getX(i);
    d[1] = hp.getY(i);
    d[2] = hp.getZ(i);
    const r = surfaceRadius(d, seed);
    hp.setXYZ(i, d[0] * r, d[1] * r, d[2] * r);
  }
  hit.computeVertexNormals();
  hit.computeBoundingSphere();
  return { rock, hit };
}

/**
 * Directions for decorative crystal clusters: away from crater floors,
 * deterministic per seed.
 */
export function crystalSites(seed: number, count: number): Vec3[] {
  const field = rockField(seed);
  const r = rng((Math.imul(seed, 40503) ^ 0x2545f491) >>> 0);
  const out: Vec3[] = [];
  for (let tries = 0; out.length < count && tries < count * 40; tries++) {
    const d = randomUnit(r);
    if (detailAt(d, surfaceRadius(d, seed), field).pit > 0.15) continue;
    if (out.some((o) => o[0] * d[0] + o[1] * d[1] + o[2] * d[2] > 0.82)) continue;
    out.push(d);
  }
  return out;
}

/* ---------------- props ---------------- */

/**
 * Hexagonal crystal with a pyramid tip, base at y=0 and tip at y≈1.2,
 * with per-face normals baked in (crisp facets without flatShading).
 */
export function crystalGeometry(): BufferGeometry {
  const pts = [new Vector2(0, -0.05), new Vector2(0.9, 0), new Vector2(1, 0.72), new Vector2(0, 1.2)];
  const lathe = new LatheGeometry(pts, 6);
  const g = lathe.toNonIndexed();
  lathe.dispose();
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

/** A chunky, faceted pebble about one unit across, for the debris belt. */
export function pebbleGeometry(seed: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, 1);
  g.deleteAttribute('uv');
  const p = g.attributes.position as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    // Same position → same push, so the facets stay closed.
    const k = 0.72 + 0.5 * noise3(x * 1.7 + 3, y * 1.7, z * 1.7, seed);
    p.setXYZ(i, x * k, y * k * 0.8, z * k);
  }
  g.computeVertexNormals();
  return g;
}
