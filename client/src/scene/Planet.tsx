import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderTarget,
  type Group,
} from 'three';
import { bus } from './bus';
import { SUN_DIR } from './Lights';
import { damp, isLite, useBundle } from './util';

/*
 * A ringed gas giant far behind the rock. It rides with the camera's
 * position (like the sun, it is "infinitely" far, so zooming never changes
 * its size) at a fixed direction, picked so it sits half in view in the
 * upper left of the default framing: higher and more central on portrait
 * phones, further left on wide screens. It lies well inside the star shell
 * (200) and sky sphere (260) and far behind everything in the game.
 */

/** Distance from the camera and radius (≈8.9° from the centre to the limb). */
const DIST = 100;
const RADIUS = 15.5;
/** Ring extent in planet radii. */
const RING_IN = 1.32;
const RING_OUT = 2.38;
const ATMO = 1.16;

/* ---------- placement in the default camera's frame ---------- */

const CAM_F = new Vector3(0, -1.6, -7.6).normalize();
const CAM_R = new Vector3(1, 0, 0);
const CAM_U = new Vector3().crossVectors(CAM_R, CAM_F).normalize();
const D2R = Math.PI / 180;

function viewDir(azDeg: number, elDeg: number): Vector3 {
  const az = azDeg * D2R;
  const el = elDeg * D2R;
  return new Vector3()
    .addScaledVector(CAM_F, Math.cos(el) * Math.cos(az))
    .addScaledVector(CAM_R, Math.cos(el) * Math.sin(az))
    .addScaledVector(CAM_U, Math.sin(el))
    .normalize();
}

/** Ring-plane normal for a planet seen along `d`: opened by `open` toward the viewer, rolled by `roll`. */
function ringNormal(d: Vector3, openDeg: number, rollDeg: number): Vector3 {
  const up = CAM_U.clone().addScaledVector(d, -CAM_U.dot(d)).normalize();
  const a = up.multiplyScalar(Math.cos(openDeg * D2R)).addScaledVector(d, -Math.sin(openDeg * D2R)).normalize();
  return a.applyAxisAngle(d, rollDeg * D2R).normalize();
}

const PORTRAIT_DIR = viewDir(-6, 19);
const WIDE_DIR = viewDir(-25, 17);
const PORTRAIT_N = ringNormal(PORTRAIT_DIR, 22, -16);
const WIDE_N = ringNormal(WIDE_DIR, 22, -16);
/** A touch smaller on portrait phones, where it shares the narrow view with the rock. */
const PORTRAIT_SCALE = 0.86;

/* ---------- shaders ---------- */

const COMMON = /* glsl */ `
vec3 pSafeN(vec3 v, vec3 fb) {
  float l2 = dot(v, v);
  return l2 > 1e-20 ? v * inversesqrt(l2) : fb;
}
float pHash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float pNoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(pHash11(i), pHash11(i + 1.0), f);
}
/* Ring opacity at r planet radii: banded ringlets, a dim inner ring and a dark gap. */
float ringDensity(float r) {
  if (r < ${RING_IN.toFixed(3)} || r > ${RING_OUT.toFixed(3)}) return 0.0;
  float x = (r - ${RING_IN.toFixed(3)}) / ${(RING_OUT - RING_IN).toFixed(3)};
  float d = 0.62 + 0.2 * sin(x * 61.0) * sin(x * 17.0 + 1.3) + 0.22 * (pNoise1(x * 140.0) - 0.5) + 0.16 * (pNoise1(x * 37.0 + 5.0) - 0.5);
  d *= smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.93, 1.0, x));
  float g = (x - 0.64) / 0.022;
  d *= 1.0 - 0.92 * exp(-g * g);
  float g2 = (x - 0.86) / 0.008;
  d *= 1.0 - 0.7 * exp(-g2 * g2);
  d *= mix(0.32, 1.0, smoothstep(0.2, 0.3, x));
  return clamp(d, 0.0, 1.0);
}
`;

