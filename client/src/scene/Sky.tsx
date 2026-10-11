import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import {
  AdditiveBlending,
  BackSide,
  Color,
  CubeCamera,
  LinearFilter,
  Mesh,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLCubeRenderTarget,
  type DirectionalLight,
  type Group,
} from 'three';
import { useGame } from '../state/store';
import { bus } from './bus';
import { damp, glowTexture, useBundle } from './util';

/* ---------------- nebula: baked once into a cube map ---------------- */

const BAKE_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BAKE_FRAG = /* glsl */ `
varying vec3 vDir;
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
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
void main() {
  vec3 d = normalize(vDir);
  vec3 p = d * 2.1;
  float w = fbm(p * 1.4);
  float n = fbm(p + w * 1.5);
  float n2 = fbm(p * 2.4 - w * 0.8 + 4.0);

  vec3 deep = vec3(0.0035, 0.004, 0.014);
  vec3 blue = vec3(0.012, 0.03, 0.11);
  vec3 purple = vec3(0.07, 0.016, 0.12);
  vec3 teal = vec3(0.0, 0.085, 0.1);

  vec3 col = deep;
  col = mix(col, blue, smoothstep(0.38, 0.78, n));
  col = mix(col, purple, smoothstep(0.48, 0.82, n2) * 0.85);
  col += teal * smoothstep(0.5, 0.9, n * n2 * 1.9) * 1.2;
  // Dust lanes.
  col *= 0.45 + 0.75 * smoothstep(0.28, 0.68, w);
  // A brighter galactic band.
  float band = exp(-pow(dot(d, normalize(vec3(0.25, 1.0, -0.3))) * 2.6, 2.0));
  col *= 0.55 + 0.9 * band;
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
uniform float uFlare;
uniform vec3 uTint;
uniform float uTintAmt;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vec3 enc = textureCube(uNebula, normalize(vLocal)).rgb;
  vec3 col = mix(vec3(0.0035, 0.004, 0.014), enc * enc, uReady);
  vec3 d = normalize(vWorld);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.05 + pow(sd, 40.0) * 0.12) * (1.0 + uFlare * 3.0);
  col += uTint * 0.07 * uTintAmt;
  gl_FragColor = vec4(col, 1.0);
}
`;

const BASE_SUN = new Vector3(6, 4, 5).normalize();
const SUN_DIST = 190;
const SUN_CALM = new Color('#fff0d6');
const SUN_FLARE = new Color('#ff5a1f');
const KEY_CALM = new Color('#fff1dc');
const KEY_FLARE = new Color('#ff9a52');
const SCATTER = new Color('#ffcf9a');

/**
 * Backdrop: an fbm nebula (deep blues, purples and teal) baked once into a
 * cube map and drawn on an inverted sphere that follows the camera and
 * slowly drifts, drei Stars, and a distant sun whose direction drives the
 * key light. During a Solar Flare the sun swings to `event.sunDir`, swells
 * and turns orange-red; it eases back afterwards.
 */
export function Sky() {
  const gl = useThree((s) => s.gl);
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true, []);

  const res = useBundle(
    () => ({
      geo: new SphereGeometry(260, 48, 24),
      cube: new WebGLCubeRenderTarget(coarse ? 512 : 1024, { generateMipmaps: false, minFilter: LinearFilter, magFilter: LinearFilter }),
      bake: new ShaderMaterial({ vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: BackSide, depthWrite: false, depthTest: false }),
      mat: new ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uNebula: { value: null },
          uReady: { value: 0 },
          uSunDir: { value: BASE_SUN.clone() },
          uSunColor: { value: SCATTER.clone() },
          uFlare: { value: 0 },
          uTint: { value: new Color() },
          uTintAmt: { value: 0 },
        },
        side: BackSide,
        depthWrite: false,
        depthTest: false,
      }),
      core: new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
      halo: new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
      streak: new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
    }),
    [coarse],
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
    const core = new Sprite(res.core);
    const halo = new Sprite(res.halo);
    const streak = new Sprite(res.streak);
    core.renderOrder = halo.renderOrder = streak.renderOrder = -50;
    return { sky, core, halo, streak };
  }, [res]);

  const sunGroup = useRef<Group>(null!);
  const key = useRef<DirectionalLight>(null!);
  const st = useMemo(() => ({ dir: BASE_SUN.clone(), target: BASE_SUN.clone(), color: new Color(), flareDir: BASE_SUN.clone() }), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const cam = state.camera;
    const ev = useGame.getState().s?.event;
    const flaring = ev?.kind === 'flare';
    if (flaring) st.flareDir.set(ev.sunDir[0], ev.sunDir[1], ev.sunDir[2]).normalize();
    st.target.copy(flaring ? st.flareDir : BASE_SUN);
    st.dir.lerp(st.target, 1 - Math.exp(-dt * 1.1));
    if (st.dir.lengthSq() < 1e-4) st.dir.copy(st.target);
    st.dir.normalize();
    bus.flare = damp(bus.flare, flaring ? 1 : 0, 1.4, dt);
    bus.sunDir.copy(st.dir);
    const f = bus.flare;

    // The sky rides with the camera (infinitely far) and drifts slowly.
    objs.sky.position.copy(cam.position);
    objs.sky.rotation.y += dt * 0.004;
    objs.sky.rotation.x = Math.sin(t * 0.01) * 0.08;
    const u = res.mat.uniforms;
    (u.uSunDir.value as Vector3).copy(st.dir);
    u.uFlare.value = f;
    (u.uTint.value as Color).copy(bus.tint);
    u.uTintAmt.value = bus.tintAmt;

    // Sun billboard at a fixed angular position.
    const g = sunGroup.current;
    g.position.copy(cam.position).addScaledVector(st.dir, SUN_DIST);
    const flick = 1 + f * (0.08 * Math.sin(t * 9.1) + 0.05 * Math.sin(t * 23.7));
    st.color.copy(SUN_CALM).lerp(SUN_FLARE, f);
    res.core.color.copy(st.color).multiplyScalar(3.2 + f * 2.5);
    res.halo.color.copy(st.color).multiplyScalar(0.9 + f * 1.4);
    res.streak.color.copy(st.color).multiplyScalar(0.35 + f * 0.6);
    objs.core.scale.setScalar((11 + f * 9) * flick);
    objs.halo.scale.setScalar((48 + f * 70) * flick);
    objs.streak.scale.set((150 + f * 120) * flick, 3.2 + f * 3, 1);

    const k = key.current;
    k.position.copy(st.dir).multiplyScalar(30);
    k.intensity = 3.1 + f * 2.6;
    k.color.copy(KEY_CALM).lerp(KEY_FLARE, f);
  });

  return (
    <>
      <primitive object={objs.sky} />
      <Stars radius={110} depth={60} count={3500} factor={3.2} saturation={0.15} fade speed={0.5} />
      <group ref={sunGroup}>
        <primitive object={objs.halo} />
        <primitive object={objs.streak} />
        <primitive object={objs.core} />
      </group>
      <directionalLight ref={key} position={[18, 12, 15]} intensity={3.1} color="#fff1dc" />
    </>
  );
}
