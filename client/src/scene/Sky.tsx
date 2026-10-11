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
  type Group,
} from 'three';
import { bus } from './bus';
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
  float k = dot(d, normalize(vec3(0.25, 1.0, -0.3))) * 2.6;
  float band = exp(-k * k);
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
uniform vec3 uTint;
uniform float uTintAmt;
uniform float uSurge;
varying vec3 vLocal;
varying vec3 vWorld;
void main() {
  vec3 enc = textureCube(uNebula, normalize(vLocal)).rgb;
  vec3 col = mix(vec3(0.0035, 0.004, 0.014), enc * enc, uReady);
  vec3 d = normalize(vWorld);
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.05 + pow(sd, 40.0) * 0.12);
  col += uTint * 0.07 * uTintAmt;
  // Resonance surge: a faint cyan wash, strongest in the brighter nebula.
  col += vec3(0.0, 0.03, 0.04) * uSurge * (0.4 + 6.0 * dot(enc * enc, vec3(0.33)));
  gl_FragColor = vec4(col, 1.0);
}
`;

const SUN_DIR = new Vector3(6, 4, 5).normalize();
const SUN_DIST = 190;
const KEY_POS = SUN_DIR.clone().multiplyScalar(30);
const SUN = new Color('#fff0d6');
const SCATTER = new Color('#ffcf9a');

/**
 * Backdrop: an fbm nebula (deep blues, purples and teal) baked once into a
 * cube map and drawn on an inverted sphere that follows the camera and
 * slowly drifts, drei Stars, and a distant sun along which the key light
 * shines. 'flash' pulses (bus.tint) and a resonance surge (bus.surge) tint
 * the nebula.
 */
export function Sky() {
  const gl = useThree((s) => s.gl);
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true, []);
  const lite = useMemo(isLite, []);

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
      core: new SpriteMaterial({ map: glowTexture(), color: SUN.clone().multiplyScalar(3.2), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
      halo: new SpriteMaterial({ map: glowTexture(), color: SUN.clone().multiplyScalar(0.9), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
      streak: new SpriteMaterial({ map: glowTexture(), color: SUN.clone().multiplyScalar(0.35), blending: AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
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

    // Sun billboard at a fixed angular position.
    sunGroup.current.position.copy(cam.position).addScaledVector(SUN_DIR, SUN_DIST);
  });

  return (
    <>
      <primitive object={objs.sky} />
      <Stars radius={110} depth={60} count={lite ? 2000 : 3500} factor={3.2} saturation={0.15} fade speed={0.5} />
      <group ref={sunGroup}>
        <primitive object={objs.halo} />
        <primitive object={objs.streak} />
        <primitive object={objs.core} />
      </group>
      <directionalLight position={KEY_POS} intensity={3.1} color="#fff1dc" />
    </>
  );
}
