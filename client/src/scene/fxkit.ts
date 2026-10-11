import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  type BufferGeometry,
  type ColorRepresentation,
  type Matrix4,
  ShaderMaterial,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Shared building blocks for the models and effects: merged low-poly models
 * with per-part vertex colours, an instanced camera-facing glow, an
 * instanced beam ribbon, and a registry of pooled effect spawners
 * (flashes, ore motes, rock chunks) that scene components fill on mount.
 *
 * Every shader here is written to be NaN-free: no pow() of a possibly
 * negative base, no division by something that can be zero, no normalize()
 * of a possibly zero vector (bloom would smear a single NaN pixel over the
 * whole screen).
 */

/* ---------------- models ---------------- */

/** One primitive of a merged model and its colour (sRGB, like any CSS colour). */
export type Part = [BufferGeometry, ColorRepresentation];

const tmpColor = new Color();

/**
 * Merge primitives into one non-indexed geometry with a `color` attribute
 * per part, for one draw call per model (or per instanced model). The input
 * geometries are disposed.
 */
export function mergeParts(parts: Part[]): BufferGeometry {
  const list = parts.map(([g, c]) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    if (!n.attributes.normal) n.computeVertexNormals();
    tmpColor.set(c);
    const count = n.attributes.position.count;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = tmpColor.r;
      arr[i * 3 + 1] = tmpColor.g;
      arr[i * 3 + 2] = tmpColor.b;
    }
    n.setAttribute('color', new BufferAttribute(arr, 3));
    return n;
  });
  const out = mergeGeometries(list, false);
  for (const g of list) g.dispose();
  if (!out) throw new Error('mergeParts: incompatible parts');
  out.computeBoundingSphere();
  return out;
}

/* ---------------- instanced glow sprites ---------------- */

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  // Billboard: the instance's origin in view space, grown by its X/Y scale.
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 s = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
}
`;

const GLOW_FRAG = /* glsl */ `
uniform float uStar;
uniform float uCore;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = dot(p, p);
  if (d >= 1.0) discard;
  float edge = 1.0 - d;
  float glow = exp(-d * 5.0) * edge;
  float core = exp(-d * 30.0);
  float star = (exp(-abs(p.x) * 34.0) * exp(-abs(p.y) * 3.2) + exp(-abs(p.y) * 34.0) * exp(-abs(p.x) * 3.2)) * edge;
  float lum = min(length(vCol), 3.0);
  gl_FragColor = vec4(vCol * (glow + star * uStar) + vec3(core * uCore * lum), 1.0);
}
`;

/**
 * Additive camera-facing glow for an InstancedMesh of `PlaneGeometry(1, 1)`:
 * each instance's origin is the glow's centre, its X/Y scale the glow's
 * size, and its instance colour the (HDR) colour. `star` adds four-point
 * spikes, `core` a white-hot centre.
 */
export function makeGlowMaterial(star = 0, core = 0.5): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: { uStar: { value: star }, uCore: { value: core } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

/* ---------------- instanced beam ribbons ---------------- */

const BEAM_VERT = /* glsl */ `
uniform float uTaper;
varying vec2 vUv;
varying vec3 vCol;
varying float vLen;
void main() {
  vUv = uv;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  vLen = length(instanceMatrix[1].xyz);
  // Optionally thinner at the start (a muzzle right by the camera would look huge).
  vec3 p = position;
  p.x *= mix(uTaper, 1.0, smoothstep(0.0, 0.45, uv.y));
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
}
`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uCore;
uniform float uFlow;
uniform float uFreq;
varying vec2 vUv;
varying vec3 vCol;
varying float vLen;
void main() {
  float x = vUv.x * 2.0 - 1.0;
  float x2 = x * x;
  float core = exp(-x2 * 60.0);
  float glow = exp(-x2 * 5.0) * (1.0 - x2);
  float y = clamp(vUv.y, 0.0, 1.0);
  float ends = smoothstep(0.0, 0.05, y) * (0.75 + 0.25 * smoothstep(0.9, 1.0, y));
  float flow = 0.78 + 0.22 * sin(y * vLen * uFreq - uTime * uFlow);
  float lum = min(length(vCol), 3.0);
  vec3 c = vCol * glow * flow + vec3(core * uCore * lum * (0.85 + 0.15 * flow));
  gl_FragColor = vec4(c * ends, 1.0);
}
`;

/**
 * Additive beam for an InstancedMesh of `beamGeometry()`: a white-hot core
 * inside a coloured glow, with energy rippling along it. Place instances
 * with `ribbonMatrix`. Animate with `uniforms.uTime`.
 */
