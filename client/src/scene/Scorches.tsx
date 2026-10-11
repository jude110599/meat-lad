import { useEffect, useMemo, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Group,
} from 'three';
import { onFx } from '../state/fx';

const COUNT = 48;

const VERT = /* glsl */ `
attribute float aBirth;
attribute float aHot;
attribute float aSeed;
uniform float uTime;
varying vec2 vUv;
varying float vAge;
varying float vHot;
varying float vSeed;
void main() {
  vUv = uv;
  vAge = uTime - aBirth;
  vHot = aHot;
  vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying float vAge;
varying float vHot;
varying float vSeed;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float fade = 1.0 - smoothstep(6.0, 9.0, vAge);
  if (fade <= 0.0) discard;
  vec2 c = vUv * 2.0 - 1.0;
  float r = length(c);
  float n = vnoise(c * 3.0 + vSeed * 17.0) * 0.35 + vnoise(c * 7.0 - vSeed * 9.0) * 0.18;
  float shape = smoothstep(1.0, 0.5, r + n - 0.12);
  if (shape <= 0.002) discard;
  // Fresh strikes glow, then cool to a charred mark over ~6 s.
  float heat = exp(-vAge * mix(0.85, 0.5, vHot));
  float core = smoothstep(0.75, 0.0, r + n * 0.6);
  vec3 ember = mix(vec3(1.0, 0.28, 0.04), vec3(1.0, 0.82, 0.45), core * heat) * (1.5 + 3.5 * heat * core) * (1.0 + vHot * 0.8);
  vec3 soot = vec3(0.025, 0.02, 0.018);
  vec3 col = mix(soot, ember, clamp(heat * (core * 1.3 + 0.15), 0.0, 1.0));
  float alpha = shape * fade * mix(0.82, 1.0, heat);
  gl_FragColor = vec4(col, alpha);
}
`;

const Z = new Vector3(0, 0, 1);

/**
 * Pooled scorch decals. A 'scorch' fx arrives in world space; the point and
 * normal are converted into the squash group's local space so the mark
 * rides on the spinning rock. Ageing happens entirely in the shader.
 */
export function Scorches({ parent }: { parent: RefObject<Group | null> }) {
  const sys = useMemo(() => {
    const geo = new PlaneGeometry(1, 1);
    const birth = new InstancedBufferAttribute(new Float32Array(COUNT).fill(-1000), 1).setUsage(DynamicDrawUsage);
    const hot = new InstancedBufferAttribute(new Float32Array(COUNT), 1).setUsage(DynamicDrawUsage);
    const seed = new InstancedBufferAttribute(new Float32Array(COUNT), 1).setUsage(DynamicDrawUsage);
    geo.setAttribute('aBirth', birth);
    geo.setAttribute('aHot', hot);
    geo.setAttribute('aSeed', seed);
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new InstancedMesh(geo, mat, COUNT);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < COUNT; i++) mesh.setMatrixAt(i, zero);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    return { geo, mat, mesh, birth, hot, seed, head: 0, time: 0 };
  }, []);

  const tmp = useMemo(() => ({ inv: new Matrix4(), m: new Matrix4(), p: new Vector3(), n: new Vector3(), q: new Quaternion(), q2: new Quaternion(), s: new Vector3() }), []);

  useEffect(() => {
    const off = onFx((e) => {
      if (e.kind !== 'scorch') return;
      const g = parent.current;
      if (!g) return;
      g.updateWorldMatrix(true, false);
      tmp.inv.copy(g.matrixWorld).invert();
      tmp.n.copy(e.normal).transformDirection(tmp.inv);
      tmp.p.copy(e.at).applyMatrix4(tmp.inv).addScaledVector(tmp.n, 0.012);
      tmp.q.setFromUnitVectors(Z, tmp.n);
      tmp.q2.setFromAxisAngle(Z, Math.random() * Math.PI * 2);
      tmp.q.multiply(tmp.q2);
      const size = (e.hot ? 0.34 : 0.24) * (0.8 + Math.random() * 0.4);
      tmp.m.compose(tmp.p, tmp.q, tmp.s.set(size, size, size));
      const i = sys.head;
      sys.head = (sys.head + 1) % COUNT;
      sys.mesh.setMatrixAt(i, tmp.m);
      sys.mesh.instanceMatrix.needsUpdate = true;
      sys.birth.setX(i, sys.time);
      sys.hot.setX(i, e.hot ? 1 : 0);
      sys.seed.setX(i, Math.random());
      sys.birth.needsUpdate = true;
      sys.hot.needsUpdate = true;
      sys.seed.needsUpdate = true;
    });
    return () => {
      off();
    };
  }, [sys, tmp, parent]);

  useEffect(
    () => () => {
      sys.geo.dispose();
      sys.mat.dispose();
      sys.mesh.dispose();
    },
    [sys],
  );

  useFrame((state) => {
    sys.time = state.clock.elapsedTime;
    sys.mat.uniforms.uTime.value = sys.time;
  });

  return <primitive object={sys.mesh} />;
}