const BAKE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Equirectangular albedo for the gas giant (stored square-rooted, like the sky). */
const BAKE_FRAG = /* glsl */ `
varying vec2 vUv;
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
vec3 sph(float phi, float theta) {
  return vec3(-cos(phi) * sin(theta), cos(theta), sin(phi) * sin(theta));
}
void main() {
  float phi = vUv.x * 6.2831853;
  float theta = (1.0 - vUv.y) * 3.1415927;
  // A great storm: swirl the coordinates inside an ellipse.
  const float PHI0 = 2.3;
  const float TH0 = 1.98;
  float dphi = mod(phi - PHI0 + 3.1415927, 6.2831853) - 3.1415927;
  vec2 o = vec2(dphi * sin(TH0), theta - TH0);
  vec2 e = o / vec2(0.2, 0.085);
  float r2 = dot(e, e);
  float storm = exp(-r2 * 1.4);
  float ang = 3.2 * exp(-r2 * 0.9);
  float cs = cos(ang);
  float sn = sin(ang);
  e = vec2(e.x * cs - e.y * sn, e.x * sn + e.y * cs);
  o = e * vec2(0.2, 0.085);
  vec3 d = sph(PHI0 + o.x / sin(TH0), TH0 + o.y);
  float dmix = 1.0 - smoothstep(0.8, 2.2, r2);
  vec3 dm = mix(sph(phi, theta), d, dmix);
  d = dm * inversesqrt(max(dot(dm, dm), 1e-12));

  // Turbulent bands: noise stretched along the latitude lines.
  vec3 q = vec3(d.x * 2.2, d.y * 9.0, d.z * 2.2);
  float w = fbm(q * 1.2 + 3.0);
  float w2 = fbm(q * 2.6 - w * 1.8 + 7.0);
  float y = d.y + (w - 0.5) * 0.09 + (w2 - 0.5) * 0.05;
  float b1 = sin(y * 21.0 + 0.6);
  float b2 = sin(y * 46.0 + 2.1 + w * 2.0);
  float b3 = sin(y * 8.5 - 0.4);

  vec3 cream = vec3(0.8, 0.74, 0.64);
  vec3 ochre = vec3(0.64, 0.48, 0.33);
  vec3 rust = vec3(0.52, 0.28, 0.18);
  vec3 brown = vec3(0.3, 0.19, 0.15);
  vec3 slate = vec3(0.3, 0.37, 0.48);

  vec3 col = mix(ochre, cream, smoothstep(-0.35, 0.65, b1));
  col = mix(col, rust, smoothstep(0.5, 0.95, b2) * 0.55);
  col = mix(col, brown, smoothstep(0.55, 1.0, -b3) * 0.5);
  float streak = fbm(vec3(d.x * 3.0, d.y * 42.0, d.z * 3.0) + w * 2.5);
  col *= 0.8 + 0.4 * streak;
  // Pale wisps where the bands shear.
  col = mix(col, cream * 1.05, smoothstep(0.62, 0.8, w2) * 0.35);
  // Cooler, hazier poles.
  float pole = smoothstep(0.62, 0.95, abs(d.y));
  col = mix(col, slate, pole * 0.65);
  // The storm: a rusty eye ringed with cream.
  col = mix(col, vec3(0.72, 0.33, 0.2), storm * 0.75);
  col = mix(col, cream, exp(-(r2 - 1.4) * (r2 - 1.4) * 1.5) * 0.25);
  gl_FragColor = vec4(sqrt(clamp(col, 0.0, 1.0)), 1.0);
}
`;

