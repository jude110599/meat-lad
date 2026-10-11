import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  ShaderMaterial,
  Sprite,
  SpriteMaterial,
  Vector3,
  Vector4,
  type Group,
} from 'three';
import { ASTEROID_RADIUS, RESOURCE_DEFS, rng, surgeOn } from '@starforge/shared';
import { act } from '../net/actions';
import { onFx } from '../state/fx';
import { refs } from '../state/refs';
import { useGame } from '../state/store';
import { buildPlanet, pebbleGeometry, planetKind, shellGeometry } from './geometry';
import { SUN_DIR } from './Lights';
import { Rigs } from './Rigs';
import { Scorches } from './Scorches';
import { Seams } from './Seams';
import { damp, glowTexture, hostNow, tapOk, useBundle, useLite } from './util';

/*
 * The mined planet. A small near-spherical world on the shared surface
 * (flat seas at the base radius, continents and ridged mountains above it),
 * shaded per pixel: oceans with a sun glint, coasts, forests, deserts,
 * tundra, snowy peaks, impact craters and polar ice caps; or, on a molten
 * world, glowing lava seas with drifting crust, basalt continents and ash
 * caps. The night side goes dark and lights up with cities (or molten
 * fissures). A cloud layer drifts slowly over it and an atmosphere glows
 * around the limb, blue (or sulphur-orange), warming toward sunset at the
 * terminator.
 *
 * Mining feedback lives in the same shader: a glowing crack network opens
 * around every tap and lingers for a few seconds, seams glow and crack the
 * crust around them, tap heat lights up the molten veins under the crust and
 * warms the rim, and each strike leaves a hot spot. Clouds part over fresh
 * hits and seams so the action stays visible.
 */

const MAX_SEAMS = 8;
const MAX_HITS = 4;
/** Cloud layer and atmosphere shell, in planet radii. */
const CLOUD_R = 1.036;
const ATMO_R = 1.13;
/** Spin (rad/s) and axial tilt. The spin follows the host's clock, so every crewmate sees the same face. */
const SPIN = 0.045;
const CLOUD_SPIN = 0.012;
const TILT = new Quaternion().setFromEuler(new Euler(0.36, 0, 0.22));

const PLANET_VERT_PARS = /* glsl */ `
attribute vec4 aGeo;
attribute vec2 aMine;
varying vec3 vRockPos;
varying vec4 vGeo;
varying vec2 vMine;
`;

const NOISE = /* glsl */ `
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
vec3 rkSafeNorm(vec3 v, vec3 fb) {
  float l2 = dot(v, v);
  return l2 > 1e-20 ? v * inversesqrt(l2) : fb;
}
vec3 srgb(vec3 c) {
  return c * c * (c * 0.305306011 + 0.682171111) + 0.012522878;
}
`;

