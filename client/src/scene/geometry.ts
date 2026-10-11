import { BufferAttribute, BufferGeometry, IcosahedronGeometry, LatheGeometry, MathUtils, Vector2, Vector3 } from 'three';
import { ASTEROID_RADIUS, randomUnit, rng, surfaceRadius, terrainAt, type Terrain, type Vec3 } from '@starforge/shared';

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

/* ---------------- planet ---------------- */

/**
 * Largest relative height the fine detail (impact craters) may add to or
 * carve from the real mesh. The host's `surfaceRadius` stays authoritative
 * for where seams, rigs and strikes land, so this stays small; the shading
 * normals use a deeper version of the same relief.
 */
export const DETAIL_MAX = 0.012;
/** How much steeper than the real mesh the shading normals make the terrain. */
const RELIEF_SHADE = 1.8;

export type PlanetKind = 'terran' | 'molten';

/** Most worlds are blue-green with oceans and city lights; about one in three is a molten world with lava seas. */
export function planetKind(seed: number): PlanetKind {
  return rng((Math.imul(seed, 0x2c1b3c6d) ^ 0x5bd1e995) >>> 0)() < 0.32 ? 'molten' : 'terran';
}

interface Crater {
  c: Vec3;
  /** Angular radius (rad). */
  a: number;
  /** Influence ends at this cosine (≈1.75 radii out). */
  cosOuter: number;
  depth: number;
  rim: number;
}

interface PlanetField {
  craters: Crater[];
  s: number;
}

const fieldCache = new Map<number, PlanetField>();

function planetField(seed: number): PlanetField {
  let f = fieldCache.get(seed);
  if (f) return f;
  const r = rng((Math.imul(seed, 2654435761) ^ 0x6a09e667) >>> 0);
  const craters: Crater[] = [];
  const many = planetKind(seed) === 'molten' ? 1.6 : 1;
  const add = (n: number, aMin: number, aMax: number, depth: number) => {
    for (let i = 0; i < Math.round(n * many); i++) {
      const a = aMin + r() * (aMax - aMin);
      const dp = depth * (0.75 + r() * 0.5);
      craters.push({ c: randomUnit(r), a, cosOuter: Math.cos(Math.min(Math.PI, a * 1.75)), depth: dp, rim: dp * (0.3 + r() * 0.15) });
    }
  };
  add(2, 0.2, 0.28, 0.011);
  add(6, 0.09, 0.15, 0.008);
  add(14, 0.04, 0.075, 0.006);
  f = { craters, s: (seed * 7919) | 0 };
  fieldCache.set(seed, f);
  return f;
}

interface Detail {
  /** Relative height of the real mesh, ±DETAIL_MAX. */
  h: number;
  /** Deeper crater relief used only for the shading normals. */
  hs: number;
  /** Inside a crater bowl, 0..1. */
  pit: number;
}

const tmpDetail: Detail = { h: 0, hs: 0, pit: 0 };
const tmpTerrain: Terrain = { elev: 0, ridge: 0, h: 0 };