export function makeBeamMaterial(opts: { core?: number; flow?: number; freq?: number; taper?: number } = {}): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: BEAM_VERT,
    fragmentShader: BEAM_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: opts.core ?? 0.9 },
      uFlow: { value: opts.flow ?? 30 },
      uFreq: { value: opts.freq ?? 9 },
      uTaper: { value: opts.taper ?? 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

const rd = new Vector3();
const rs = new Vector3();
const rn = new Vector3();
const rv = new Vector3();

/**
 * Matrix placing a unit ribbon (x across −0.5..0.5, y along 0..1, i.e.
 * `PlaneGeometry(1, 1).translate(0, 0.5, 0)`) from `a` to `b`, `w` wide,
 * turned about its axis to face `eye`. Degenerate input gives a zero-size
 * matrix, never NaN.
 */
export function ribbonMatrix(out: Matrix4, a: Vector3, b: Vector3, w: number, eye: Vector3): Matrix4 {
  rd.subVectors(b, a);
  const len = rd.length();
  rv.addVectors(a, b).multiplyScalar(0.5);
  rv.subVectors(eye, rv);
  rs.crossVectors(rd, rv);
  let sl = rs.length();
  if (sl < 1e-9) {
    rs.set(1, 0, 0).cross(rd);
    sl = rs.length();
    if (sl < 1e-9) {
      rs.set(0, 1, 0).cross(rd);
      sl = rs.length();
    }
  }
  if (!(len > 1e-6) || !(sl > 1e-9) || !Number.isFinite(w)) return out.makeScale(0, 0, 0).setPosition(a);
  rs.multiplyScalar(w / sl);
  rn.crossVectors(rs, rd);
  const nl = rn.length();
  if (nl > 1e-12) rn.multiplyScalar(1 / nl);
  else rn.set(0, 0, 1);
  return out.set(rs.x, rd.x, rn.x, a.x, rs.y, rd.y, rn.y, a.y, rs.z, rd.z, rn.z, a.z, 0, 0, 0, 1);
}

/* ---------------- maths ---------------- */

/** Unit vector perpendicular to `n` (unit), written to `out`. */
export function anyPerp(n: Vector3, out: Vector3): Vector3 {
  if (Math.abs(n.y) < 0.9) out.set(0, 1, 0);
  else out.set(1, 0, 0);
  out.cross(n);
  const l = out.length();
  return l > 1e-9 ? out.multiplyScalar(1 / l) : out.set(1, 0, 0);
}

/** Random unit vector, written to `out`. */
export function randomDir(out: Vector3): Vector3 {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return out.set(Math.cos(a) * r, Math.sin(a) * r, z);
}

export const easeOutCubic = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/** Overshooting ease for pop-ins: 0 → ~1.1 → 1. */
export function easeOutBack(t: number, k = 1.70158): number {
  const u = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (k + 1) * u * u * u + k * u * u;
}

/* ---------------- effect spawners ---------------- */

export type FlashKind = 'glow' | 'star' | 'ring' | 'streak';

export interface FlashOpts {
  kind?: FlashKind;
  /** World size at the start and the end of its life. */
  size?: number;
  size1?: number;
  life?: number;
  /** Seconds before it appears. */
  delay?: number;
  /** World units to pull it toward the camera, so a surface doesn't clip it. */
  lift?: number;
  /** Horizontal stretch on screen (streaks). */
  aspect?: number;
}

export interface MoteOpts {
  /** Where the motes fly to: a world point (a ship), or the HUD ore counter when omitted. */
  target?: Vector3 | null;
  speed?: number;
  size?: number;
}

export interface ChunkOpts {
  speed?: number;
  size?: number;
  /** Fraction of chunks tinted with `tint` (ore) instead of rock. */
  ore?: number;
  tint?: Color;
}

type FlashFn = (at: Vector3, color: Color, opts?: FlashOpts) => void;
type MoteFn = (at: Vector3, dir: Vector3 | null, color: Color, count: number, opts?: MoteOpts) => void;
type ChunkFn = (at: Vector3, dir: Vector3, count: number, opts?: ChunkOpts) => void;

/** Pooled spawners, registered by the component that owns each pool (null until it mounts). */
export const kit = {
  flash: null as FlashFn | null,
  motes: null as MoteFn | null,
  chunks: null as ChunkFn | null,
};

export function flash(at: Vector3, color: Color, opts?: FlashOpts): void {
  kit.flash?.(at, color, opts);
}

export function motes(at: Vector3, dir: Vector3 | null, color: Color, count: number, opts?: MoteOpts): void {
  kit.motes?.(at, dir, color, count, opts);
}

export function chunks(at: Vector3, dir: Vector3, count: number, opts?: ChunkOpts): void {
  kit.chunks?.(at, dir, count, opts);
}