const PLANET_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform vec3 uHeatColor;
uniform float uRes;
uniform vec3 uVeinColor;
uniform vec3 uSunView;
uniform vec4 uSeams[${MAX_SEAMS}];
uniform vec4 uHits[${MAX_HITS}];
uniform vec4 uHitCrack;
varying vec3 vRockPos;
varying vec4 vGeo;
varying vec2 vMine;
${NOISE}
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
`;

/** Albedo, roughness and the mining-crack mask, per pixel. Declares values the later stages read. */
const PLANET_COLOR = /* glsl */ `
vec3 rkP = vRockPos;
vec3 rkDir = rkSafeNorm(rkP, vec3(0.0, 1.0, 0.0));
float rkLat = abs(rkDir.y);
float rkN1 = rkNoise(rkP * 2.3);
float rkN2 = rkNoise(rkP * 6.1 + 7.1);
#ifdef ROCK_LITE
float rkN3 = 0.5;
float rkN4 = 0.5;
#else
float rkN3 = rkNoise(rkP * 15.7 + 3.7);
float rkN4 = rkNoise(rkP * 43.0 + 1.9);
#endif
// Coastlines: the smooth per-vertex elevation, roughened per pixel.
float rkElev = vGeo.x + (rkN2 - 0.5) * 0.15 + (rkN3 - 0.5) * 0.07;
float rkAaE = fwidth(rkElev) + 1e-4;
float rkLand = smoothstep(-rkAaE, rkAaE, rkElev);
float rkRidge = clamp(vGeo.y, 0.0, 1.0);
float rkPit = clamp(vGeo.z, 0.0, 1.0);
float rkAo = clamp(vGeo.w, 0.0, 1.0);
float rkMoist = clamp(vMine.y + (rkN1 - 0.5) * 0.4, 0.0, 1.0);
// Polar caps (ragged edges) and snow on the high ranges.
float rkCapAt = 0.8 + (rkN1 - 0.5) * 0.14 + (rkN2 - 0.5) * 0.06;
float rkIce = smoothstep(rkCapAt - 0.02, rkCapAt + 0.02, rkLat);
float rkSnow = rkLand * smoothstep(0.62, 0.74, rkRidge * 0.85 + max(rkElev, 0.0) * 0.45 + rkLat * 0.3 + (rkN3 - 0.5) * 0.18);
rkIce = max(rkIce, rkSnow);
float rkTex = 0.82 + 0.36 * (rkN3 * 0.45 + rkN2 * 0.3 + rkN4 * 0.25);
vec3 rkCol;
float rkSea = (1.0 - rkLand) * (1.0 - rkIce);
#ifdef PLANET_MOLTEN
  vec3 basalt = mix(srgb(vec3(0.16, 0.13, 0.12)), srgb(vec3(0.27, 0.22, 0.19)), smoothstep(0.3, 0.7, rkMoist));
  vec3 ash = srgb(vec3(0.42, 0.39, 0.37));
  vec3 rust = srgb(vec3(0.42, 0.21, 0.12));
  vec3 ground = mix(basalt, rust, smoothstep(0.55, 0.8, rkN1) * 0.5);
  ground = mix(ground, ash, smoothstep(0.25, 0.7, rkRidge + max(rkElev, 0.0) * 0.3));
  ground *= rkTex;
  ground = mix(srgb(vec3(0.08, 0.06, 0.06)), ground, smoothstep(0.0, 0.05, rkElev));
  // Lava seas: dark cooling crust plates drifting on the melt.
  float rkCrust = smoothstep(0.42, 0.62, rkNoise(rkP * 3.4 + vec3(uTime * 0.015, 0.0, uTime * 0.01)) * 0.7 + rkN3 * 0.3);
  vec3 seaCol = mix(srgb(vec3(0.3, 0.07, 0.03)), srgb(vec3(0.12, 0.08, 0.07)), rkCrust);
  rkCol = mix(seaCol, ground, rkLand);
  rkCol = mix(rkCol, srgb(vec3(0.78, 0.76, 0.72)) * (0.9 + 0.1 * rkN2), rkIce);
#else
  float rkDepth = clamp(-rkElev, 0.0, 1.0);
  vec3 seaCol = mix(srgb(vec3(0.07, 0.36, 0.5)), srgb(vec3(0.02, 0.1, 0.25)), smoothstep(0.0, 0.4, rkDepth));
  seaCol = mix(seaCol, srgb(vec3(0.1, 0.5, 0.55)), (1.0 - smoothstep(0.0, 0.05, rkDepth)) * 0.55);
  vec3 desert = srgb(vec3(0.76, 0.62, 0.4));
  vec3 grass = srgb(vec3(0.3, 0.46, 0.2));
  vec3 forest = srgb(vec3(0.15, 0.3, 0.13));
  vec3 tundra = srgb(vec3(0.42, 0.42, 0.33));
  vec3 rock = srgb(vec3(0.42, 0.35, 0.29));
  vec3 hiRock = srgb(vec3(0.55, 0.52, 0.5));
  vec3 low = mix(desert, grass, smoothstep(0.3, 0.5, rkMoist));
  low = mix(low, forest, smoothstep(0.55, 0.78, rkMoist) * 0.9);
  low = mix(low, tundra, smoothstep(0.5, 0.72, rkLat));
  vec3 hi = mix(rock, hiRock, smoothstep(0.4, 0.8, rkRidge));
  vec3 ground = mix(low, hi, smoothstep(0.2, 0.6, rkRidge + max(rkElev, 0.0) * 0.3));
  ground *= rkTex;
  ground = mix(srgb(vec3(0.78, 0.7, 0.52)), ground, smoothstep(0.0, 0.035, rkElev));
  rkCol = mix(seaCol, ground, rkLand);
  rkCol = mix(rkCol, srgb(vec3(0.92, 0.95, 0.98)) * (0.93 + 0.07 * rkN2), rkIce);
