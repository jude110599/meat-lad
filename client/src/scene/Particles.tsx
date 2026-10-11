import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, Points, ShaderMaterial, type Color, type Vector3 } from 'three';
import { onFx } from '../state/fx';
import { bus, type SparkOpts } from './bus';
import { cssColor, isLite } from './util';

/** Phones and narrow windows get half the pool and thinner bursts. */
const LITE = isLite();
const MAX = LITE ? 2000 : 4000;
const COUNT_SCALE = LITE ? 0.6 : 1;

const VERT = /* glsl */ `
attribute float aSize;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float glow = exp(-d * 3.0) * (1.0 - d);
  float core = exp(-d * 16.0);
  gl_FragColor = vec4(vColor * (glow + core * 1.6), 1.0);
}
`;

/**
 * One pooled additive point cloud for every spark, chip and splash in the
 * scene. Bursts write into a ring buffer, so spawning never allocates and
 * all particles draw in a single call. Other components spawn through
 * `sparks()` in bus.ts; 'burst' fx from the network land here directly.
 */
export function Particles() {
  const sys = useMemo(() => {
    const pos = new Float32Array(MAX * 3);
    const col = new Float32Array(MAX * 3);
    const size = new Float32Array(MAX);
    const geo = new BufferGeometry();
    const aPos = new BufferAttribute(pos, 3).setUsage(DynamicDrawUsage);
    const aCol = new BufferAttribute(col, 3).setUsage(DynamicDrawUsage);
    const aSize = new BufferAttribute(size, 1).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', aPos);
    geo.setAttribute('aColor', aCol);
    geo.setAttribute('aSize', aSize);
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 5;
    return {
      points,
      geo,
      mat,
      aPos,
      aCol,
      aSize,
      pos,
      col,
      size,
      vel: new Float32Array(MAX * 3),
      base: new Float32Array(MAX * 3),
      size0: new Float32Array(MAX),
      life: new Float32Array(MAX),
      maxLife: new Float32Array(MAX).fill(1),
      drag: new Float32Array(MAX),
      head: 0,
      alive: 0,
    };
  }, []);

  useEffect(() => {
    const { pos, vel, base, size, size0, life, maxLife, drag } = sys;
    const emit = (at: Vector3, dir: Vector3 | null, color: Color, count: number, speed: number, o?: SparkOpts) => {
      const spread = o?.spread ?? 0.8;
      const lifeMean = o?.life ?? 0.65;
      const sizeMul = o?.size ?? 1;
      const dragK = o?.drag ?? 2.2;
      const white = o?.white ?? 0.2;
      const n = Math.min(Math.ceil(count * COUNT_SCALE), 400);
      for (let k = 0; k < n; k++) {
        const i = sys.head;
        sys.head = (sys.head + 1) % MAX;
        // Random direction in a sphere, then biased along `dir`.
        let x = Math.random() * 2 - 1;
        let y = Math.random() * 2 - 1;
        let z = Math.random() * 2 - 1;
        let l = Math.hypot(x, y, z) || 1;
        x = (x / l) * spread;
        y = (y / l) * spread;
        z = (z / l) * spread;
        if (dir) {
          x += dir.x;
          y += dir.y;
          z += dir.z;
        }
        l = Math.hypot(x, y, z) || 1;
        const sp = speed * (0.3 + Math.random() * 0.9);
        const j = i * 3;
        pos[j] = at.x;
        pos[j + 1] = at.y;
        pos[j + 2] = at.z;
        vel[j] = (x / l) * sp;
        vel[j + 1] = (y / l) * sp;
        vel[j + 2] = (z / l) * sp;
        const hotness = Math.random() < white ? 0.6 + Math.random() * 0.4 : 0;
        const tint = 0.8 + Math.random() * 0.6;
        base[j] = (color.r + (1 - color.r) * hotness) * tint * 1.6;
        base[j + 1] = (color.g + (1 - color.g) * hotness) * tint * 1.6;
        base[j + 2] = (color.b + (1 - color.b) * hotness) * tint * 1.6;
        size0[i] = size[i] = 0.085 * sizeMul * (0.55 + Math.random() * 0.9);
        maxLife[i] = life[i] = lifeMean * (0.55 + Math.random() * 0.9);
        drag[i] = dragK;
      }
      sys.alive += n;
    };
    bus.sparks = emit;
    const off = onFx((e) => {
      if (e.kind === 'burst') emit(e.at, e.normal, cssColor(e.color), e.count, e.speed, { white: 0.25 });
    });
    return () => {
      off();
      if (bus.sparks === emit) bus.sparks = null;
      sys.geo.dispose();
      sys.mat.dispose();
    };
  }, [sys]);

  useFrame((_, dtRaw) => {
    sys.mat.uniforms.uScale.value = bus.pointScale;
    if (sys.alive <= 0) return;
    const dt = Math.min(dtRaw, 0.05);
    const { pos, vel, col, base, size, size0, life, maxLife, drag } = sys;
    let alive = 0;
    for (let i = 0; i < MAX; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const j = i * 3;
      if (life[i] <= 0) {
        size[i] = 0;
        col[j] = col[j + 1] = col[j + 2] = 0;
        continue;
      }
      alive++;
      const k = Math.exp(-drag[i] * dt);
      vel[j] *= k;
      vel[j + 1] *= k;
      vel[j + 2] *= k;
      pos[j] += vel[j] * dt;
      pos[j + 1] += vel[j + 1] * dt;
      pos[j + 2] += vel[j + 2] * dt;
      const f = life[i] / maxLife[i];
      const fade = f * f * (3 - 2 * f);
      col[j] = base[j] * fade;
      col[j + 1] = base[j + 1] * fade;
      col[j + 2] = base[j + 2] * fade;
      size[i] = size0[i] * (0.35 + 0.65 * f);
    }
    sys.alive = alive;
    sys.aPos.needsUpdate = true;
    sys.aCol.needsUpdate = true;
    sys.aSize.needsUpdate = true;
  });

  return <primitive object={sys.points} />;
}
