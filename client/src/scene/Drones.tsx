import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { rng } from '@starforge/shared';
import { useGame } from '../state/store';

const MAX_VISIBLE = 64;

/**
 * Orbital drones: one instanced mesh, one draw call. Each drone has its own
 * orbit plane, radius and speed, and periodically dips toward the surface
 * with a short mining beam so passive income reads as visible activity.
 */
export function Drones() {
  const count = useGame((s) => Math.min(MAX_VISIBLE, s.levels.drone));
  const bodies = useRef<THREE.InstancedMesh>(null!);
  const beams = useRef<THREE.InstancedMesh>(null!);

  const orbits = useMemo(() => {
    const r = rng(1337);
    return Array.from({ length: MAX_VISIBLE }, () => {
      const axis = new THREE.Vector3(r() - 0.5, r() * 0.6 + 0.4, r() - 0.5).normalize();
      const ref = new THREE.Vector3(1, 0, 0).cross(axis).normalize();
      return { axis, ref, radius: 3.0 + r() * 1.3, speed: 0.25 + r() * 0.35, phase: r() * Math.PI * 2 };
    });
  }, []);

  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const o = orbits[i];
      const ang = t * o.speed + o.phase;
      const dip = Math.max(0, Math.sin(t * 0.9 + o.phase * 3)) ** 8; // short dives toward the rock
      const rad = o.radius - dip * 0.5;
      p.copy(o.ref).applyAxisAngle(o.axis, ang).multiplyScalar(rad);
      q.setFromUnitVectors(up, p.clone().normalize());
      m.compose(p, q, s.set(1, 1, 1));
      bodies.current.setMatrixAt(i, m);

      // Beam from drone to the surface while it is diving.
      const beamLen = rad - 2.1;
      const mid = p.clone().multiplyScalar((rad - beamLen / 2) / rad);
      m.compose(mid, q, s.set(dip, beamLen, dip));
      beams.current.setMatrixAt(i, m);
    }
    bodies.current.count = count;
    beams.current.count = count;
    bodies.current.instanceMatrix.needsUpdate = true;
    beams.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={bodies} args={[undefined, undefined, MAX_VISIBLE]} frustumCulled={false}>
        <octahedronGeometry args={[0.09, 0]} />
        <meshStandardMaterial color="#9fb3c8" emissive="#4de8ff" emissiveIntensity={2} metalness={0.6} roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={beams} args={[undefined, undefined, MAX_VISIBLE]} frustumCulled={false}>
        <cylinderGeometry args={[0.012, 0.012, 1, 5, 1, true]} />
        <meshBasicMaterial color="#4de8ff" transparent opacity={0.8} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </>
  );
}
