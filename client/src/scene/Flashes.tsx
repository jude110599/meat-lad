import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { easeOutCubic, kit, type FlashKind, type FlashOpts } from './fxkit';
import { isLite, useBundle } from './util';

const POOL = isLite() ? 40 : 72;

const VERT = /* glsl */ `
attribute float aMode;
varying vec2 vUv;
varying vec3 vCol;
varying float vMode;
void main() {
  vUv = uv;
  vMode = aMode;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  vec4 c = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 s = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
  c.xy += position.xy * s;
  gl_Position = projectionMatrix * c;
}
`;

// aMode: 0..1 = soft glow with that much four-point star; >= 2 = a ring
// whose band is (aMode - 2) of the radius thick.
const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vMode;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = dot(p, p);
  if (d >= 1.0) discard;
  float lum = min(length(vCol), 4.0);
  if (vMode >= 1.5) {
    float th = clamp(vMode - 2.0, 0.03, 0.9);
    float r = sqrt(max(d, 0.0));
    float x = (r - (1.0 - th)) / th;
    float band = x < 0.0 ? exp(-x * x * 2.5) : exp(-x * x * 14.0);
    float rim = smoothstep(1.0, 0.96, r);
    gl_FragColor = vec4((vCol + vec3(lum * 0.25)) * band * rim, 1.0);
    return;
  }
  float edge = 1.0 - d;
  float glow = exp(-d * 4.5) * edge;
  float core = exp(-d * 26.0);
  float star = (exp(-abs(p.x) * 30.0) * exp(-abs(p.y) * 2.6) + exp(-abs(p.y) * 30.0) * exp(-abs(p.x) * 2.6)) * edge;
  gl_FragColor = vec4(vCol * (glow + star * vMode * 1.4) + vec3(core * lum * 0.55), 1.0);
}
`;

const MODE: Record<FlashKind, number> = { glow: 0, star: 1, streak: 0.15, ring: 2.18 };

interface Flash {
  pos: Vector3;
  color: Color;
  size0: number;
  size1: number;
  life: number;
  age: number;
  delay: number;
  lift: number;
  aspect: number;
  mode: number;
  ring: boolean;
}

/**
 * Pooled camera-facing flashes (impact flares, star bursts, expanding rings
 * and anamorphic streaks), all in one instanced draw. Spawn them with
 * `flash()` from fxkit.ts. Rendered by Lasers.
 */
export function Flashes() {
  const res = useBundle(
    () => ({
      geo: new PlaneGeometry(1, 1),
      mat: new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: AdditiveBlending }),
    }),
    [],
  );
  const mesh = useMemo(() => {
    const m = new InstancedMesh(res.geo, res.mat, POOL);
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(POOL * 3), 3).setUsage(DynamicDrawUsage);
    m.geometry.setAttribute('aMode', new InstancedBufferAttribute(new Float32Array(POOL), 1).setUsage(DynamicDrawUsage));
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = 8;
    return m;
  }, [res]);
  useEffect(() => () => mesh.dispose(), [mesh]);

  const pool = useMemo<Flash[]>(
    () =>
      Array.from({ length: POOL }, () => ({
        pos: new Vector3(),
        color: new Color(),
        size0: 0,
        size1: 0,
        life: 0,
        age: 1,
        delay: 0,
        lift: 0,
        aspect: 1,
        mode: 0,
        ring: false,
      })),
    [],
  );
  const tmp = useMemo(() => ({ m: new Matrix4(), p: new Vector3(), c: new Color(), head: 0 }), []);

  useEffect(() => {
    const spawn = (at: Vector3, color: Color, o?: FlashOpts) => {
      if (!Number.isFinite(at.x + at.y + at.z)) return;
      const f = pool[tmp.head];
      tmp.head = (tmp.head + 1) % POOL;
      const kind = o?.kind ?? 'glow';
      f.pos.copy(at);
      f.color.copy(color);
      f.size0 = o?.size ?? 0.5;
      f.size1 = o?.size1 ?? f.size0;
      f.life = Math.max(0.02, o?.life ?? 0.3);
      f.delay = Math.max(0, o?.delay ?? 0);
      f.age = 0;
      f.lift = o?.lift ?? 0;
      f.aspect = o?.aspect ?? (kind === 'streak' ? 5 : 1);
      f.mode = MODE[kind];
      f.ring = kind === 'ring';
    };
    kit.flash = spawn;
    return () => {
      if (kit.flash === spawn) kit.flash = null;
    };
  }, [pool, tmp]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    const cam = state.camera;
    const modes = mesh.geometry.getAttribute('aMode') as InstancedBufferAttribute;
    let n = 0;
    for (let i = 0; i < POOL; i++) {
      const f = pool[i];
      if (f.age >= f.delay + f.life) continue;
      f.age += dt;
      const t = (f.age - f.delay) / f.life;
      if (t < 0 || t >= 1) continue;
      const e = easeOutCubic(t);
      const size = f.size0 + (f.size1 - f.size0) * e;
      // Rings fade slower than they grow; glows burn out fast.
      const a = f.ring ? (1 - t) * (1 - t * 0.5) : (1 - t) * (1 - t);
      tmp.p.copy(f.pos);
      if (f.lift) {
        tmp.p.sub(cam.position);
        const l = tmp.p.length();
        if (l > 1e-4) tmp.p.multiplyScalar(Math.max(0, l - f.lift) / l);
        tmp.p.add(cam.position);
      }
      tmp.m.makeScale(size * f.aspect, size, 1).setPosition(tmp.p);
      mesh.setMatrixAt(n, tmp.m);
      mesh.setColorAt(n, tmp.c.copy(f.color).multiplyScalar(a));
      modes.setX(n, f.mode);
      n++;
    }
    mesh.count = n;
    if (n) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      modes.needsUpdate = true;
    }
  });

  return <primitive object={mesh} />;
}
