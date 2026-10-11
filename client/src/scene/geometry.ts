import { BufferAttribute, BufferGeometry, Color, IcosahedronGeometry, LatheGeometry, MathUtils, Vector2 } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { randomUnit, rng, surfaceRadius, type Vec3 } from '@starforge/shared';

/* ---------------- asteroid ---------------- */

interface Lobe {
  k: Vec3;
  f: number;
  p: number;
  a: number;
}

function lobes(r: () => number, n: number, fMin: number, fMax: number): Lobe[] {
  const out: Lobe[] = [];
  for (let i = 0; i < n; i++) out.push({ k: randomUnit(r), f: fMin + r() * (fMax - fMin), p: r() * Math.PI * 2, a: 1 / (1 + i * 0.5) });
  return out;
}

function field(ls: Lobe[], x: number, y: number, z: number): number {
  let h = 0;
  let norm = 0;
  for (const l of ls) {
    h += Math.sin((x * l.k[0] + y * l.k[1] + z * l.k[2]) * l.f + l.p) * l.a;
    norm += l.a;
  }
  return h / norm;
}

const TONE_CREVICE = new Color('#120e10');
const TONE_WARM = new Color('#5e4a3b');
const TONE_COOL = new Color('#45414f');
const TONE_TAN = new Color('#85705a');
const TONE_RUST = new Color('#6e4030');
const SPECKLES = [new Color('#e0a04a'), new Color('#6fd6de'), new Color('#cfc8de'), new Color('#ff8a3a')];

/**
 * Deterministic asteroid: an icosphere pushed out to the shared surface
 * function, so seam directions from the host land exactly on the mesh.
 * Colours are assigned per facet for a crisp low-poly look: layered rock
 * tones, strata, dark crevices in the valleys and a few mineral speckles.
 * Also returns a smooth, slightly inflated shell for the tap-heat and surge glow.
 */
export function buildRock(seed: number): { rock: BufferGeometry; shell: BufferGeometry } {
  const rock = new IcosahedronGeometry(1, 11);
  rock.deleteAttribute('uv');
  const pos = rock.attributes.position as BufferAttribute;
  const n = pos.count;
  const radii = new Float32Array(n);
  const d: Vec3 = [0, 0, 0];
  let minR = Infinity;
  let maxR = -Infinity;
  for (let i = 0; i < n; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    x /= len;
    y /= len;
    z /= len;
    d[0] = x;
    d[1] = y;
    d[2] = z;
    const r = surfaceRadius(d, seed);
    radii[i] = r;
    if (r < minR) minR = r;
    if (r > maxR) maxR = r;
    pos.setXYZ(i, x * r, y * r, z * r);
  }

  const rr = rng((seed ^ 0x51ed27) >>> 0);
  const broad = lobes(rr, 5, 1.5, 4);
  const fine = lobes(rr, 5, 6, 12);
  const strataAxis = randomUnit(rr);
  const strataFreq = 14 + rr() * 10;
  const colors = new Float32Array(n * 3);
  const c = new Color();
  const span = Math.max(1e-3, maxR - minR);

  // Non-indexed: every 3 consecutive vertices are one facet.
  for (let f = 0; f < n; f += 3) {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let rad = 0;
    for (let k = 0; k < 3; k++) {
      cx += pos.getX(f + k);
      cy += pos.getY(f + k);
      cz += pos.getZ(f + k);
      rad += radii[f + k];
    }
    rad /= 3;
    const len = Math.hypot(cx, cy, cz) || 1;
    cx /= len;
    cy /= len;
    cz /= len;

    const h = (rad - minR) / span; // 0 = deepest valley, 1 = highest ridge
    const b = field(broad, cx, cy, cz);
    const fn = field(fine, cx, cy, cz);

    c.copy(TONE_COOL).lerp(TONE_WARM, MathUtils.smoothstep(b, -0.35, 0.35));
    c.lerp(TONE_TAN, MathUtils.smoothstep(fn, 0.15, 0.8) * 0.65 * MathUtils.smoothstep(h, 0.3, 0.9));
    c.lerp(TONE_RUST, MathUtils.smoothstep(b * fn, 0.12, 0.35) * 0.5);
    // Layered strata bands.
    const strata = Math.sin((cx * strataAxis[0] + cy * strataAxis[1] + cz * strataAxis[2]) * strataFreq + fn * 2.5);
    c.multiplyScalar(0.86 + 0.14 * strata);
    // Crevices: valleys go nearly black.
    c.lerp(TONE_CREVICE, MathUtils.smoothstep(0.42 - h, 0, 0.42) * 0.6);
    // Per-facet grit.
    c.multiplyScalar(0.82 + rr() * 0.32);
    // Mineral speckles, mostly on exposed faces.
    if (rr() < 0.007 + 0.012 * h) {
      c.copy(SPECKLES[Math.floor(rr() * SPECKLES.length)]).multiplyScalar(0.55 + rr() * 0.45);
    }
    for (let k = 0; k < 3; k++) c.toArray(colors, (f + k) * 3);
  }
  rock.setAttribute('color', new BufferAttribute(colors, 3));
  rock.computeVertexNormals();
  rock.computeBoundingSphere();

  // Smooth shell for the fresnel glow.
  const ico = new IcosahedronGeometry(1, 9);
  ico.deleteAttribute('uv');
  ico.deleteAttribute('normal');
  const shell = mergeVertices(ico);
  ico.dispose();
  const sp = shell.attributes.position as BufferAttribute;
  for (let i = 0; i < sp.count; i++) {
    let x = sp.getX(i);
    let y = sp.getY(i);
    let z = sp.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    x /= len;
    y /= len;
    z /= len;
    d[0] = x;
    d[1] = y;
    d[2] = z;
    const r = surfaceRadius(d, seed) * 1.03 + 0.07;
    sp.setXYZ(i, x * r, y * r, z * r);
  }
  shell.computeVertexNormals();
  shell.computeBoundingSphere();
  return { rock, shell };
}

/* ---------------- props ---------------- */

/** Hexagonal crystal with a pyramid tip, base at y=0 and tip at y≈1.2. */
export function crystalGeometry(): BufferGeometry {
  const pts = [new Vector2(0, -0.05), new Vector2(0.9, 0), new Vector2(1, 0.72), new Vector2(0, 1.2)];
  return new LatheGeometry(pts, 6);
}