#endif
// Pale ejecta in crater floors.
rkCol = mix(rkCol, rkCol * 1.35 + 0.02, rkPit * rkLand * (1.0 - rkIce) * 0.6);

// Mining: cracks open around fresh taps, around seams, and along the veins as tap heat builds.
float rkSeam = 0.0;
for (int i = 0; i < ${MAX_SEAMS}; i++) {
  vec4 s = uSeams[i];
  rkSeam = max(rkSeam, smoothstep(0.962, 0.996, dot(rkDir, s.xyz)) * s.w);
}
float rkHitCrack = 0.0;
for (int i = 0; i < ${MAX_HITS}; i++) {
  vec3 dd = rkP - uHits[i].xyz;
  rkHitCrack = max(rkHitCrack, exp(-dot(dd, dd) * 11.0) * uHitCrack[i]);
}
float rkHeatVein = clamp(vMine.x, 0.0, 1.0) * smoothstep(0.3, 1.5, uHeat) * 0.85;
float rkVeinAmt = smoothstep(0.08, 0.55, max(max(rkSeam * 0.9, rkHitCrack), rkHeatVein));
float rkPw = length(fwidth(rkP)) * 4.5;
float rkE = 1.0;
float rkLine = 0.0;
float rkCrack = 0.0;
float rkLip = 0.0;
float rkWidth = 0.03 + 0.05 * rkN2;
if (rkVeinAmt > 0.002) {
  rkE = rkEdge(rkP * 4.5 + vec3(rkN1 * 0.5));
  rkLine = 1.0 - smoothstep(rkWidth * 0.35, rkWidth + rkPw * 1.5, rkE);
  rkCrack = rkLine * rkVeinAmt;
  rkLip = (1.0 - smoothstep(0.0, rkWidth * 3.0 + rkPw * 2.0, rkE)) * rkVeinAmt;
}
float rkLive = smoothstep(0.3, 0.55, rkN1 + 0.3 * rkSeam + 0.4 * rkHitCrack);
// Scorched crust around the cracks.
rkCol *= (1.0 - 0.3 * rkVeinAmt) * (1.0 - 0.55 * rkLip);
diffuseColor.rgb = rkCol;
float rockRough = mix(0.9, 0.24, rkSea);
rockRough = mix(rockRough, 0.55, rkIce);
#ifdef PLANET_MOLTEN
rockRough = mix(rockRough, 0.75, rkSea);
#endif
// Day and night, from the geometric normal and the sun (both in view space).
vec3 rkGN = rkSafeNorm(vNormal, vec3(0.0, 0.0, 1.0));
float rkSunDot = dot(rkGN, uSunView);
float rkNight = smoothstep(0.06, -0.24, rkSunDot);
`;

/** Bump from the procedural height, using screen-space derivatives (scale-invariant form). Land only. */
const PLANET_NORMAL = /* glsl */ `
{
  float bm = smoothstep(0.0, 0.12, vGeo.x) * (1.0 - rkIce * 0.6);
  float rq = 2.0 * rkN2 - 1.0;
  float ridged = 1.0 - sqrt(max(rq * rq + 0.015, 0.0));
  float h = bm * (rkN1 * 0.25 + ridged * (0.12 + 0.5 * rkRidge) + rkN3 * 0.12) * 0.016 - rkLip * 0.003 - rkCrack * 0.007;
  vec3 pos = -vViewPosition;
  vec3 sX = dFdx(pos) * 64.0;
  vec3 sY = dFdy(pos) * 64.0;
  vec2 dH = vec2(dFdx(h), dFdy(h)) * 64.0;
  vec3 r1 = cross(sY, normal);
  vec3 r2 = cross(normal, sX);
  float det = dot(sX, r1);
  vec3 grad = (det < 0.0 ? -1.0 : 1.0) * (dH.x * r1 + dH.y * r2);
  normal = rkSafeNorm(abs(det) * normal - grad, normal);
  vec3 toEye = rkSafeNorm(vViewPosition, vec3(0.0, 0.0, 1.0));
  normal = rkSafeNorm(normal + toEye * max(0.0, 0.12 - dot(normal, toEye)), normal);
}
`;

const PLANET_EMISSIVE = /* glsl */ `
{
  vec3 vv = rkSafeNorm(vViewPosition, vec3(0.0, 0.0, 1.0));
  float fr = 1.0 - clamp(dot(rkGN, vv), 0.0, 1.0);
  float rim = fr * fr * fr;
  float heat = max(uHeat, 0.0);
  float pulse = 0.5 + 0.5 * sin(uTime * 1.4 - dot(rkP, vec3(1.3, 0.8, -1.1)) * 1.6 + rkN1 * 5.0);
  vec3 em = vec3(0.0);
#ifdef PLANET_MOLTEN
  // The melt glows on both sides; the crust plates hide most of it.
  float melt = rkSea * (1.0 - rkCrust * 0.88);
  vec3 lava = mix(vec3(0.85, 0.12, 0.02), vec3(1.0, 0.42, 0.08), smoothstep(0.3, 0.9, rkN2));
  em += lava * melt * (0.55 + 0.25 * pulse) * (0.75 + 0.6 * rkNight);
  // Molten fissures across the land, glowing at night.
  float fis = 1.0 - smoothstep(0.0, 0.035 + rkPw * 0.25, abs(rkNoise(rkP * 3.1 + 1.3) - 0.5));
  em += vec3(1.0, 0.32, 0.05) * fis * rkLand * (1.0 - rkIce) * (0.05 + 0.75 * rkNight) * (0.7 + 0.3 * pulse);
  vec3 atmo = vec3(1.0, 0.52, 0.22);
  vec3 dusk = vec3(0.9, 0.2, 0.05);
#else
  // City lights on the night side: clustered along coasts and lowlands.
  float zone = rkLand * (1.0 - rkIce) * (1.0 - smoothstep(0.08, 0.42, rkElev)) * (1.0 - smoothstep(0.25, 0.55, rkRidge));
  // Metro areas (sparse clusters), each a speckle of towns; a few lone villages between.
  float metro = smoothstep(0.62, 0.86, rkNoise(rkP * 5.3 + 11.0) + 0.12 * smoothstep(0.35, 0.6, rkMoist));
  float c2 = rkNoise(rkP * 31.0);
#ifdef ROCK_LITE
  float c3 = rkNoise(rkP * 67.0 + 4.0);
#else
  float c3 = rkNoise(rkP * 97.0 + 4.0);
#endif
  float speck = smoothstep(0.58, 0.82, c2 * 0.5 + c3 * 0.5);
  float lights = zone * (metro * (0.25 * speck + 0.75 * speck * speck) + smoothstep(0.8, 0.93, c3) * 0.35);
  em += vec3(1.0, 0.64, 0.3) * lights * rkNight * 1.3;
  vec3 atmo = vec3(0.3, 0.6, 1.0);
  vec3 dusk = vec3(1.0, 0.42, 0.16);
#endif
  // Atmosphere: haze toward the limb on the day side, reddening along the terminator.
  float dayK = smoothstep(-0.3, 0.35, rkSunDot);
  em += atmo * (fr * fr * 0.08 + rim * 0.38) * dayK;
  em += dusk * rim * exp(-rkSunDot * rkSunDot * 30.0) * 0.4;
  // Mining glow.
  float glowLine = rkCrack * rkLive;
  vec3 lavaLine = mix(vec3(0.9, 0.15, 0.02), vec3(1.0, 0.5, 0.11), rkLine) + vec3(1.0, 0.82, 0.5) * (rkLine * rkLine * rkLine) * 0.45 * min(heat + rkHitCrack, 1.5);
  em += lavaLine * glowLine * (0.5 + 0.5 * pulse + rkSeam * 0.4 + rkHitCrack * 0.6) * (1.0 + heat * 1.5);
  float halo = exp(-rkE * 8.0) * rkVeinAmt * rkLive;
  em += vec3(0.85, 0.2, 0.03) * halo * (0.03 + 0.03 * pulse + heat * 0.16 + rkHitCrack * 0.1);
  em += uVeinColor * rkSeam * rkSeam * (0.035 + 0.035 * pulse);
  vec3 hot = vec3(0.0);
  for (int i = 0; i < ${MAX_HITS}; i++) {
    vec4 hh = uHits[i];
    vec3 dd = rkP - hh.xyz;
    float d2 = dot(dd, dd);
    hot += vec3(1.0, 0.5, 0.18) * hh.w * (exp(-d2 * 90.0) + exp(-d2 * 12.0) * 0.1);
  }
  em += min(hot, vec3(2.5));
  // Rim: orange-red with tap heat, cyan in a surge.
  float rim6 = rim * rim;
  em += uHeatColor * heat * (rim * 0.3 + rim6 * 0.9) * (1.0 - 0.5 * uRes);
  em += vec3(0.2, 0.9, 1.0) * uRes * (rim * 0.25 + rim6 * 1.3 + glowLine * 0.5);
  totalEmissiveRadiance += em;
}
`;

/** Occlusion, and a properly dark night side (the fill lights would otherwise wash it out). */
const PLANET_AO = /* glsl */ `
float rkDark = mix(1.0, 0.22, rkNight);
reflectedLight.indirectDiffuse *= rkAo * rkDark;
reflectedLight.directDiffuse *= mix(1.0, rkAo, 0.5);
reflectedLight.indirectSpecular *= rkAo * rkDark;
`;

type PlanetUniforms = {
  uTime: { value: number };
  uHeat: { value: number };
  uHeatColor: { value: Color };
  uRes: { value: number };
  uVeinColor: { value: Color };
  uSunView: { value: Vector3 };
  uSun: { value: Vector3 };
  uSeams: { value: Vector4[] };
  uHits: { value: Vector4[] };
  uHitCrack: { value: Vector4 };
  uCloudRot: { value: number };
};

function makePlanetMaterial(lite: boolean, molten: boolean, uniforms: PlanetUniforms): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const defines: Record<string, string> = {};
  if (lite) defines.ROCK_LITE = '';
  if (molten) defines.PLANET_MOLTEN = '';
  mat.defines = { ...mat.defines, ...defines };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PLANET_VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockPos = position;\nvGeo = aGeo;\nvMine = aMine;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PLANET_FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${PLANET_COLOR}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rockRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = 0.0;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>\n${PLANET_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${PLANET_EMISSIVE}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${PLANET_AO}`);
  };
  mat.customProgramCacheKey = () => `sf-planet${lite ? '-lite' : ''}${molten ? '-molten' : ''}`;
  return mat;
}

