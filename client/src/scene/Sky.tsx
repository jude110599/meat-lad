import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  CubeCamera,
  LinearFilter,
  Mesh,
  Points,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLCubeRenderTarget,
  type Group,
} from 'three';
import { rng } from '@starforge/shared';
import { bus } from './bus';
import { SUN_DIR } from './Lights';
import { Planet } from './Planet';
import { glowTexture, isLite, useBundle } from './util';

/* ---------------- nebula: baked once into a cube map ---------------- */

const BAKE_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BAKE_FRAG = /* glsl */ `
uniform float uStars;
varying vec3 vDir;
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
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
    p = p * 2.07 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
vec3 safeN(vec3 v, vec3 fb) {
  float l2 = dot(v, v);
  return l2 > 1e-20 ? v * inversesqrt(l2) : fb;
}
/* A small spiral galaxy around direction c. */
vec3 galaxy(vec3 d, vec3 c, float size, float tilt, float ang, vec3 tint) {
  if (dot(d, c) < 0.96) return vec3(0.0);
  vec3 t1 = safeN(cross(c, vec3(0.13, 1.0, 0.07)), vec3(1.0, 0.0, 0.0));
  vec3 t2 = cross(t1, c);
  vec2 p = vec2(dot(d, t1), dot(d, t2)) / size;
  float cs = cos(ang);
  float sn = sin(ang);
  p = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
  p.y /= tilt;
  float r = length(p);
  float th = r > 1e-3 ? atan(p.y, p.x) : 0.0;
  float arms = 0.5 + 0.5 * sin(2.0 * th - log(r + 0.04) * 4.5);
  float disk = exp(-r * 3.4) * (0.35 + 0.65 * arms * smoothstep(0.04, 0.3, r));
  float core = exp(-r * r * 70.0);
  return tint * disk * 0.12 + vec3(1.0, 0.9, 0.75) * core * 0.35;
}
vec3 starfield(vec3 d, float band) {
  vec3 s = vec3(0.0);
  for (int l = 0; l < 2; l++) {
    float sc = l == 0 ? 150.0 : 310.0;
    vec3 g = d * sc;
    vec3 cell = floor(g);
    if (hash13(cell * 1.7 + float(l) * 31.0) > (l == 0 ? 0.87 : 0.9 - 0.06 * band)) {
      vec3 h = hash33(cell + float(l) * 17.0);
      vec3 dd = g - (cell + 0.25 + 0.5 * h);
      float b = exp(-dot(dd, dd) * 10.0) * pow(h.z, 3.0) * (l == 0 ? 0.55 : 0.22);
      s += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.84, 0.66), h.x) * b;
    }
  }
  return s * (0.55 + 0.8 * band);
}
void main() {
  vec3 d = safeN(vDir, vec3(0.0, 0.0, 1.0));
  float gb = dot(d, normalize(vec3(0.25, 1.0, -0.3)));
  float band = exp(-gb * gb * 5.0);
  vec3 p = d * 2.0;
  float w = fbm(p * 1.3);
  vec3 q = p + vec3(w, fbm(p * 1.1 + 5.2), fbm(p * 0.9 + 9.1)) * 1.5;
  float n = fbm(q);
  float n2 = fbm(q * 2.3 + 3.0);
  float fil = 1.0 - abs(2.0 * fbm(q * 3.1 + 7.0) - 1.0);
  fil = fil * fil * fil * fil;
  float hue = fbm(p * 0.55 + 11.0);

  vec3 deep = vec3(0.003, 0.0035, 0.012);
  vec3 indigo = vec3(0.016, 0.024, 0.09);
  vec3 violet = vec3(0.07, 0.02, 0.12);
  vec3 magenta = vec3(0.15, 0.022, 0.085);
  vec3 teal = vec3(0.0, 0.08, 0.1);
  vec3 gold = vec3(0.24, 0.12, 0.035);

  vec3 col = deep;
  float dens = smoothstep(0.38, 0.78, n);
  col += indigo * smoothstep(0.3, 0.75, n) * (0.7 + 0.8 * band);
  vec3 em = mix(magenta, teal, smoothstep(0.4, 0.62, hue));
  em = mix(em, violet, smoothstep(0.45, 0.7, n2) * 0.5);
  col += em * dens * (0.35 + 1.1 * band) * (0.55 + 0.9 * fil);
  col += gold * pow(max(dens * n2, 0.0), 3.0) * 1.6 * band;
  // Dark dust lanes across the bright band.
  float dust = smoothstep(0.5, 0.75, fbm(q * 1.8 + 2.0)) * band;
  col *= 1.0 - 0.72 * dust;
  // Unresolved starlight along the band.
  col += vec3(0.032, 0.03, 0.042) * band * (0.3 + 0.7 * n2) * (1.0 - 0.6 * dust);
  // Distant galaxies.
  col += galaxy(d, normalize(vec3(0.3, 0.05, -0.95)), 0.022, 0.42, 0.5, vec3(0.75, 0.8, 1.0));
  col += galaxy(d, normalize(vec3(0.12, -0.48, -0.87)), 0.016, 0.6, -0.9, vec3(1.0, 0.82, 0.9));
  col += galaxy(d, normalize(vec3(0.85, 0.2, 0.48)), 0.024, 0.35, 1.9, vec3(0.8, 0.85, 1.0));
  col += galaxy(d, normalize(vec3(-0.8, -0.25, 0.55)), 0.018, 0.7, 0.3, vec3(1.0, 0.85, 0.75));
  col += galaxy(d, normalize(vec3(-0.6, 0.55, -0.58)), 0.014, 0.5, 2.6, vec3(0.85, 0.9, 1.0));
  if (uStars > 0.5) col += starfield(d, band);
  // Stored square-rooted so 8-bit texels keep precision in the darks.
  gl_FragColor = vec4(sqrt(max(col, vec3(0.0))), 1.0);
}
`;

