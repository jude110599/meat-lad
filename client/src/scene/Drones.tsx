import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { rng, surfaceRadius, type Vec3 } from '@starforge/shared';
import { refs } from '../state/refs';
import { useGame } from '../state/store';
import { sparks } from './bus';
import { buffActive, damp, hostNow, useBundle } from './util';

const MAX_VISIBLE = 64;
const CYAN = new Color('#4de8ff');
const SURGE = new Color('#9ff6ff');
const SPARK = new Color('#bfefff');
const Y_UP = new Vector3(0, 1, 0);

/**
 * Orbital drones: one instanced body mesh and one instanced beam mesh. Each
 * drone has its own orbit plane, radius and speed and periodically dips toward
 * the surface with a mining beam. Drone Surge = faster, brighter, more beams;
 * Drones Down = dark, drifting, tumbling and sparking.
 */
export function Drones() {
  const count = useGame((s) => Math.min(MAX_VISIBLE, s.s?.levels.drone ?? 0));
  const seed = useGame((s) => s.s?.seed ?? 1);

  const res = useBundle(
    () => ({
      bodyGeo: new OctahedronGeometry(0.09, 0).scale(1, 0.55, 1.4),
      beamGeo: new CylinderGeometry(1, 1, 1, 6, 1, true),
      bodyMat: new MeshStandardMaterial({ color: '#9fb3c8', emissive: CYAN, emissiveIntensity: 1.8, metalness: 0.6, roughness: 0.3, flatShading: true }),
      beamMat: new MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    }),
    [],
  );

  const meshes = useMemo(() => {
    const bodies = new InstancedMesh(res.bodyGeo, res.bodyMat, MAX_VISIBLE);
    const beams = new InstancedMesh(res.beamGeo, res.beamMat, MAX_VISIBLE);
    for (const m of [bodies, beams]) {
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(DynamicDrawUsage);
    }
    return { bodies, beams };
  }, [res]);
  useEffect(
    () => () => {
      meshes.bodies.dispose();
      meshes.beams.dispose();
    },
    [meshes],
  );

  const orbits = useMemo(() => {
    const r = rng(1337);
    return Array.from({ length: MAX_VISIBLE }, () => {
      const axis = new Vector3(r() - 0.5, r() * 0.6 + 0.4, r() - 0.5).normalize();
      const ref = new Vector3(1, 0, 0).cross(axis).normalize();
      return { axis, ref, radius: 3.2 + r() * 1.25, speed: 0.25 + r() * 0.35, phase: r() * Math.PI * 2 };
    });
  }, []);

  const sim = useMemo(
    () => ({
      ang: Float32Array.from(orbits, (o) => o.phase),
      dip: Float32Array.from(orbits, (o) => o.phase * 3),
      tumble: new Float32Array(MAX_VISIBLE),
      mult: 1,
      surge: 0,
      down: 0,
    }),
    [orbits],
  );

  const tmp = useMemo(
    () => ({
      m: new Matrix4(),
      q: new Quaternion(),
      q2: new Quaternion(),
      p: new Vector3(),
      s: new Vector3(),
      n: new Vector3(),
      tangent: new Vector3(),
      mid: new Vector3(),
      local: new Vector3(),
      inv: new Quaternion(),
      d: [0, 0, 0] as Vec3,
      c: new Color(),
    }),
    [],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = useGame.getState().s;
    const now = hostNow();
    const surge = !!st && buffActive(st, 'droneSurge', now);
    const down = !!st && buffActive(st, 'dronesDown', now);
    sim.surge = damp(sim.surge, surge ? 1 : 0, 3, dt);
    sim.down = damp(sim.down, down ? 1 : 0, 2.5, dt);
    sim.mult = damp(sim.mult, down ? 0.08 : surge ? 2.2 : 1, down ? 0.8 : 2.5, dt);

    const { bodies, beams } = meshes;
    const rock = refs.rock;
    if (rock) tmp.inv.copy(rock.quaternion).invert();
    else tmp.inv.identity();

    res.bodyMat.emissiveIntensity = (1.8 + sim.surge * 2.4) * (1 - sim.down) + sim.down * (Math.random() < 0.04 ? 2 : 0);
    tmp.c.copy(CYAN).lerp(SURGE, sim.surge).multiplyScalar(1 + sim.surge * 1.6);
    res.beamMat.color.copy(tmp.c);
    const beamOn = 1 - sim.down;
    const width = 0.012 * (1 + sim.surge * 1.4);

    for (let i = 0; i < count; i++) {
      const o = orbits[i];
      sim.ang[i] += dt * o.speed * sim.mult;
      sim.dip[i] += dt * 0.9 * (1 + sim.surge * 1.3) * Math.max(0.2, sim.mult);
      const dip = Math.pow(Math.max(0, Math.sin(sim.dip[i])), 8 - sim.surge * 4) * beamOn;
      const rad = o.radius - dip * 0.45 + sim.down * 0.25;
      tmp.p.copy(o.ref).applyAxisAngle(o.axis, sim.ang[i]).multiplyScalar(rad);
      tmp.n.copy(tmp.p).normalize();
      // Face along the orbit, belly toward the rock; tumble when the drones are fried.
      tmp.tangent.copy(o.axis).cross(tmp.n).normalize();
      tmp.q.setFromUnitVectors(Y_UP, tmp.n);
      if (sim.down > 0.01) {
        sim.tumble[i] += dt * (1.5 + (i % 5)) * sim.down;
        tmp.q2.setFromAxisAngle(tmp.tangent, sim.tumble[i]);
        tmp.q.premultiply(tmp.q2);
      }
      tmp.m.compose(tmp.p, tmp.q, tmp.s.set(1, 1, 1));
      bodies.setMatrixAt(i, tmp.m);

      // Beam from the drone down to the actual surface under it.
      tmp.local.copy(tmp.n).applyQuaternion(tmp.inv);
      tmp.d[0] = tmp.local.x;
      tmp.d[1] = tmp.local.y;
      tmp.d[2] = tmp.local.z;
      const surf = surfaceRadius(tmp.d, seed);
      const len = Math.max(0.01, rad - surf);
      tmp.mid.copy(tmp.n).multiplyScalar(rad - len / 2);
      tmp.q.setFromUnitVectors(Y_UP, tmp.n);
      const w = dip > 0.02 ? width * Math.min(1, dip * 1.5) : 0;
      tmp.m.compose(tmp.mid, tmp.q, tmp.s.set(w, len, w));
      beams.setMatrixAt(i, tmp.m);
    }

    // Fried drones spit sparks.
    if (sim.down > 0.5 && count > 0 && Math.random() < dt * Math.min(12, 2 + count * 0.4)) {
      const i = (Math.random() * count) | 0;
      bodies.getMatrixAt(i, tmp.m);
      tmp.p.setFromMatrixPosition(tmp.m);
      sparks(tmp.p, null, SPARK, 6, 1.6, { spread: 1, life: 0.35, size: 0.6, white: 0.6 });
    }

    bodies.count = count;
    beams.count = count;
    bodies.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={meshes.bodies} />
      <primitive object={meshes.beams} />
    </>
  );
}