/* ---------------- clouds ---------------- */

const CLOUD_VERT = /* glsl */ `
varying vec3 vLocal;
varying vec3 vWN;
void main() {
  vLocal = position;
  vWN = mat3(modelMatrix) * position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform float uCloudRot;
uniform vec3 uSun;
uniform vec4 uSeams[${MAX_SEAMS}];
uniform vec4 uHits[${MAX_HITS}];
uniform vec4 uHitCrack;
uniform float uRes;
varying vec3 vLocal;
varying vec3 vWN;
${NOISE}
void main() {
  vec3 d = rkSafeNorm(vLocal, vec3(0.0, 1.0, 0.0));
  float c = cos(uCloudRot);
  float s = sin(uCloudRot);
  vec3 p = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
  // Stretched along the latitude lines, swirled by a low warp.
  vec3 q = p * vec3(2.6, 4.4, 2.6);
  float w = rkNoise(q * 0.7 + 5.0);
  float w2 = rkNoise(q * 1.9 - 3.0);
  vec3 x = q + vec3(w * 2.2 + w2 * 0.5, w2 * 0.3, w * 1.7 - w2 * 0.4);
  float f = 0.0;
  float a = 0.56;
  for (int i = 0; i < CLOUD_OCTAVES; i++) {
    f += a * rkNoise(x);
    x = x * 2.07 + vec3(3.1, 1.7, 7.3);
    a *= 0.5;
  }
  float lat = abs(d.y);
  // Busier storm belts at mid latitudes, clearer subtropics.
  float belt = 0.05 * cos(lat * 9.0) - 0.04 * smoothstep(0.85, 1.0, lat);
  float cov = smoothstep(CLOUD_LO, CLOUD_LO + 0.2, f + belt);
  // Clouds part over fresh taps and over seams so the action shows.
  float clear = 0.0;
  for (int i = 0; i < ${MAX_HITS}; i++) {
    vec3 dd = vLocal - uHits[i].xyz;
    clear = max(clear, exp(-dot(dd, dd) * 5.0) * uHitCrack[i]);
  }
  for (int i = 0; i < ${MAX_SEAMS}; i++) {
    vec4 sm = uSeams[i];
    clear = max(clear, smoothstep(0.955, 0.985, dot(d, sm.xyz)) * step(0.01, sm.w) * 0.8);
  }
  float alpha = cov * (1.0 - clear) * (0.55 + 0.33 * smoothstep(CLOUD_LO + 0.1, CLOUD_LO + 0.35, f + belt));
  if (alpha < 0.004) discard;
  vec3 n = rkSafeNorm(vWN, uSun);
  float ndl = dot(n, uSun);
  float lit = smoothstep(-0.06, 0.4, ndl);
  vec3 col = mix(CLOUD_NIGHT, CLOUD_DAY * (0.45 + 0.55 * clamp(ndl + 0.1, 0.0, 1.0)), lit);
  col += vec3(1.0, 0.42, 0.16) * exp(-(ndl + 0.03) * (ndl + 0.03) * 60.0) * 0.45;
  col += vec3(0.2, 0.9, 1.0) * uRes * 0.08;
  // Thinner on the night side, so the lights below glow through.
  gl_FragColor = vec4(col, alpha * mix(0.6, 1.0, lit));
}
`;