const SKY_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vLocal = position;
  vWorld = mat3(modelMatrix) * position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAG = /* glsl */ `
uniform samplerCube uNebula;
uniform float uReady;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uTint;
uniform float uTintAmt;
uniform float uSurge;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vec3 enc = textureCube(uNebula, vLocal).rgb;
  vec3 col = mix(vec3(0.0035, 0.004, 0.014), enc * enc, uReady);
  vec3 d = vWorld * inversesqrt(max(dot(vWorld, vWorld), 1e-12));
  float sd = max(dot(d, uSunDir), 0.0);
  float sd2 = sd * sd;
  float sd8 = sd2 * sd2 * sd2 * sd2;
  col += uSunColor * (sd2 * sd2 * sd2 * 0.05 + sd8 * sd8 * sd8 * sd8 * sd8 * 0.12);
  col += uTint * 0.07 * uTintAmt;
  // Resonance surge: a faint cyan wash, strongest in the brighter nebula.
  col += vec3(0.0, 0.03, 0.04) * uSurge * (0.4 + 6.0 * dot(enc * enc, vec3(0.33)));
  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------------- stars: one twinkling point cloud ---------------- */

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
attribute vec2 aTw;
uniform float uTime;
uniform float uPx;
varying vec3 vCol;
varying float vPs;
varying float vSig;
varying float vBig;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float tw = 0.5 + 0.5 * sin(uTime * aTw.y + aTw.x) * sin(uTime * aTw.y * 0.37 + aTw.x * 2.3);
  vBig = smoothstep(2.1, 3.4, aSize);
  vSig = max(0.55, aSize * 0.42) * max(uPx, 0.5);
  vPs = vSig * mix(6.0, 18.0, vBig);
  gl_PointSize = vPs;
  vCol = aColor * mix(1.0, 0.45 + 0.75 * tw, 0.75);
}
`;