function smooth(e0: number, e1: number, x: number): number {
  const t = MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Impact craters along unit direction `d`, on land only (they fade out
 * toward the coast, so the sea stays a flat surface at the shared radius).
 */
function detailAt(d: Vec3, elev: number, field: PlanetField, out: Detail = tmpDetail): Detail {
  const landK = smooth(0.02, 0.14, elev);
  if (landK <= 0) {
    out.h = 0;
    out.hs = 0;
    out.pit = 0;
    return out;
  }
  let hc = 0;
  let pit = 0;
  for (const k of field.craters) {
    const dot = d[0] * k.c[0] + d[1] * k.c[1] + d[2] * k.c[2];
    if (dot < k.cosOuter) continue;
    const x = Math.acos(Math.min(1, dot)) / k.a;
    if (x < 1) {
      hc -= k.depth * (1 - smooth(0.18, 1, x));
      pit = Math.max(pit, 1 - smooth(0.45, 1, x));
    }
    const rr = (x - 0.98) / 0.2;
    hc += k.rim * Math.exp(-rr * rr);
    if (x > 1) hc += k.rim * 0.25 * Math.exp(-(x - 1) * 3);
  }
  out.h = MathUtils.clamp(hc * landK, -DETAIL_MAX, DETAIL_MAX);
  out.hs = MathUtils.clamp(hc * 2.6 * landK, -0.05, 0.05);
  out.pit = pit * landK;
  return out;
}

const dTmp: Vec3 = [0, 0, 0];

/** Radius of the rendered planet (shared surface plus craters) along unit direction `d`. */
export function rockRadius(d: Vec3, seed: number): number {
  const t = terrainAt(d, seed, tmpTerrain);
  const r0 = ASTEROID_RADIUS * (1 + t.h);
  return r0 * (1 + detailAt(d, t.elev, planetField(seed)).h);
}

/**
 * Point on the rendered planet along a (not necessarily unit) local
 * direction, and the surface's true outward normal there (from finite
 * differences), so decals and crystals sit flush on slopes and crater walls.
 */
export function surfaceFrame(dir: Vector3, seed: number, outP: Vector3, outN: Vector3): void {
  const n = outN.copy(dir).normalize();
  if (!Number.isFinite(n.x + n.y + n.z) || n.lengthSq() < 0.5) n.set(0, 1, 0);
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

/**
 * Deterministic planet: a smooth geodesic sphere pushed out to the shared
 * surface function (flat seas at the base radius, continents and ridged
 * mountains above it, so seam directions from the host land on the mesh),
 * plus impact craters on land. The vertex normals come from a steeper
 * version of that relief, so mountain ranges and craters shade boldly while
 * the silhouette stays on the shared surface.
 *
 * The planet shader colours everything per pixel from two attributes:
 * `aGeo` = (signed elevation, mountain ridges, crater floor, occlusion) and
 * `aMine` = (where molten veins run under the crust, moisture).
 *
 * Also returns a light, low-poly copy of the shared surface for tap raycasts.
 */
export function buildPlanet(seed: number, lite: boolean): { rock: BufferGeometry; hit: BufferGeometry } {
  const field = planetField(seed);
  const rock = icoSphere(lite ? 40 : 56);
  const pos = rock.attributes.position as BufferAttribute;
  const n = pos.count;
  const shade = new Float32Array(n * 3);
  const geo = new Float32Array(n * 4);
  const mine = new Float32Array(n * 2);
  const veinRaw = new Float32Array(n);
  const d: Vec3 = [0, 0, 0];
  const s = field.s;
  for (let i = 0; i < n; i++) {
    d[0] = pos.getX(i);
    d[1] = pos.getY(i);
    d[2] = pos.getZ(i);
    const t = terrainAt(d, seed, tmpTerrain);
    const dt = detailAt(d, t.elev, field);
    const r0 = ASTEROID_RADIUS * (1 + t.h);
    const r = r0 * (1 + dt.h);
    pos.setXYZ(i, d[0] * r, d[1] * r, d[2] * r);
    const rs = ASTEROID_RADIUS * (1 + t.h * RELIEF_SHADE) * (1 + dt.hs);
    shade[i * 3] = d[0] * rs;
    shade[i * 3 + 1] = d[1] * rs;
    shade[i * 3 + 2] = d[2] * rs;
    geo[i * 4] = t.elev;
    geo[i * 4 + 1] = t.ridge;
    geo[i * 4 + 2] = dt.pit;
    // Occlusion: crater bowls and the folds between ridges.
    geo[i * 4 + 3] = MathUtils.clamp(1 - MathUtils.clamp(-dt.hs / 0.03, 0, 1) * 0.35 - (t.ridge > 0 ? (1 - t.ridge) * 0.12 * smooth(0.1, 0.4, t.elev) : 0), 0.4, 1);
    veinRaw[i] = fbm2(d, 1.35, 63, s);
    mine[i * 2 + 1] = MathUtils.clamp((fbm2(d, 1.7, 21, s) - 0.25) * 2, 0, 1);
  }
  // Molten veins under about a sixth of the surface, whatever the seed.
  const sorted = veinRaw.slice().sort();
  const cut = sorted[Math.floor(n * 0.83)];
  for (let i = 0; i < n; i++) mine[i * 2] = smooth(cut - 0.05, cut + 0.07, veinRaw[i]);
  rock.setAttribute('aGeo', new BufferAttribute(geo, 4));
  rock.setAttribute('aMine', new BufferAttribute(mine, 2));
  // Normals from the steeper relief, then the real positions back.
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

/** A unit geodesic sphere for the cloud layer and atmosphere shell. */
export function shellGeometry(lite: boolean): BufferGeometry {
  const g = icoSphere(lite ? 20 : 30);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
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