/* ---------------- atmosphere shell ---------------- */

const ATMO_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vCenter;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPos = wp.xyz;
  vCenter = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/** Glow beyond the limb: falls off with the view ray's closest approach to the centre, lit by the sun, red at sunset. */
const ATMO_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uRadius;
uniform vec3 uDay;
uniform vec3 uDusk;
uniform float uHeat;
uniform vec3 uHeatColor;
uniform float uRes;
varying vec3 vPos;
varying vec3 vCenter;
vec3 aSafeN(vec3 v, vec3 fb) {
  float l2 = dot(v, v);
  return l2 > 1e-20 ? v * inversesqrt(l2) : fb;
}
void main() {
  vec3 dir = aSafeN(vPos - cameraPosition, vec3(0.0, 0.0, -1.0));
  vec3 oc = vCenter - cameraPosition;
  float tca = dot(oc, dir);
  float b = sqrt(max(dot(oc, oc) - tca * tca, 0.0)) / max(uRadius, 1e-3);
  float h = clamp((b - 1.0) / ${(ATMO_R - 1).toFixed(3)}, 0.0, 1.0);
  float g = b >= 1.0 ? exp(-h * 5.5) * (1.0 - smoothstep(0.7, 1.0, h)) : 0.0;
  vec3 n = aSafeN(cameraPosition + dir * tca - vCenter, uSun);
  float sd = dot(n, uSun);
  float lit = smoothstep(-0.4, 0.3, sd);
  vec3 col = mix(uDusk, uDay, smoothstep(-0.15, 0.45, sd)) * lit;
  col += uHeatColor * max(uHeat, 0.0) * 0.25 + vec3(0.2, 0.9, 1.0) * uRes * 0.5;
  gl_FragColor = vec4(col * g, 1.0);
}
`;

/* ---------------- tuning ---------------- */

const ORANGE = new Color('#ff8a2a');
const RED = new Color('#ff2a12');
const CYAN = new Color('#45e6ff');
const ORE = new Color(RESOURCE_DEFS.ore.color);
const Y_UP = new Vector3(0, 1, 0);
/** Heat each of my strikes adds, and how fast it bleeds off (per second). */
const HEAT_PER_TAP = 0.065;
const HEAT_COOL = 0.9;
/** How long the crack network around a tap lingers (s). */
const CRACK_LIFE = 3.5;

/** Planet spin angle from the host's clock (ms), wrapped, so every client agrees on it. */
function spinAngle(ms: number, rate: number): number {
  const a = ((ms / 1000) * rate) % (Math.PI * 2);
  return Number.isFinite(a) ? a : 0;
}

/**
 * The planet. `refs.rock` is the spin group (seam directions live in its
 * local space); its rotation is a fixed axial tilt times a spin about the
 * local Y axis taken from the host's clock, so all crewmates see the same
 * face at the same moment, which is what makes their cameras (and ships)
 * line up with yours. Inside it, three nested groups squash the surface
 * along the direction of the latest impact (rotate in, scale, rotate back),
 * so seams, rigs and scorch marks squash with it.
 */
export function Asteroid() {
  const seed = useGame((s) => s.s?.seed ?? 1);
  const lite = useLite();
  const molten = planetKind(seed) === 'molten';
  const geo = useBundle(() => buildPlanet(seed, lite), [seed, lite]);
  const shell = useBundle(() => ({ g: shellGeometry(lite) }), [lite]);

  const uniforms = useMemo<PlanetUniforms>(
    () => ({
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uHeatColor: { value: ORANGE.clone() },
      uRes: { value: 0 },
      uVeinColor: { value: ORE.clone() },
      uSunView: { value: SUN_DIR.clone() },
      uSun: { value: SUN_DIR.clone() },
      uSeams: { value: Array.from({ length: MAX_SEAMS }, () => new Vector4()) },
      uHits: { value: Array.from({ length: MAX_HITS }, () => new Vector4()) },
      uHitCrack: { value: new Vector4() },
      uCloudRot: { value: 0 },
    }),
    [],
  );
  const res = useBundle(
    () => ({
      rockMat: makePlanetMaterial(lite, molten, uniforms),
      cloudMat: new ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uCloudRot: uniforms.uCloudRot,
          uSun: uniforms.uSun,
          uSeams: uniforms.uSeams,
          uHits: uniforms.uHits,
          uHitCrack: uniforms.uHitCrack,
          uRes: uniforms.uRes,
        },
        defines: {
          CLOUD_OCTAVES: lite ? 4 : 6,
          CLOUD_LO: molten ? '0.64' : '0.58',
          CLOUD_DAY: molten ? 'vec3(0.5, 0.45, 0.41)' : 'vec3(0.86, 0.87, 0.88)',
          CLOUD_NIGHT: molten ? 'vec3(0.09, 0.025, 0.015)' : 'vec3(0.012, 0.016, 0.03)',
        },
        transparent: true,
        depthWrite: false,
      }),
      atmoMat: new ShaderMaterial({
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        uniforms: {
          uSun: uniforms.uSun,
          uRadius: { value: ASTEROID_RADIUS },
          uDay: { value: molten ? new Color(1.0, 0.5, 0.2).multiplyScalar(0.9) : new Color(0.32, 0.62, 1.0).multiplyScalar(1.1) },
          uDusk: { value: molten ? new Color(0.8, 0.16, 0.04) : new Color(1.0, 0.38, 0.14).multiplyScalar(0.8) },
          uHeat: uniforms.uHeat,
          uHeatColor: uniforms.uHeatColor,
          uRes: uniforms.uRes,
        },
        side: BackSide,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
      }),
      halo: new SpriteMaterial({ map: glowTexture(), color: new Color(0, 0, 0), blending: AdditiveBlending, depthWrite: false, transparent: true }),
    }),
    [lite, molten, uniforms],
  );
  const objs = useMemo(() => {
    const halo = new Sprite(res.halo);
    halo.scale.setScalar(9.5);
    halo.renderOrder = 1;
    halo.visible = false;
    const clouds = new Mesh(shell.g, res.cloudMat);
    clouds.scale.setScalar(ASTEROID_RADIUS * CLOUD_R);
    clouds.renderOrder = 2;
    const atmo = new Mesh(shell.g, res.atmoMat);
    atmo.scale.setScalar(ASTEROID_RADIUS * ATMO_R);
    atmo.renderOrder = 1;
    for (const m of [halo, clouds, atmo]) m.raycast = () => {};
    return { halo, clouds, atmo };
  }, [res, shell]);

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
      qSpin: new Quaternion(),
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
          // Only bursts on the planet thunk it (a caught comet bursts further out).
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
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    const t = state.clock.elapsedTime;
    sim.time = t;
    const g = spin.current;
    const ms = hostNow();
    g.quaternion.copy(TILT).multiply(sim.qSpin.setFromAxisAngle(Y_UP, spinAngle(ms, SPIN)));

    // Damped spring: a small squash along the impact direction that rebounds with a wobble.
    sim.v += (-260 * sim.x - 11 * sim.v) * dt;
    sim.x = Math.max(-0.07, Math.min(0.05, sim.x + sim.v * dt));
    sim.qGoal.setFromUnitVectors(Y_UP, sim.axis);
    sim.q.slerp(sim.qGoal, 1 - Math.exp(-14 * dt));
    tilt.current.quaternion.copy(sim.q);
    inner.current.quaternion.copy(sim.q).invert();
    squash.current.scale.set(1 - sim.x * 0.3, 1 + sim.x * 0.6, 1 - sim.x * 0.3);

    const s = useGame.getState().s;
    sim.taps = Math.max(0, sim.taps - sim.taps * HEAT_COOL * dt - 0.01 * dt);
    sim.heat = damp(sim.heat, sim.taps, 7, dt);
    sim.hot = damp(sim.hot, sim.taps > 0.7 ? 1 : 0, 4, dt);
    sim.res = damp(sim.res, s && surgeOn(s, ms) ? 1 : 0, 3, dt);

    const u = uniforms;
    u.uTime.value = t;
    const heat = Math.pow(Math.max(0, Math.min(4, sim.heat)), 1.3) * (1.2 + sim.hot * 1.1);
    u.uHeat.value = heat;
    u.uHeatColor.value.copy(ORANGE).lerp(RED, sim.hot);
    u.uRes.value = sim.res;
    u.uCloudRot.value = spinAngle(ms, CLOUD_SPIN);
    u.uSunView.value.copy(SUN_DIR).transformDirection(state.camera.matrixWorldInverse);

    // Seams: direction and health, so the surface glows and cracks around each one.
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
      // Cracks snap open fast and close slowly.
      const ck = age >= 0 && age < CRACK_LIFE ? Math.min(1, age * 10) * (1 - Math.pow(age / CRACK_LIFE, 2)) * (1 + sim.hitHot[i] * 0.3) : 0;
      const p = sim.hitPos[i];
      u.uHits.value[i].set(p.x, p.y, p.z, w);
      u.uHitCrack.value.setComponent(i, ck);
    }

    // Halo behind the planet: heat orange, surge cyan.
    const hk = Math.min(0.8, heat * 0.3);
    res.halo.color.copy(u.uHeatColor.value).multiplyScalar(hk).add(tmp.c.copy(CYAN).multiplyScalar(sim.res * 0.35));
    objs.halo.visible = hk + sim.res > 0.01;
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!tapOk(e.nativeEvent)) return;
    if (e.face) tmp.n.copy(e.face.normal).transformDirection(e.object.matrixWorld);
    else tmp.n.copy(e.point);
    if (!(tmp.n.lengthSq() > 1e-12)) tmp.n.set(0, 1, 0);
    tmp.n.normalize();
    act.strike(null, e.point, tmp.n);
  };

  return (
    <>
      <primitive object={objs.halo} />
      <primitive object={objs.atmo} />
      <group ref={spin}>
        <group ref={tilt}>
          <group ref={squash}>
            <group ref={inner}>
              <mesh geometry={geo.rock} material={res.rockMat} />
              <mesh geometry={geo.hit} visible={false} onPointerDown={onDown} />
              <primitive object={objs.clouds} />
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
