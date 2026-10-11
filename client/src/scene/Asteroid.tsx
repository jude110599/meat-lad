import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Vector3,
  Vector4,
  type Group,
} from 'three';
import { RESOURCE_DEFS, rng, surgeOn } from '@starforge/shared';
import { act } from '../net/actions';
import { onFx } from '../state/fx';
import { refs } from '../state/refs';
import { useGame } from '../state/store';
import { buildRock, crystalGeometry, crystalSites, pebbleGeometry, surfaceFrame } from './geometry';
import { Rigs } from './Rigs';
import { Scorches } from './Scorches';
import { Seams } from './Seams';
import { damp, glowTexture, hostNow, tapOk, useBundle, useLite } from './util';

/* ---------------- rock shader (injected into MeshStandardMaterial) ---------------- */

const MAX_SEAMS = 8;
const MAX_HITS = 4;

const ROCK_VERT_PARS = /* glsl */ `
attribute vec4 aRock;
varying vec3 vRockPos;
varying vec4 vRock;
`;

const ROCK_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform vec3 uHeatColor;
uniform float uRes;
uniform vec3 uVeinColor;
uniform vec4 uSeams[${MAX_SEAMS}];
uniform vec4 uHits[${MAX_HITS}];
varying vec3 vRockPos;
varying vec4 vRock;
float rkHash(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 rkHash3(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}
float rkNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(rkHash(i), rkHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(rkHash(i + vec3(0.0, 1.0, 0.0)), rkHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(rkHash(i + vec3(0.0, 0.0, 1.0)), rkHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(rkHash(i + vec3(0.0, 1.0, 1.0)), rkHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
/* Distance to the nearest Voronoi cell wall (F2 - F1), in cell units: a cracked-crust network. */
float rkEdge(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d1 = 9.0;
  float d2 = 9.0;
#ifdef ROCK_LITE
  vec3 b = step(0.5, f) - 1.0;
  for (int z = 0; z < 2; z++)
  for (int y = 0; y < 2; y++)
  for (int x = 0; x < 2; x++) {
    vec3 g = b + vec3(float(x), float(y), float(z));
    vec3 r = g + 0.2 + 0.6 * rkHash3(i + g) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
#else
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 r = g + 0.1 + 0.8 * rkHash3(i + g) - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
#endif
  return sqrt(max(d2, 0.0)) - sqrt(max(d1, 0.0));
}
vec3 rkSafeNorm(vec3 v, vec3 fb) {
  float l2 = dot(v, v);
  return l2 > 1e-20 ? v * inversesqrt(l2) : fb;
}
`;

/** Per-pixel detail shared by the later stages: grain, molten cracks, seam glow. */
const ROCK_COLOR = /* glsl */ `
vec3 rkP = vRockPos;
vec3 rkDir = rkSafeNorm(rkP, vec3(0.0, 1.0, 0.0));
float rkAo = clamp(vRock.x, 0.0, 1.0);
float rkDust = clamp(vRock.y, 0.0, 1.0);
float rkVein = clamp(vRock.z, 0.0, 1.0);
float rkIron = clamp(vRock.w, 0.0, 1.0);
float rkN1 = rkNoise(rkP * 4.7);
float rkN2 = rkNoise(rkP * 12.3 + 7.1);
#ifdef ROCK_LITE
float rkN3 = 0.5;
#else
float rkN3 = rkNoise(rkP * 29.0 + 3.7);
#endif
float rkSeam = 0.0;
for (int i = 0; i < ${MAX_SEAMS}; i++) {
  vec4 s = uSeams[i];
  rkSeam = max(rkSeam, smoothstep(0.87, 0.985, dot(rkDir, s.xyz)) * s.w);
}
float rkVeinAmt = smoothstep(0.2, 0.6, max(rkVein, rkSeam * 0.9));
// Cracked crust: Voronoi walls, a little warped, live (glowing) in patches.
float rkE = rkEdge(rkP * 2.7 + vec3(rkN1 * 0.4));
float rkEw = fwidth(rkE);
float rkWidth = 0.03 + 0.05 * rkN2;
float rkLine = 1.0 - smoothstep(rkWidth * 0.35, rkWidth + rkEw * 1.5, rkE);
float rkCrack = rkLine * rkVeinAmt;
float rkLive = smoothstep(0.32, 0.55, rkN1 + 0.3 * rkSeam);
float rkLip = (1.0 - smoothstep(0.0, rkWidth * 3.0 + rkEw * 2.0, rkE)) * rkVeinAmt;
float rkGrain = rkN2 * 0.6 + rkN3 * 0.4;
diffuseColor.rgb *= 0.74 + 0.5 * rkGrain;
// Scorched crust around the veins, charred lips along the cracks.
diffuseColor.rgb *= (1.0 - 0.35 * rkVeinAmt) * (1.0 - 0.6 * rkLip);
// Mica flecks: glossy specks that only show when they catch the light.
#ifdef ROCK_LITE
float rkFleck = 0.0;
#else
float rkFleck = step(0.982, rkHash(floor(rkP * 60.0))) * (1.0 - rkDust) * (1.0 - rkLip);
#endif
float rockRough = clamp(0.92 - rkIron * 0.3 - rkFleck * 0.62 + rkDust * 0.06, 0.26, 1.0);
float rockMetal = clamp(rkIron * 0.45, 0.0, 1.0);
`;

/** Bump from the procedural height, using screen-space derivatives (scale-invariant form). */
const ROCK_NORMAL = /* glsl */ `
{
  float rq = 2.0 * rkN2 - 1.0;
  float ridge = 1.0 - sqrt(max(rq * rq + 0.015, 0.0));
  float h = (rkN1 * 0.52 + ridge * 0.34 + rkN3 * 0.14) * 0.042 - rkLip * 0.005 - rkCrack * 0.012;
  vec3 pos = -vViewPosition;
  vec3 sX = dFdx(pos) * 64.0;
  vec3 sY = dFdy(pos) * 64.0;
  vec2 dH = vec2(dFdx(h), dFdy(h)) * 64.0;
  vec3 r1 = cross(sY, normal);
  vec3 r2 = cross(normal, sX);
  float det = dot(sX, r1);
  vec3 grad = (det < 0.0 ? -1.0 : 1.0) * (dH.x * r1 + dH.y * r2);
  normal = rkSafeNorm(abs(det) * normal - grad, normal);
  // The deep shading relief can tilt a normal away from the camera in a
  // fold; keep it at least grazing so the rim light doesn't paint the crease.
  vec3 toEye = rkSafeNorm(vViewPosition, vec3(0.0, 0.0, 1.0));
  normal = rkSafeNorm(normal + toEye * max(0.0, 0.12 - dot(normal, toEye)), normal);
}
`;

const ROCK_EMISSIVE = /* glsl */ `
{
  vec3 gN = rkSafeNorm(vNormal, vec3(0.0, 0.0, 1.0));
  vec3 vv = rkSafeNorm(vViewPosition, vec3(0.0, 0.0, 1.0));
  float fr = 1.0 - clamp(dot(gN, vv), 0.0, 1.0);
  float rim = fr * fr * fr;
  float pulse = 0.5 + 0.5 * sin(uTime * 1.4 - dot(rkP, vec3(1.3, 0.8, -1.1)) * 1.6 + rkN1 * 5.0);
  float heat = max(uHeat, 0.0);
  float glowLine = rkCrack * rkLive;
  vec3 lava = mix(vec3(0.9, 0.15, 0.02), vec3(1.0, 0.5, 0.11), rkLine) + vec3(1.0, 0.82, 0.5) * (rkLine * rkLine * rkLine) * 0.45 * min(heat, 1.5);
  vec3 em = lava * glowLine * (0.45 + 0.55 * pulse + rkSeam * 0.4) * (1.0 + heat * 1.5);
  // Ember glow soaking into the crust around live cracks.
  float halo = exp(-rkE * 8.0) * rkVeinAmt * rkLive;
  em += vec3(0.85, 0.2, 0.03) * halo * (0.03 + 0.03 * pulse + heat * 0.16);
  // Ore seams warm the rock around them.
  em += uVeinColor * rkSeam * rkSeam * (0.035 + 0.035 * pulse);
  // Impact hot spots.
  vec3 hot = vec3(0.0);
  for (int i = 0; i < ${MAX_HITS}; i++) {
    vec4 hh = uHits[i];
    vec3 dd = rkP - hh.xyz;
    float d2 = dot(dd, dd);
    hot += vec3(1.0, 0.5, 0.18) * hh.w * (exp(-d2 * 90.0) * 1.0 + exp(-d2 * 12.0) * 0.1);
  }
  em += min(hot, vec3(2.5));
  // Rim: faint dusty blue at rest, orange-red with tap heat, cyan in a surge.
  em += vec3(0.03, 0.045, 0.085) * rim;
  float rim6 = rim * rim;
  em += uHeatColor * heat * (rim * 0.3 + rim6 * 0.9) * (1.0 - 0.5 * uRes);
  em += vec3(0.2, 0.9, 1.0) * uRes * (rim * 0.25 + rim6 * 1.3 + glowLine * 0.5);
  totalEmissiveRadiance += em;
}
`;

const ROCK_AO = /* glsl */ `
reflectedLight.indirectDiffuse *= rkAo;
reflectedLight.directDiffuse *= mix(1.0, rkAo, 0.5);
reflectedLight.indirectSpecular *= rkAo;
`;

type RockUniforms = {
  uTime: { value: number };
  uHeat: { value: number };
  uHeatColor: { value: Color };
  uRes: { value: number };
  uVeinColor: { value: Color };
  uSeams: { value: Vector4[] };
  uHits: { value: Vector4[] };
};

function makeRockMaterial(lite: boolean, uniforms: RockUniforms): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.05 });
  if (lite) mat.defines = { ...mat.defines, ROCK_LITE: '' };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${ROCK_VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockPos = position;\nvRock = aRock;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${ROCK_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${ROCK_COLOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rockRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = rockMetal;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${ROCK_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${ROCK_EMISSIVE}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${ROCK_AO}`);
  };
  mat.customProgramCacheKey = () => (lite ? 'sf-rock-lite' : 'sf-rock');
  return mat;
}

/* ---------------- tuning ---------------- */

const ORANGE = new Color('#ff8a2a');
const RED = new Color('#ff2a12');
const CYAN = new Color('#45e6ff');
const ORE = new Color(RESOURCE_DEFS.ore.color);
const Y_UP = new Vector3(0, 1, 0);
/** Heat each of my strikes adds, and how fast it bleeds off (per second). */
const HEAT_PER_TAP = 0.065;
const HEAT_COOL = 0.9;

/**
 * The spinning rock. `refs.rock` is the spin group (seam directions live in
 * its local space). Inside it, three nested groups squash the rock along the
 * direction of the latest impact (rotate in, scale, rotate back), so seams,
 * rigs, crystals and scorch marks squash with the surface.
 *
 * The surface is a custom MeshStandardMaterial: baked per-vertex colour and
 * occlusion, procedural grain and bump, molten cracks that pulse and flare
 * with tap heat, ore glow around every seam, a hot spot where each strike
 * lands and a thin fresnel rim that warms with heat and turns cyan in a
 * resonance surge. A soft halo behind the rock glows with the same heat.
 */
export function Asteroid() {
  const seed = useGame((s) => s.s?.seed ?? 1);
  const lite = useLite();
  const geo = useBundle(() => buildRock(seed, lite), [seed, lite]);

  const uniforms = useMemo<RockUniforms>(
    () => ({
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uHeatColor: { value: ORANGE.clone() },
      uRes: { value: 0 },
      uVeinColor: { value: ORE.clone() },
      uSeams: { value: Array.from({ length: MAX_SEAMS }, () => new Vector4()) },
      uHits: { value: Array.from({ length: MAX_HITS }, () => new Vector4()) },
    }),
    [],
  );
  const res = useBundle(
    () => ({
      rockMat: makeRockMaterial(lite, uniforms),
      halo: new SpriteMaterial({ map: glowTexture(), color: new Color(0, 0, 0), blending: AdditiveBlending, depthWrite: false, transparent: true }),
    }),
    [lite, uniforms],
  );
  const halo = useMemo(() => {
    const s = new Sprite(res.halo);
    s.scale.setScalar(9.5);
    s.renderOrder = 1;
    s.visible = false;
    return s;
  }, [res]);

  const spin = useRef<Group>(null!);
  const tilt = useRef<Group>(null!);
  const squash = useRef<Group>(null!);
  const inner = useRef<Group>(null!);
  const sim = useMemo(
    () => ({
      x: 0,
      v: 0,
      taps: 0,
      heat: 0,
      hot: 0,
      res: 0,
      axis: new Vector3(0, 1, 0),
      q: new Quaternion(),
      qGoal: new Quaternion(),
      hitHead: 0,
      hitPos: Array.from({ length: MAX_HITS }, () => new Vector3()),
      hitBirth: new Float32Array(MAX_HITS).fill(-100),
      hitHot: new Float32Array(MAX_HITS),
      time: 0,
    }),
    [],
  );
  const tmp = useMemo(() => ({ n: new Vector3(), inv: new Matrix4(), qi: new Quaternion(), c: new Color() }), []);

  useLayoutEffect(() => {
    const g = spin.current;
    refs.rock = g;
    return () => {
      if (refs.rock === g) refs.rock = null;
    };
  }, []);

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind === 'burst' && e.at.lengthSq() < 10.5) {
          // Only bursts on the rock thunk it (a caught comet bursts further out).
          sim.v -= Math.min(0.75, 0.22 + e.count * 0.012);
          const g = spin.current;
          if (g && e.normal.lengthSq() > 1e-6) {
            tmp.qi.copy(g.quaternion).invert();
            sim.axis.copy(e.normal).applyQuaternion(tmp.qi).normalize();
          }
        } else if (e.kind === 'laser' && e.from === useGame.getState().me) {
          sim.taps = Math.min(1, sim.taps + HEAT_PER_TAP);
        } else if (e.kind === 'scorch') {
          const g = inner.current;
          if (!g) return;
          g.updateWorldMatrix(true, false);
          tmp.inv.copy(g.matrixWorld).invert();
          const i = sim.hitHead;
          sim.hitHead = (i + 1) % MAX_HITS;
          sim.hitPos[i].copy(e.at).applyMatrix4(tmp.inv);
          sim.hitBirth[i] = sim.time;
          sim.hitHot[i] = e.hot ? 1 : 0;
        }
      }),
    [sim, tmp],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    sim.time = t;
    const g = spin.current;
    g.rotation.y += dt * 0.06;
    g.rotation.x += dt * 0.015;

    // Damped spring: a squash along the impact direction that rebounds with a wobble.
    sim.v += (-260 * sim.x - 11 * sim.v) * dt;
    sim.x = Math.max(-0.07, Math.min(0.05, sim.x + sim.v * dt));
    sim.qGoal.setFromUnitVectors(Y_UP, sim.axis);
    sim.q.slerp(sim.qGoal, 1 - Math.exp(-14 * dt));
    tilt.current.quaternion.copy(sim.q);
    inner.current.quaternion.copy(sim.q).invert();
    squash.current.scale.set(1 - sim.x * 0.55, 1 + sim.x * 1.15, 1 - sim.x * 0.55);

    const s = useGame.getState().s;
    sim.taps = Math.max(0, sim.taps - sim.taps * HEAT_COOL * dt - 0.01 * dt);
    sim.heat = damp(sim.heat, sim.taps, 7, dt);
    sim.hot = damp(sim.hot, sim.taps > 0.7 ? 1 : 0, 4, dt);
    sim.res = damp(sim.res, s && surgeOn(s, hostNow()) ? 1 : 0, 3, dt);

    const u = uniforms;
    u.uTime.value = t;
    const heat = Math.pow(Math.max(0, sim.heat), 1.3) * (1.2 + sim.hot * 1.1);
    u.uHeat.value = heat;
    u.uHeatColor.value.copy(ORANGE).lerp(RED, sim.hot);
    u.uRes.value = sim.res;

    // Seams: direction and health, so the rock glows around each one.
    const seams = s?.seams;
    for (let i = 0; i < MAX_SEAMS; i++) {
      const v = u.uSeams.value[i];
      const sm = seams && i < seams.length ? seams[i] : undefined;
      if (!sm) {
        v.set(0, 1, 0, 0);
        continue;
      }
      const l = Math.hypot(sm.dir[0], sm.dir[1], sm.dir[2]);
      if (!(l > 1e-6)) {
        v.set(0, 1, 0, 0);
        continue;
      }
      const health = sm.maxHp > 0 ? Math.max(0, Math.min(1, sm.hp / sm.maxHp)) : 1;
      v.set(sm.dir[0] / l, sm.dir[1] / l, sm.dir[2] / l, 0.55 + 0.45 * health);
    }

    for (let i = 0; i < MAX_HITS; i++) {
      const age = t - sim.hitBirth[i];
      const w = age >= 0 && age < 2 ? Math.exp(-age * 3.2) * (1 + sim.hitHot[i] * 0.8) : 0;
      const p = sim.hitPos[i];
      u.uHits.value[i].set(p.x, p.y, p.z, w);
    }

    // Halo behind the rock: heat orange, surge cyan.
    const hk = Math.min(0.8, heat * 0.3);
    res.halo.color.copy(u.uHeatColor.value).multiplyScalar(hk).add(tmp.c.copy(CYAN).multiplyScalar(sim.res * 0.35));
    halo.visible = hk + sim.res > 0.01;
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!tapOk(e.nativeEvent)) return;
    if (e.face) tmp.n.copy(e.face.normal).transformDirection(e.object.matrixWorld);
    else tmp.n.copy(e.point).normalize();
    act.strike(null, e.point, tmp.n);
  };

  return (
    <>
      <primitive object={halo} />
      <group ref={spin}>
        <group ref={tilt}>
          <group ref={squash}>
            <group ref={inner}>
              <mesh geometry={geo.rock} material={res.rockMat} />
              <mesh geometry={geo.hit} visible={false} onPointerDown={onDown} />
              <Crystals seed={seed} lite={lite} />
              <Seams />
              <Rigs />
              <Scorches parent={inner} />
            </group>
          </group>
        </group>
      </group>
      <Debris lite={lite} />
    </>
  );
}