const STAR_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vPs;
varying float vSig;
varying float vBig;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  vec2 px = c * (vPs * 0.5);
  float d2 = dot(px, px);
  float s2 = 2.0 * vSig * vSig;
  float core = exp(-d2 / s2);
  float halo = exp(-d2 / (s2 * 16.0)) * 0.07 * vBig;
  float ax = abs(px.x);
  float ay = abs(px.y);
  float spikes = vBig * (exp(-ax * 1.6 - ay / (vSig * 4.0)) + exp(-ay * 1.6 - ax / (vSig * 4.0))) * 0.3;
  float a = (core + halo + spikes) * (1.0 - smoothstep(0.75, 1.0, length(c)));
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a, 1.0);
}
`;

const STAR_TINTS = ['#9db4ff', '#c4d2ff', '#f2f4ff', '#fff4e6', '#ffe0b5', '#ffc48a'].map((c) => new Color(c));
const BAND_N = new Vector3(0.25, 1, -0.3).normalize();
const STAR_R = 200;

function starGeometry(count: number): BufferGeometry {
  const r = rng(90210);
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const col = new Float32Array(count * 3);
  const tw = new Float32Array(count * 2);
  const v = new Vector3();
  const c = new Color();
  for (let i = 0; i < count; i++) {
    const z = r() * 2 - 1;
    const t = r() * Math.PI * 2;
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    v.set(s * Math.cos(t), s * Math.sin(t), z);
    // Nearly half of them crowd toward the galactic band.
    if (r() < 0.45) v.addScaledVector(BAND_N, -v.dot(BAND_N) * (0.55 + r() * 0.4)).normalize();
    v.multiplyScalar(STAR_R).toArray(pos, i * 3);
    const m = Math.pow(r(), 3.2);
    size[i] = 0.55 + m * 3.3;
    c.copy(STAR_TINTS[Math.min(STAR_TINTS.length - 1, Math.floor(r() * STAR_TINTS.length))]).multiplyScalar(0.28 + m * 1.5);
    c.toArray(col, i * 3);
    tw[i * 2] = r() * Math.PI * 2;
    tw[i * 2 + 1] = 0.6 + r() * 2.2;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aSize', new BufferAttribute(size, 1));
  g.setAttribute('aColor', new BufferAttribute(col, 3));
  g.setAttribute('aTw', new BufferAttribute(tw, 2));
  return g;
}

const SUN_DIST = 190;
const SUN = new Color('#fff0d6');
const SCATTER = new Color('#ffcf9a');

/**
 * Backdrop: a domain-warped nebula (indigo, magenta, violet and teal clouds
 * with gold cores, dark dust lanes, faint unresolved stars and a few distant
 * galaxies) baked once into a cube map and drawn on an inverted sphere that
 * follows the camera and slowly drifts; a twinkling star field riding with
 * it; a distant sun along SUN_DIR (the key light's direction) and the
 * ringed gas giant (Planet). 'flash' pulses (bus.tint) and a resonance
 * surge (bus.surge) tint the nebula.
 */
export function Sky() {
  const gl = useThree((s) => s.gl);
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true, []);
  const lite = useMemo(isLite, []);

  const res = useBundle(
    () => ({
      geo: new SphereGeometry(260, 48, 24),
      cube: new WebGLCubeRenderTarget(coarse ? 512 : 1024, { generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter }),
      bake: new ShaderMaterial({
        vertexShader: BAKE_VERT,
        fragmentShader: BAKE_FRAG,
        uniforms: { uStars: { value: coarse ? 0 : 1 } },
        side: BackSide,
        depthWrite: false,
        depthTest: false,
      }),
      mat: new ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uNebula: { value: null },
          uReady: { value: 0 },
          uSunDir: { value: SUN_DIR.clone() },
          uSunColor: { value: SCATTER.clone() },
          uTint: { value: new Color() },
          uTintAmt: { value: 0 },
          uSurge: { value: 0 },
        },
        side: BackSide,
        depthWrite: false,
        depthTest: false,
      }),
      starGeo: starGeometry(lite ? 1300 : 2400),
      starMat: new ShaderMaterial({
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        uniforms: { uTime: { value: 0 }, uPx: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      core: new SpriteMaterial({ map: glowTexture(), color: SUN.clone().multiplyScalar(3.2), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
      halo: new SpriteMaterial({ map: glowTexture(), color: SUN.clone().multiplyScalar(0.9), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
      streak: new SpriteMaterial({ map: glowTexture(), color: SUN.clone().multiplyScalar(0.35), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    }),
    [coarse, lite],
  );

  // Bake the nebula once per renderer.
  useEffect(() => {
    const scene = new Scene();
    const mesh = new Mesh(res.geo, res.bake);
    mesh.scale.setScalar(0.4);
    scene.add(mesh);
    const cam = new CubeCamera(1, 500, res.cube);
    scene.add(cam);
    const prevTarget = gl.getRenderTarget();
    cam.update(gl, scene);
    gl.setRenderTarget(prevTarget);
    res.mat.uniforms.uNebula.value = res.cube.texture;
    res.mat.uniforms.uReady.value = 1;
  }, [gl, res]);

  const objs = useMemo(() => {
    const sky = new Mesh(res.geo, res.mat);
    sky.renderOrder = -100;
    sky.frustumCulled = false;
    const stars = new Points(res.starGeo, res.starMat);
    stars.renderOrder = -60;
    stars.frustumCulled = false;
    stars.raycast = () => {};
    sky.add(stars);
    const core = new Sprite(res.core);
    const halo = new Sprite(res.halo);
    const streak = new Sprite(res.streak);
    core.renderOrder = halo.renderOrder = streak.renderOrder = -50;
    core.scale.setScalar(11);
    halo.scale.setScalar(48);
    streak.scale.set(150, 3.2, 1);
    return { sky, core, halo, streak };
  }, [res]);

  const sunGroup = useRef<Group>(null!);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const cam = state.camera;

    // The sky rides with the camera (infinitely far) and drifts slowly.
    objs.sky.position.copy(cam.position);
    objs.sky.rotation.y += dt * 0.004;
    objs.sky.rotation.x = Math.sin(t * 0.01) * 0.08;
    const u = res.mat.uniforms;
    (u.uTint.value as Color).copy(bus.tint);
    u.uTintAmt.value = bus.tintAmt;
    u.uSurge.value = bus.surge;
    res.starMat.uniforms.uTime.value = t;
    res.starMat.uniforms.uPx.value = state.viewport.dpr;

    // Sun billboard at a fixed angular position.
    sunGroup.current.position.copy(cam.position).addScaledVector(SUN_DIR, SUN_DIST);
  });

  return (
    <>
      <primitive object={objs.sky} />
      <group ref={sunGroup}>
        <primitive object={objs.halo} />
        <primitive object={objs.streak} />
        <primitive object={objs.core} />
      </group>
      <Planet />
    </>
  );
}
