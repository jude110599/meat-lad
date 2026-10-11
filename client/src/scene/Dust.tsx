import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector3 } from 'three';
import { bus } from './bus';
import { isLite } from './util';

const COUNT = isLite() ? 150 : 340;
/** Side of the box of dust that follows the camera around (world units). */
const BOX = 13;
const BASE = new Color('#8fa6ff');
const SURGE = new Color('#7ff1ff');

const VERT = /* glsl */ `
attribute float aSize;
attribute float aSeed;
uniform vec3 uCam;
uniform float uTime;
uniform float uScale;
varying float vA;
void main() {
  // Slow drift, then wrap into a box centred on the camera so there is always
  // dust around it, wherever it orbits (world-space, so it parallaxes).
  vec3 drift = vec3(sin(uTime * 0.07 + aSeed * 6.3), cos(uTime * 0.05 + aSeed * 4.1), sin(uTime * 0.06 + aSeed * 9.7)) * 0.5;
  drift.x += uTime * 0.035;
  vec3 p = mod(position + drift - uCam, ${BOX.toFixed(1)}) - ${(BOX / 2).toFixed(1)} + uCam;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float depth = -mv.z;
  float dCam = length(p - uCam);
  // Fade right at the lens and toward the box edge, so nothing pops.
  vA = smoothstep(0.7, 2.2, depth) * (1.0 - smoothstep(${(BOX * 0.32).toFixed(2)}, ${(BOX * 0.5).toFixed(2)}, dCam));
  vA *= 0.6 + 0.4 * sin(uTime * (0.6 + aSeed) + aSeed * 30.0);
  gl_PointSize = clamp(aSize * uScale / max(depth, 0.1), 1.0, 9.0);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d >= 1.0) discard;
  gl_FragColor = vec4(uColor * vA * exp(-d * 3.0) * (1.0 - d), 1.0);
}
`;

/**
 * Faint motes of space dust drifting around the camera, for a sense of depth
 * and motion as the view orbits. One small point cloud that follows the
 * camera in the shader (no per-frame CPU work beyond a few uniforms). It
 * picks up a cyan tint during a resonance surge.
 */
export function Dust() {
  const sys = useMemo(() => {
    const pos = new Float32Array(COUNT * 3);
    const size = new Float32Array(COUNT);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = Math.random() * BOX;
      pos[i * 3 + 1] = Math.random() * BOX;
      pos[i * 3 + 2] = Math.random() * BOX;
      const r = Math.random();
      size[i] = 0.018 + r * r * r * 0.05;
      seed[i] = Math.random();
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new BufferAttribute(size, 1));
    geo.setAttribute('aSeed', new BufferAttribute(seed, 1));
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uCam: { value: new Vector3() }, uTime: { value: 0 }, uScale: { value: 800 }, uColor: { value: BASE.clone().multiplyScalar(0.5) } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 1;
    return { points, geo, mat };
  }, []);
  useEffect(
    () => () => {
      sys.geo.dispose();
      sys.mat.dispose();
    },
    [sys],
  );

  useFrame((state) => {
    const u = sys.mat.uniforms;
    (u.uCam.value as Vector3).copy(state.camera.position);
    u.uTime.value = state.clock.elapsedTime % 3600;
    u.uScale.value = bus.pointScale;
    (u.uColor.value as Color)
      .copy(BASE)
      .lerp(SURGE, bus.surge * 0.8)
      .multiplyScalar(0.5 + bus.surge * 0.35 + bus.warp * 0.8);
  });

  return <primitive object={sys.points} />;
}