const BODY_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;
void main() {
  vUv = uv;
  vN = mat3(modelMatrix) * normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const BODY_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uReady;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uRingN;
uniform vec3 uAtmo;
uniform vec3 uTint;
uniform float uTintAmt;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;
${COMMON}
void main() {
  vec3 N = pSafeN(vN, vec3(0.0, 1.0, 0.0));
  vec3 V = pSafeN(cameraPosition - vPos, vec3(0.0, 0.0, 1.0));
  vec3 enc = texture2D(uMap, vUv).rgb;
  vec3 alb = mix(vec3(0.5, 0.42, 0.34), enc * enc, uReady);
  float ndl = dot(N, uSunDir);
  float mu = clamp(dot(N, V), 0.0, 1.0);
  // Soft terminator: thick atmospheres carry a little light past it.
  float wrap = clamp((ndl + 0.12) / 1.12, 0.0, 1.0);
  float light = wrap * wrap * (3.0 - 2.0 * wrap) * 0.35 + clamp(ndl, 0.0, 1.0) * 0.65;
  float limb = 0.4 + 0.6 * sqrt(mu);
  // The rings' shadow.
  float rs = 1.0;
  float dn = dot(uSunDir, uRingN);
  if (abs(dn) > 1e-3) {
    float t = dot(uCenter - vPos, uRingN) / dn;
    if (t > 0.0) rs = 1.0 - 0.82 * ringDensity(length(vPos + uSunDir * t - uCenter) / uRadius);
  }
  vec3 col = alb * uSunColor * light * limb * rs;
  // Warm scattering along the terminator.
  col += alb * vec3(0.55, 0.2, 0.07) * exp(-ndl * ndl * 26.0) * 0.22 * rs;
  // Night side: barely there.
  col += alb * vec3(0.006, 0.008, 0.016);
  // Atmospheric haze toward the limb, on the day side.
  float fr = 1.0 - mu;
  col += uAtmo * fr * fr * fr * smoothstep(-0.25, 0.45, ndl) * 0.8;
  col += uTint * uTintAmt * 0.04 * alb;
  gl_FragColor = vec4(col, 1.0);
}
`;

const RING_VERT = /* glsl */ `
varying vec3 vPos;
varying vec2 vLocal;
void main() {
  vLocal = position.xy * ${(1 / RADIUS).toFixed(6)};
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const RING_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uRingN;
varying vec3 vPos;
varying vec2 vLocal;
${COMMON}
void main() {
  float r = length(vLocal);
  float dens = ringDensity(r);
  if (dens < 0.004) discard;
  // The planet's shadow across the rings.
  vec3 oc = uCenter - vPos;
  float t = dot(oc, uSunDir);
  float d2 = dot(oc, oc) - t * t;
  float R2 = uRadius * uRadius;
  float sh = t > 0.0 ? smoothstep(R2 * 0.94, R2 * 1.05, d2) : 1.0;
  vec3 V = pSafeN(cameraPosition - vPos, vec3(0.0, 0.0, 1.0));
  float sl = abs(dot(uRingN, uSunDir));
  float same = dot(uRingN, uSunDir) * dot(uRingN, V);
  float lit = (0.3 + 0.85 * sl) * (same >= 0.0 ? 1.0 : 0.4 + 0.4 * (1.0 - dens));
  float x = clamp((r - ${RING_IN.toFixed(3)}) / ${(RING_OUT - RING_IN).toFixed(3)}, 0.0, 1.0);
  vec3 tone = mix(vec3(0.62, 0.55, 0.47), vec3(0.8, 0.74, 0.64), smoothstep(0.3, 0.9, x));
  tone *= 0.85 + 0.3 * pNoise1(x * 90.0 + 3.0);
  tone = mix(tone, vec3(0.5, 0.52, 0.58), smoothstep(0.85, 1.0, x) * 0.5);
  vec3 col = tone * uSunColor * lit * sh;
  gl_FragColor = vec4(col, dens * 0.82);
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Halo around the limb: exponential falloff by the view ray's closest approach to the centre. */
const ATMO_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uCenter;
uniform float uRadius;
uniform vec3 uAtmo;
varying vec3 vPos;
${COMMON}
void main() {
  vec3 dir = pSafeN(vPos - cameraPosition, vec3(0.0, 0.0, -1.0));
  vec3 oc = uCenter - cameraPosition;
  float tca = dot(oc, dir);
  float b = sqrt(max(dot(oc, oc) - tca * tca, 0.0)) / uRadius;
  float g;
  if (b >= 1.0) g = exp(-(b - 1.0) * 24.0) * (1.0 - smoothstep(${(ATMO - 0.06).toFixed(3)}, ${ATMO.toFixed(3)}, b));
  else g = pow(clamp(b, 0.0, 1.0), 12.0) * 0.8;
  vec3 n = pSafeN(cameraPosition + dir * tca - uCenter, uSunDir);
  float lit = smoothstep(-0.3, 0.55, dot(n, uSunDir));
  gl_FragColor = vec4(uAtmo * g * lit, 1.0);
}
`;

const MOON_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vPos;
varying vec3 vObj;
void main() {
  vObj = position;
  vN = mat3(modelMatrix) * normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const MOON_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uSize;
varying vec3 vN;
varying vec3 vPos;
varying vec3 vObj;
${COMMON}
float mHash(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
float mNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mHash(i), mHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(mHash(i + vec3(0.0, 1.0, 0.0)), mHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(mHash(i + vec3(0.0, 0.0, 1.0)), mHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(mHash(i + vec3(0.0, 1.0, 1.0)), mHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
void main() {
  vec3 N = pSafeN(vN, vec3(0.0, 1.0, 0.0));
  vec3 p = vObj / uSize;
  float n = mNoise(p * 3.0) * 0.6 + mNoise(p * 7.0 + 4.0) * 0.4;
  float maria = smoothstep(0.45, 0.62, mNoise(p * 1.6 + 9.0));
  vec3 alb = vec3(0.56, 0.54, 0.52) * (0.75 + 0.45 * n) * (1.0 - 0.35 * maria);
  float ndl = dot(N, uSunDir);
  // Eclipsed when the planet sits between the moon and the sun.
  vec3 oc = uCenter - vPos;
  float t = dot(oc, uSunDir);
  float R2 = uRadius * uRadius;
  float sh = t > 0.0 ? smoothstep(R2 * 0.9, R2 * 1.08, dot(oc, oc) - t * t) : 1.0;
  vec3 col = alb * uSunColor * clamp(ndl, 0.0, 1.0) * 1.2 * sh;
  // Planetshine on the night side.
  col += alb * vec3(0.05, 0.04, 0.03) * clamp(dot(N, pSafeN(oc, uSunDir)), 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

const SUN_COLOR = new Color(1.0, 0.94, 0.86).multiplyScalar(0.62);
const ATMO_COLOR = new Color(0.42, 0.66, 1.0).multiplyScalar(0.55);
const MOON_SIZE = RADIUS * 0.11;
const Y_UP = new Vector3(0, 1, 0);

/**
 * The planet's orientation: local Y along the ring normal and local Z toward
 * the camera, so it looks the same (and the moon starts in the same spot)
 * whichever placement is in use.
 */
function planetFrame(dir: Vector3, n: Vector3, out: Quaternion, m: Matrix4, x: Vector3, z: Vector3): Quaternion {
  z.copy(dir).negate().addScaledVector(n, dir.dot(n));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1);
  z.normalize();
  x.crossVectors(n, z).normalize();
  m.makeBasis(x, n, z);
  return out.setFromRotationMatrix(m);
}

/**
 * The moon starts a little right of the planet and well in front of it as
 * seen from the default camera (the planet's frame is defined relative to
 * the view, so this holds on phones and wide screens alike), on an orbit
 * wider than the rings and tilted off their plane.
 */
const MOON = (() => {
  const q = planetFrame(WIDE_DIR, WIDE_N, new Quaternion(), new Matrix4(), new Vector3(), new Vector3()).invert();
  const at = viewDir(-25 + 13, 17 + 1).multiplyScalar(DIST - 36);
  const start = at.sub(WIDE_DIR.clone().multiplyScalar(DIST)).applyQuaternion(q);
  const along = new Vector3().crossVectors(Y_UP, start).normalize();
  const axis = new Vector3().crossVectors(start, along).normalize();
  return { start, axis };
})();

/**
 * The gas giant: a baked banded surface (with a great storm) on a slowly
 * turning sphere, lit by the sun with a soft terminator, limb darkening, the
 * rings' shadow and an atmospheric rim; a banded ring system that the planet
 * shadows; and a small cratered moon on a slow, slightly inclined orbit.
 */
export function Planet() {
  const gl = useThree((s) => s.gl);
  const lite = useMemo(isLite, []);

  const res = useBundle(() => {
    const sunDir = { value: SUN_DIR.clone() };
    const sunColor = { value: SUN_COLOR.clone() };
    const center = { value: new Vector3() };
    const radius = { value: RADIUS };
    const ringN = { value: WIDE_N.clone() };
    const atmo = { value: ATMO_COLOR.clone() };
    const map = new WebGLRenderTarget(lite ? 512 : 1024, lite ? 256 : 512, {
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
      depthBuffer: false,
    });
    const ringGeo = new RingGeometry(RADIUS * RING_IN, RADIUS * RING_OUT, lite ? 96 : 160, 1);
    return {
      map,
      bodyGeo: new SphereGeometry(RADIUS, lite ? 56 : 80, lite ? 36 : 56),
      ringGeo,
      atmoGeo: new SphereGeometry(RADIUS * ATMO, lite ? 40 : 64, lite ? 24 : 40),
      moonGeo: new SphereGeometry(MOON_SIZE, lite ? 24 : 36, lite ? 16 : 24),
      bake: new ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, depthTest: false, depthWrite: false }),
      bodyMat: new ShaderMaterial({
        vertexShader: BODY_VERT,
        fragmentShader: BODY_FRAG,
        uniforms: {
          uMap: { value: map.texture },
          uReady: { value: 0 },
          uSunDir: sunDir,
          uSunColor: sunColor,
          uCenter: center,
          uRadius: radius,
          uRingN: ringN,
          uAtmo: atmo,
          uTint: { value: new Color() },
          uTintAmt: { value: 0 },
        },
      }),
      ringMat: new ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: { uSunDir: sunDir, uSunColor: sunColor, uCenter: center, uRadius: radius, uRingN: ringN },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      }),
      atmoMat: new ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        uniforms: { uSunDir: sunDir, uCenter: center, uRadius: radius, uAtmo: atmo },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      moonMat: new ShaderMaterial({
        vertexShader: MOON_VERT,
        fragmentShader: MOON_FRAG,
        uniforms: { uSunDir: sunDir, uSunColor: sunColor, uCenter: center, uRadius: radius, uSize: { value: MOON_SIZE } },
      }),
    };
  }, [lite]);

  // Bake the surface once per renderer.
  useEffect(() => {
    const scene = new Scene();
    const quad = new PlaneGeometry(2, 2);
    const mesh = new Mesh(quad, res.bake);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prev = gl.getRenderTarget();
    gl.setRenderTarget(res.map);
    gl.render(scene, cam);
    gl.setRenderTarget(prev);
    quad.dispose();
    res.bodyMat.uniforms.uReady.value = 1;
  }, [gl, res]);

  const objs = useMemo(() => {
    const body = new Mesh(res.bodyGeo, res.bodyMat);
    const ring = new Mesh(res.ringGeo, res.ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = -44;
    const atmo = new Mesh(res.atmoGeo, res.atmoMat);
    atmo.renderOrder = -45;
    const moon = new Mesh(res.moonGeo, res.moonMat);
    for (const m of [body, ring, atmo, moon]) m.raycast = () => {};
    return { body, ring, atmo, moon };
  }, [res]);

  const group = useRef<Group>(null!);
  const sim = useMemo(
    () => ({ k: -1, dir: new Vector3(), n: new Vector3(), moonAng: 0, m: new Matrix4(), x: new Vector3(), z: new Vector3() }),
    [],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const { width, height } = state.size;
    const aspect = height > 0 ? width / height : 1;
    const goal = MathSmooth(0.62, 1.25, aspect);
    sim.k = sim.k < 0 ? goal : damp(sim.k, goal, 1.5, dt);
    sim.dir.copy(PORTRAIT_DIR).lerp(WIDE_DIR, sim.k).normalize();
    sim.n.copy(PORTRAIT_N).lerp(WIDE_N, sim.k).normalize();

    const g = group.current;
    const scale = PORTRAIT_SCALE + (1 - PORTRAIT_SCALE) * sim.k;
    g.position.copy(state.camera.position).addScaledVector(sim.dir, DIST);
    planetFrame(sim.dir, sim.n, g.quaternion, sim.m, sim.x, sim.z);
    g.scale.setScalar(scale);
    g.updateMatrixWorld();

    const u = res.bodyMat.uniforms;
    u.uRadius.value = RADIUS * scale;
    (u.uCenter.value as Vector3).copy(g.position);
    (u.uRingN.value as Vector3).copy(sim.n);
    (u.uTint.value as Color).copy(bus.tint);
    u.uTintAmt.value = bus.tintAmt;

    objs.body.rotation.y += dt * 0.012;
    sim.moonAng += dt * 0.01;
    objs.moon.position.copy(MOON.start).applyAxisAngle(MOON.axis, sim.moonAng);
    objs.moon.rotation.y = sim.moonAng * 2;
  });

  return (
    <group ref={group}>
      <primitive object={objs.body} />
      <primitive object={objs.atmo} />
      <primitive object={objs.ring} />
      <primitive object={objs.moon} />
    </group>
  );
}

function MathSmooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
