import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three';
import { rng, surgeOn, surfaceRadius, type Vec3 } from '@starforge/shared';
import { hueColor, refs } from '../state/refs';
import { useGame } from '../state/store';
import { damp, hostNow, roundRobin, SEP, setCss, useBundle } from './util';

const MAX_DRONES = 64;
const MAX_HARVESTERS = 12;
const POOL = MAX_DRONES + MAX_HARVESTERS;
const HARVESTER_SCALE = 1.9;
const HULL = new Color('#9fb3c8');
const WHITE = new Color(1, 1, 1);
const Y_UP = new Vector3(0, 1, 0);

/**
 * Orbital drones and harvesters of every online player: one instanced mesh
 * each for hulls, glowing cores and mining beams. Drones show
 * `min(64, Σ levels.drone)`, harvesters (bigger and slower, further out)
 * `min(12, Σ levels.harvester)`, shared round-robin between owners and lit in
 * each owner's hue. Each unit has its own orbit plane, radius and speed and
 * periodically dips toward the surface with a beam. During a resonance surge
 * they all fly faster and beam brighter and more often.
 */
export function Drones() {
  // Hue and fleet size of each online owner, in a stable order.
  const key = useGame((st) => {
    const s = st.s;
    if (!s) return '';
    const out: string[] = [];
    for (const p of Object.values(s.players)) {
      if (p.online && (p.levels.drone > 0 || p.levels.harvester > 0)) out.push(`${p.id} ${p.hue} ${p.levels.drone} ${p.levels.harvester}`);
    }
    return out.sort().join(SEP);
  });
  const seed = useGame((s) => s.s?.seed ?? 1);

  const fleet = useMemo(() => {
    const owners = key ? key.split(SEP).map((row) => row.split(' ').map(Number)) : [];
    const color = owners.map(([, hue]) => setCss(new Color(), hueColor(hue)));
    const drones = roundRobin(owners.map((o) => o[2]), MAX_DRONES);
    const harvesters = roundRobin(owners.map((o) => o[3]), MAX_HARVESTERS);
    return { drones: drones.map((i) => color[i]), harvesters: harvesters.map((i) => color[i]) };
  }, [key]);

  const res = useBundle(
    () => ({
      bodyGeo: new OctahedronGeometry(0.09, 0).scale(1, 0.55, 1.4),
      coreGeo: new SphereGeometry(0.036, 8, 6).scale(1, 0.65, 1.3),
      beamGeo: new CylinderGeometry(1, 1, 1, 6, 1, true),
      bodyMat: new MeshStandardMaterial({ emissive: '#1c2838', metalness: 0.6, roughness: 0.3, flatShading: true }),
      coreMat: new MeshBasicMaterial({ toneMapped: false }),
      beamMat: new MeshBasicMaterial({ transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    }),
    [],
  );

  const meshes = useMemo(() => {
    const bodies = new InstancedMesh(res.bodyGeo, res.bodyMat, POOL);
    const cores = new InstancedMesh(res.coreGeo, res.coreMat, POOL);
    const beams = new InstancedMesh(res.beamGeo, res.beamMat, POOL);
    for (const m of [bodies, cores, beams]) {
      m.instanceColor = new InstancedBufferAttribute(new Float32Array(POOL * 3).fill(1), 3);
      m.frustumCulled = false;
      m.count = 0;
      m.instanceMatrix.setUsage(DynamicDrawUsage);
    }
    return { bodies, cores, beams };
  }, [res]);
  useEffect(
    () => () => {
      for (const m of Object.values(meshes)) m.dispose();
    },
    [meshes],
  );

  // Paint each unit in its owner's hue: a tinted hull, a bright core, a beam a little whiter.
  useEffect(() => {
    const { bodies, cores, beams } = meshes;
    const c = new Color();
    const all = fleet.drones.concat(fleet.harvesters);
    all.forEach((owner, k) => {
      bodies.setColorAt(k, c.copy(HULL).lerp(owner, 0.35));
      cores.setColorAt(k, owner);
      beams.setColorAt(k, c.copy(owner).lerp(WHITE, 0.3));
    });
    for (const m of [bodies, cores, beams]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [fleet, meshes]);

  // Drone orbits first, then harvesters: further out, slower, deeper dips.
  const orbits = useMemo(() => {
    const r = rng(1337);
    return Array.from({ length: POOL }, (_, i) => {
      const big = i >= MAX_DRONES;
      const axis = new Vector3(r() - 0.5, r() * 0.6 + 0.4, r() - 0.5).normalize();
      const ref = new Vector3(1, 0, 0).cross(axis).normalize();
      return {
        axis,
        ref,
        radius: big ? 4.5 + r() * 0.8 : 3.2 + r() * 1.25,
        speed: big ? 0.1 + r() * 0.08 : 0.25 + r() * 0.35,
        dipRate: big ? 0.45 : 0.9,
        dipDepth: big ? 0.9 : 0.45,
        phase: r() * Math.PI * 2,
      };
    });
  }, []);

  const sim = useMemo(
    () => ({
      ang: Float32Array.from(orbits, (o) => o.phase),
      dip: Float32Array.from(orbits, (o) => o.phase * 3),
      mult: 1,
      surge: 0,
    }),
    [orbits],
  );

  const tmp = useMemo(
    () => ({
      m: new Matrix4(),
      core: new Matrix4().makeTranslation(0, 0.04, 0.03),
      out: new Matrix4(),
      q: new Quaternion(),
      p: new Vector3(),
      s: new Vector3(),
      n: new Vector3(),
      mid: new Vector3(),
      local: new Vector3(),
      inv: new Quaternion(),
      d: [0, 0, 0] as Vec3,
    }),
    [],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const st = useGame.getState().s;
    const surge = !!st && surgeOn(st, hostNow());
    sim.surge = damp(sim.surge, surge ? 1 : 0, 3, dt);
    sim.mult = damp(sim.mult, surge ? 2.2 : 1, 2.5, dt);

    const { bodies, cores, beams } = meshes;
    const rock = refs.rock;
    if (rock) tmp.inv.copy(rock.quaternion).invert();
    else tmp.inv.identity();

    res.coreMat.color.setScalar(1.8 + sim.surge * 2.2);
    res.beamMat.color.setScalar(1.2 + sim.surge * 1.6);

    const nd = fleet.drones.length;
    const units = nd + fleet.harvesters.length;
    for (let k = 0; k < units; k++) {
      const big = k >= nd;
      const i = big ? MAX_DRONES + (k - nd) : k;
      const o = orbits[i];
      sim.ang[i] += dt * o.speed * sim.mult;
      sim.dip[i] += dt * o.dipRate * (1 + sim.surge * 1.3);
      const dip = Math.pow(Math.max(0, Math.sin(sim.dip[i])), 8 - sim.surge * 4);
      const rad = o.radius - dip * o.dipDepth;
      tmp.p.copy(o.ref).applyAxisAngle(o.axis, sim.ang[i]).multiplyScalar(rad);
      tmp.n.copy(tmp.p).normalize();
      // Belly toward the rock.
      tmp.q.setFromUnitVectors(Y_UP, tmp.n);
      const sc = big ? HARVESTER_SCALE : 1;
      tmp.m.compose(tmp.p, tmp.q, tmp.s.set(sc, sc, sc));
      bodies.setMatrixAt(k, tmp.m);
      cores.setMatrixAt(k, tmp.out.multiplyMatrices(tmp.m, tmp.core));

      // Beam from the unit down to the actual surface under it.
      tmp.local.copy(tmp.n).applyQuaternion(tmp.inv);
      tmp.d[0] = tmp.local.x;
      tmp.d[1] = tmp.local.y;
      tmp.d[2] = tmp.local.z;
      const surf = surfaceRadius(tmp.d, seed);
      const len = Math.max(0.01, rad - surf);
      tmp.mid.copy(tmp.n).multiplyScalar(rad - len / 2);
      const width = (big ? 0.024 : 0.012) * (1 + sim.surge * 1.4);
      const w = dip > 0.02 ? width * Math.min(1, dip * 1.5) : 0;
      tmp.m.compose(tmp.mid, tmp.q, tmp.s.set(w, len, w));
      beams.setMatrixAt(k, tmp.m);
    }

    bodies.count = cores.count = beams.count = units;
    bodies.instanceMatrix.needsUpdate = true;
    cores.instanceMatrix.needsUpdate = true;
    beams.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <primitive object={meshes.bodies} />
      <primitive object={meshes.cores} />
      <primitive object={meshes.beams} />
    </>
  );
}
