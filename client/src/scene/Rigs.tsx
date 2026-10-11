import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Group,
} from 'three';
import { surfacePoint } from '@starforge/shared';
import { hueColor } from '../state/refs';
import { useGame } from '../state/store';
import { sparks } from './bus';
import { roundRobin, SEP, setCss, useBundle } from './util';

const MAX_RIGS = 16;
const Y_UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const SPARK = new Color('#ffb860');

/**
 * Auto-Rigs: `min(16, Σ levels.rig)` over online players, tripod drills
 * standing around the seams, shared round-robin between owners. Each rig's
 * work light glows in its owner's hue.
 */
export function Rigs() {
  const key = useGame((st) => {
    const s = st.s;
    if (!s) return '';
    const out: string[] = [];
    for (const p of Object.values(s.players)) if (p.online && p.levels.rig > 0) out.push(`${p.id} ${p.hue} ${p.levels.rig}`);
    return out.sort().join(SEP);
  });
  const seamKey = useGame((st) => (st.s ? st.s.seams.map((x) => x.id).join(SEP) : ''));
  const seed = useGame((st) => st.s?.seed ?? 1);
  const lights = useMemo(() => {
    const owners = key ? key.split(SEP).map((row) => row.split(' ').map(Number)) : [];
    const color = owners.map(([, hue]) => setCss(new Color(), hueColor(hue, 66)));
    return roundRobin(owners.map((o) => o[2]), MAX_RIGS).map((i) => color[i]);
  }, [key]);
  if (lights.length <= 0 || !seamKey) return null;
  return <RigField count={lights.length} lights={lights} seamKey={seamKey} seed={seed} />;
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function RigField({ count, lights, seamKey, seed }: { count: number; lights: Color[]; seamKey: string; seed: number }) {
  const res = useBundle(
    () => ({
      legGeo: new CylinderGeometry(0.011, 0.016, 1, 5).translate(0, 0.5, 0),
      bodyGeo: new CylinderGeometry(0.075, 0.09, 0.12, 6),
      bitGeo: new ConeGeometry(0.045, 0.2, 7),
      lightGeo: new SphereGeometry(0.028, 8, 6),
      bodyMat: new MeshStandardMaterial({ color: '#c99530', metalness: 0.45, roughness: 0.42, flatShading: true }),
      legMat: new MeshStandardMaterial({ color: '#5a616d', metalness: 0.75, roughness: 0.35 }),
      bitMat: new MeshStandardMaterial({ color: '#d8dde6', metalness: 0.9, roughness: 0.25, emissive: '#ff6a1a', emissiveIntensity: 0.7, flatShading: true }),
      lightMat: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
    }),
    [],
  );

  const meshes = useMemo(() => {
    const body = new InstancedMesh(res.bodyGeo, res.bodyMat, MAX_RIGS);
    const legs = new InstancedMesh(res.legGeo, res.legMat, MAX_RIGS * 3);
    const bit = new InstancedMesh(res.bitGeo, res.bitMat, MAX_RIGS);
    const light = new InstancedMesh(res.lightGeo, res.lightMat, MAX_RIGS);
    light.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX_RIGS * 3), 3).setUsage(DynamicDrawUsage);
    for (const m of [body, legs, bit, light]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(DynamicDrawUsage);
    }
    return { body, legs, bit, light };
  }, [res]);
  useEffect(
    () => () => {
      for (const m of Object.values(meshes)) m.dispose();
    },
    [meshes],
  );

  // Fixed part transforms in rig space (up = +Y, feet on the ground at y=0).
  const legLocal = useMemo(() => {
    const out: Matrix4[] = [];
    const foot = new Vector3();
    const attach = new Vector3();
    const dir = new Vector3();
    const q = new Quaternion();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
      foot.set(Math.cos(a) * 0.21, 0, Math.sin(a) * 0.21);
      attach.set(Math.cos(a) * 0.06, 0.24, Math.sin(a) * 0.06);
      dir.copy(attach).sub(foot);
      const len = dir.length();
      q.setFromUnitVectors(Y_UP, dir.normalize());
      out.push(new Matrix4().compose(foot, q, new Vector3(1, len, 1)));
    }
    return out;
  }, []);

  // Where each rig stands: rig i on seam i % seams, spread around that seam.
  const targets = useMemo(() => {
    const seams = useGame.getState().s?.seams ?? [];
    const S = seams.length;
    const out: { p: Vector3; q: Quaternion }[] = [];
    const n = new Vector3();
    const t1 = new Vector3();
    const t2 = new Vector3();
    const d = new Vector3();
    for (let i = 0; i < count && S > 0; i++) {
      const j = i % S;
      const k = Math.floor(i / S);
      const m = Math.floor((count - 1 - j) / S) + 1;
      n.set(...seams[j].dir).normalize();
      t1.crossVectors(n, Math.abs(n.y) < 0.9 ? Y_UP : X_AXIS).normalize();
      t2.crossVectors(n, t1);
      const ang = (k / m) * Math.PI * 2 + j * 1.3;
      d.copy(n)
        .multiplyScalar(2.2)
        .addScaledVector(t1, Math.cos(ang) * 0.52)
        .addScaledVector(t2, Math.sin(ang) * 0.52)
        .normalize();
      const p = new Vector3(...surfacePoint([d.x, d.y, d.z], seed)).addScaledVector(d, -0.02);
      out.push({ p, q: new Quaternion().setFromUnitVectors(Y_UP, d) });
    }
    return out;
    // seamKey changes whenever a seam is replaced
  }, [count, seamKey, seed]);

  const state = useMemo(
    () => ({
      pos: Array.from({ length: MAX_RIGS }, () => new Vector3()),
      quat: Array.from({ length: MAX_RIGS }, () => new Quaternion()),
      placed: new Uint8Array(MAX_RIGS),
      pop: new Float32Array(MAX_RIGS),
      spin: new Float32Array(MAX_RIGS),
      nextSpark: new Float32Array(MAX_RIGS),
    }),
    [],
  );
  const tmp = useMemo(
    () => ({
      rig: new Matrix4(),
      local: new Matrix4(),
      out: new Matrix4(),
      q: new Quaternion(),
      qFlip: new Quaternion().setFromAxisAngle(X_AXIS, Math.PI),
      v: new Vector3(),
      s: new Vector3(),
      up: new Vector3(),
      c: new Color(),
    }),
    [],
  );
  const group = useRef<Group>(null!);

  useFrame((frame, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = frame.clock.elapsedTime;
    const n = targets.length;
    const { body, legs, bit, light } = meshes;
    for (let r = 0; r < n; r++) {
      const tg = targets[r];
      if (!state.placed[r] || state.pos[r].distanceToSquared(tg.p) > 0.0025) {
        state.pos[r].copy(tg.p);
        state.quat[r].copy(tg.q);
        state.placed[r] = 1;
        state.pop[r] = 0;
        state.nextSpark[r] = t + 0.6 + Math.random();
      }
      state.pop[r] = Math.min(1, state.pop[r] + dt * 2.2);
      const sc = Math.max(0.001, easeOutBack(state.pop[r]));
      tmp.rig.compose(state.pos[r], state.quat[r], tmp.s.set(sc, sc, sc));

      const vib = Math.sin(t * 60 + r * 3.1) * 0.004;
      tmp.local.makeTranslation(0, 0.27 + vib, 0);
      body.setMatrixAt(r, tmp.out.multiplyMatrices(tmp.rig, tmp.local));

      for (let k = 0; k < 3; k++) legs.setMatrixAt(r * 3 + k, tmp.out.multiplyMatrices(tmp.rig, legLocal[k]));

      state.spin[r] += dt * 24;
      tmp.q.setFromAxisAngle(Y_UP, state.spin[r]).multiply(tmp.qFlip);
      tmp.local.compose(tmp.v.set(0, 0.12 + vib, 0), tmp.q, tmp.s.set(1, 1, 1));
      bit.setMatrixAt(r, tmp.out.multiplyMatrices(tmp.rig, tmp.local));

      tmp.local.makeTranslation(0, 0.37, 0);
      light.setMatrixAt(r, tmp.out.multiplyMatrices(tmp.rig, tmp.local));
      const pulse = 0.5 + 0.5 * Math.sin(t * 4.2 + r * 1.7);
      tmp.c.copy(lights[r] ?? SPARK).multiplyScalar(1.2 + pulse * 2.6);
      light.setColorAt(r, tmp.c);

      if (t >= state.nextSpark[r] && state.pop[r] >= 1) {
        state.nextSpark[r] = t + 0.5 + Math.random() * 1.4;
        const g = group.current;
        tmp.v.set(0, 0.03, 0).applyMatrix4(tmp.rig).applyMatrix4(g.matrixWorld);
        tmp.up.copy(Y_UP).transformDirection(tmp.rig).transformDirection(g.matrixWorld);
        sparks(tmp.v, tmp.up, SPARK, 4 + ((Math.random() * 4) | 0), 2.2, { spread: 1.3, life: 0.4, size: 0.7, white: 0.4 });
      }
    }
    body.count = bit.count = light.count = n;
    legs.count = n * 3;
    body.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
    bit.instanceMatrix.needsUpdate = true;
    light.instanceMatrix.needsUpdate = true;
    if (light.instanceColor) light.instanceColor.needsUpdate = true;
  });

  return (
    <group ref={group}>
      <primitive object={meshes.legs} />
      <primitive object={meshes.body} />
      <primitive object={meshes.bit} />
      <primitive object={meshes.light} />
    </group>
  );
}