/* ---------------- decorative crystals ---------------- */

const CRYSTAL_TINTS = [new Color('#9468ff'), new Color('#b48cff'), new Color('#7a55f0'), new Color('#ddd0ff')];

const CRYSTAL_FRAG_PARS = /* glsl */ `
uniform float uTime;
`;
const CRYSTAL_EMISSIVE = /* glsl */ `
{
  vec3 gN = normal * inversesqrt(max(dot(normal, normal), 1e-12));
  vec3 vv = vViewPosition * inversesqrt(max(dot(vViewPosition, vViewPosition), 1e-12));
  float fr = 1.0 - clamp(abs(dot(gN, vv)), 0.0, 1.0);
  vec3 tint = vec3(1.0);
  #ifdef USE_COLOR
  tint = vColor.rgb;
  #endif
  float tw = 0.75 + 0.25 * sin(uTime * 2.1 + dot(vViewPosition, vec3(3.1, 1.7, 2.3)));
  totalEmissiveRadiance += tint * (0.10 + fr * fr * 0.9) * tw;
}
`;

/**
 * Clusters of violet mineral crystals on the rock: flat-shaded and glossy,
 * so their facets flash as the rock turns, with a soft inner glow at their
 * edges. One instanced draw.
 */
function Crystals({ seed, lite }: { seed: number; lite: boolean }) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const res = useBundle(() => {
    const mat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.12, metalness: 0.25 });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${CRYSTAL_FRAG_PARS}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${CRYSTAL_EMISSIVE}`);
    };
    mat.customProgramCacheKey = () => 'sf-crystal';
    return { geo: crystalGeometry(), mat };
  }, [uniforms]);

  const mesh = useMemo(() => {
    const clusters = crystalSites(seed, lite ? 6 : 9);
    const per = lite ? 4 : 5;
    const m = new InstancedMesh(res.geo, res.mat, clusters.length * per);
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(clusters.length * per * 3), 3);
    const r = rng((seed * 31337) >>> 0);
    const p = new Vector3();
    const n = new Vector3();
    const d = new Vector3();
    const t1 = new Vector3();
    const q = new Quaternion();
    const q2 = new Quaternion();
    const s = new Vector3();
    const mtx = new Matrix4();
    const c = new Color();
    let k = 0;
    for (const site of clusters) {
      const tint = CRYSTAL_TINTS[Math.floor(r() * CRYSTAL_TINTS.length)];
      for (let j = 0; j < per; j++) {
        d.set(site[0], site[1], site[2]);
        if (j > 0) {
          t1.set(r() - 0.5, r() - 0.5, r() - 0.5).cross(d).normalize();
          d.addScaledVector(t1, 0.03 + r() * 0.05).normalize();
        }
        surfaceFrame(d, seed, p, n);
        p.addScaledVector(n, -0.025);
        q.setFromUnitVectors(Y_UP, n);
        // Lean each shard outward a little, at its own angle.
        t1.set(r() - 0.5, 0, r() - 0.5);
        if (t1.lengthSq() < 1e-4) t1.set(1, 0, 0);
        q2.setFromAxisAngle(t1.normalize(), j === 0 ? r() * 0.2 : 0.35 + r() * 0.5);
        q.multiply(q2);
        const w = j === 0 ? 0.07 + r() * 0.03 : 0.035 + r() * 0.03;
        const h = j === 0 ? 0.26 + r() * 0.12 : 0.1 + r() * 0.14;
        mtx.compose(p, q, s.set(w, h, w));
        m.setMatrixAt(k, mtx);
        m.setColorAt(k, c.copy(tint).multiplyScalar(0.75 + r() * 0.35));
        k++;
      }
    }
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    return m;
  }, [seed, lite, res]);
  useEffect(() => () => mesh.dispose(), [mesh]);

  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <primitive object={mesh} />;
}

/* ---------------- debris belt ---------------- */

const DEBRIS_TONES = [new Color('#5a4a3e'), new Color('#463f3b'), new Color('#6b4a33'), new Color('#3c3a40'), new Color('#7a6650')];

/**
 * A sparse belt of small tumbling rocks on a tilted ring around the
 * asteroid, between the drone orbits. One instanced draw; tumbling and
 * orbiting are recomputed per frame into preallocated matrices.
 */
function Debris({ lite }: { lite: boolean }) {
  const count = lite ? 22 : 44;
  const res = useBundle(
    () => ({
      geo: pebbleGeometry(911),
      mat: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.88, metalness: 0.06 }),
    }),
    [],
  );
  const sys = useMemo(() => {
    const mesh = new InstancedMesh(res.geo, res.mat, count);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(count * 3), 3);
    const r = rng(4242);
    const c = new Color();
    const rad = new Float32Array(count);
    const ang = new Float32Array(count);
    const y = new Float32Array(count);
    const speed = new Float32Array(count);
    const size = new Float32Array(count);
    const spin = new Float32Array(count);
    const axes: Vector3[] = [];
    for (let i = 0; i < count; i++) {
      rad[i] = 3.9 + r() * 1.5 + (r() < 0.2 ? r() * 0.8 : 0);
      ang[i] = r() * Math.PI * 2;
      y[i] = (r() - 0.5) * 0.35 * (rad[i] - 3.4);
      speed[i] = 0.05 * Math.pow(4.4 / rad[i], 1.5) * (0.85 + r() * 0.3);
      size[i] = 0.025 + Math.pow(r(), 2.6) * 0.1;
      spin[i] = 0.3 + r() * 1.4;
      axes.push(new Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize());
      mesh.setColorAt(i, c.copy(DEBRIS_TONES[Math.floor(r() * DEBRIS_TONES.length)]).multiplyScalar(0.8 + r() * 0.4));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return { mesh, rad, ang, y, speed, size, spin, axes };
  }, [res, count]);
  useEffect(() => () => sys.mesh.dispose(), [sys]);

  const tmp = useMemo(() => ({ m: new Matrix4(), p: new Vector3(), q: new Quaternion(), s: new Vector3() }), []);
  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const { mesh, rad, ang, y, speed, size, spin, axes } = sys;
    for (let i = 0; i < count; i++) {
      ang[i] += speed[i] * dt;
      tmp.p.set(Math.cos(ang[i]) * rad[i], y[i], Math.sin(ang[i]) * rad[i]);
      tmp.q.setFromAxisAngle(axes[i], t * spin[i] + i);
      tmp.m.compose(tmp.p, tmp.q, tmp.s.setScalar(size[i]));
      mesh.setMatrixAt(i, tmp.m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group rotation={[0.38, 0.4, -0.22]}>
      <primitive object={sys.mesh} />
    </group>
  );
}
