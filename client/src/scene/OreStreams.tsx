import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial, Vector3 } from 'three';
import { MACHINE_DEFS, MACHINES, RESOURCE_DEFS, type MachineId, type RoomState } from '@starforge/shared';
import { useGame } from '../state/store';
import { bus } from './bus';
import { STATION_POS, machineIntake } from './layout';
import { buffActive, damp, hostNow } from './util';

const MAX = 180;

const VERT = /* glsl */ `
attribute float aOff;
attribute vec3 aJit;
uniform float uProg;
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform float uSize;
uniform float uScale;
uniform float uAlpha;
varying float vA;
void main() {
  float t = fract(aOff + uProg);
  float u = 1.0 - t;
  vec3 p = u * u * uP0 + 2.0 * u * t * uP1 + t * t * uP2;
  float w = sin(t * 11.0 + aOff * 40.0 + uProg * 7.0);
  p += aJit * (0.6 + 0.4 * w) * sin(t * 3.14159);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float ends = smoothstep(0.0, 0.07, t) * smoothstep(1.0, 0.9, t);
  vA = ends * uAlpha;
  gl_PointSize = uSize * uScale / max(0.05, -mv.z) * (0.55 + 0.45 * ends);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0 || vA <= 0.001) discard;
  float a = exp(-d * 3.5) * (1.0 - d) + exp(-d * 18.0);
  gl_FragColor = vec4(uColor * a * vA, 1.0);
}
`;

interface StreamSpec {
  key: string;
  from: Vector3;
  to: Vector3;
  arc: number;
  color: Color;
  size: number;
  /** Particles to show (0 = off). Called every frame with the room state. */
  density: (s: RoomState) => number;
  speed: number;
  jitter: number;
}

function smelterDensity(s: RoomState): number {
  if (s.levels.smelter <= 0 || !s.machinesOn.smelter) return 0;
  const flow = Math.max(s.rates.alloy, s.wallet.ore >= 10 ? s.levels.smelter * 0.6 : 0);
  if (flow <= 0 && s.wallet.ore < 1) return 10;
  return Math.max(24, Math.min(MAX, 24 + flow * 14));
}

function linkDensity(a: MachineId, b: MachineId) {
  return (s: RoomState): number => {
    if (s.levels[a] <= 0 || s.levels[b] <= 0 || !s.machinesOn[b]) return 0;
    const def = MACHINE_DEFS[b];
    const flow = Math.max(s.rates[def.output], 0) * def.ratio;
    return s.wallet[def.input] >= def.ratio * 0.05 ? Math.max(12, Math.min(70, 12 + flow * 4)) : 6;
  };
}

/**
 * Glowing material flowing along arcs: ore from the asteroid to the smelter,
 * and fainter streams between consecutive built machines in their input
 * colour. Positions are computed in the vertex shader from a quadratic
 * Bézier, so each stream costs a few uniforms per frame.
 */
export function OreStreams() {
  const specs = useMemo<StreamSpec[]>(() => {
    const out: StreamSpec[] = [];
    const toStation = STATION_POS.clone().normalize();
    out.push({
      key: 'rock',
      from: toStation.clone().multiplyScalar(2.35),
      to: machineIntake('smelter', new Vector3()),
      arc: 2.4,
      color: new Color(RESOURCE_DEFS.ore.color).multiplyScalar(2.2),
      size: 0.08,
      density: smelterDensity,
      speed: 0.34,
      jitter: 0.12,
    });
    for (let i = 0; i < MACHINES.length - 1; i++) {
      const a = MACHINES[i];
      const b = MACHINES[i + 1];
      out.push({
        key: `${a}-${b}`,
        from: machineIntake(a, new Vector3()),
        to: machineIntake(b, new Vector3()),
        arc: 0.9,
        color: new Color(RESOURCE_DEFS[MACHINE_DEFS[b].input].color).multiplyScalar(1.4),
        size: 0.055,
        density: linkDensity(a, b),
        speed: 0.45,
        jitter: 0.05,
      });
    }
    return out;
  }, []);

  return (
    <>
      {specs.map((sp) => (
        <Stream key={sp.key} spec={sp} />
      ))}
    </>
  );
}

function Stream({ spec }: { spec: StreamSpec }) {
  const sys = useMemo(() => {
    const geo = new BufferGeometry();
    const pos = new Float32Array(MAX * 3);
    const off = new Float32Array(MAX);
    const jit = new Float32Array(MAX * 3);
    for (let i = 0; i < MAX; i++) {
      // Low-discrepancy offsets: any prefix of the buffer is evenly spread.
      off[i] = (i * 0.6180339887) % 1;
      jit[i * 3] = (Math.random() - 0.5) * 2 * spec.jitter;
      jit[i * 3 + 1] = (Math.random() - 0.5) * 2 * spec.jitter;
      jit[i * 3 + 2] = (Math.random() - 0.5) * 2 * spec.jitter;
    }
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('aOff', new BufferAttribute(off, 1));
    geo.setAttribute('aJit', new BufferAttribute(jit, 3));
    geo.setDrawRange(0, 0);
    const mid = spec.from.clone().lerp(spec.to, 0.5);
    mid.y += spec.arc;
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uProg: { value: 0 },
        uP0: { value: spec.from },
        uP1: { value: mid },
        uP2: { value: spec.to },
        uSize: { value: spec.size },
        uScale: { value: 800 },
        uAlpha: { value: 0 },
        uColor: { value: spec.color },
      },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geo, mat);
    points.frustumCulled = false;
    points.visible = false;
    return { geo, mat, points, alpha: 0, count: 0 };
  }, [spec]);

  useEffect(
    () => () => {
      sys.geo.dispose();
      sys.mat.dispose();
    },
    [sys],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = useGame.getState().s;
    const want = s ? spec.density(s) : 0;
    sys.alpha = damp(sys.alpha, want > 0 ? 1 : 0, 2.5, dt);
    if (want > 0) sys.count = damp(sys.count, want, 2, dt);
    const solar = s && buffActive(s, 'solar', hostNow()) ? 1.6 : 1;
    const u = sys.mat.uniforms;
    u.uProg.value = (u.uProg.value + dt * spec.speed * solar) % 1000;
    u.uAlpha.value = sys.alpha;
    u.uScale.value = bus.pointScale;
    sys.points.visible = sys.alpha > 0.01;
    sys.geo.setDrawRange(0, Math.round(sys.count));
  });

  return <primitive object={sys.points} />;
}
