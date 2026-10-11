import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { rng, surfacePoint, surfaceRadius, type Seam, type Vec3 } from '@starforge/shared';
import { rockRef, type Authority } from '../net/authority';
import { onFx } from '../state/fx';
import { useGame } from '../state/store';

/** Build the rock mesh by pushing icosphere vertices out to the shared surface function. */
function useAsteroidGeometry(seed: number) {
  return useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, 6);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const r = rng(seed ^ 0xc0102);
    const base = new THREE.Color('#4a3a2e');
    const dark = new THREE.Color('#1c1612');
    const tmp = new THREE.Color();
    const d: Vec3 = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).normalize();
      d[0] = v.x;
      d[1] = v.y;
      d[2] = v.z;
      const rad = surfaceRadius(d, seed);
      pos.setXYZ(i, v.x * rad, v.y * rad, v.z * rad);
      // Darker in the valleys, plus per-vertex grit.
      const t = THREE.MathUtils.clamp((rad - 1.9) / 0.6, 0, 1);
      tmp.copy(dark).lerp(base, t * 0.8 + r() * 0.2);
      tmp.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [seed]);
}

const SEAM_COLOR = new THREE.Color('#ffb03a');
const Y_UP = new THREE.Vector3(0, 1, 0);

function SeamCrystal({ seam, seed, auth }: { seam: Seam; seed: number; auth: Authority }) {
  const group = useRef<THREE.Group>(null!);
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#3a1d00', emissive: SEAM_COLOR, emissiveIntensity: 3, roughness: 0.25, metalness: 0.1 }),
    [],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  const light = useRef<THREE.PointLight>(null!);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  const { position, quaternion, shards } = useMemo(() => {
    const p = new THREE.Vector3(...surfacePoint(seam.dir, seed)).multiplyScalar(0.97);
    const q = new THREE.Quaternion().setFromUnitVectors(Y_UP, new THREE.Vector3(...seam.dir));
    const r = rng(seam.id * 9973);
    const shards = Array.from({ length: 5 }, () => ({
      pos: [(r() - 0.5) * 0.35, r() * 0.05, (r() - 0.5) * 0.35] as Vec3,
      rot: [(r() - 0.5) * 0.9, r() * Math.PI, (r() - 0.5) * 0.9] as Vec3,
      scale: [0.08 + r() * 0.06, 0.22 + r() * 0.25, 0.08 + r() * 0.06] as Vec3,
    }));
    return { position: p, quaternion: q, shards };
  }, [seam.id, seam.dir, seed]);

  const health = seam.hp / seam.maxHp;

  useFrame(({ clock }) => {
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 3 + phase);
    mat.emissiveIntensity = 2.2 + pulse * 2.5;
    light.current.intensity = 2 + pulse * 3;
    const s = THREE.MathUtils.lerp(group.current.scale.x, 0.45 + 0.55 * health, 0.15);
    group.current.scale.setScalar(s);
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const n = e.face ? e.face.normal.clone().transformDirection(e.object.matrixWorld) : e.point.clone().normalize();
    auth.strike(seam.id, e.point, n);
  };

  return (
    <group position={position} quaternion={quaternion}>
      <group ref={group} onPointerDown={onDown}>
        {shards.map((s, i) => (
          <mesh key={i} position={s.pos} rotation={s.rot} scale={s.scale} material={mat}>
            <octahedronGeometry args={[1, 0]} />
          </mesh>
        ))}
        {/* Invisible, generous hit target so seams are easy to tap on mobile. */}
        <mesh visible={false}>
          <sphereGeometry args={[0.38, 8, 8]} />
        </mesh>
      </group>
      <pointLight ref={light} color={SEAM_COLOR} distance={2.2} decay={2} position={[0, 0.35, 0]} />
    </group>
  );
}

export function Asteroid({ auth }: { auth: Authority }) {
  const seed = useGame((s) => s.seed);
  const seams = useGame((s) => s.seams);
  const geo = useAsteroidGeometry(seed);
  const spin = useRef<THREE.Group>(null!);
  const kick = useRef(0);

  useEffect(() => {
    rockRef.current = spin.current;
    const off = onFx((e) => {
      if (e.kind === 'burst') kick.current = Math.min(1, kick.current + 0.35);
    });
    return () => {
      off();
      rockRef.current = null;
    };
  }, []);

  useFrame((_, dt) => {
    spin.current.rotation.y += dt * 0.06;
    spin.current.rotation.x += dt * 0.015;
    kick.current = Math.max(0, kick.current - dt * 5);
    // Squash-and-recover "thunk" on every hit.
    spin.current.scale.setScalar(1 - kick.current * 0.035);
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const n = e.face ? e.face.normal.clone().transformDirection(e.object.matrixWorld) : e.point.clone().normalize();
    auth.strike(null, e.point, n);
  };

  return (
    <group ref={spin}>
      <mesh geometry={geo} onPointerDown={onDown} castShadow receiveShadow>
        <meshStandardMaterial vertexColors flatShading roughness={0.92} metalness={0.05} />
      </mesh>
      {seams.map((s) => (
        <SeamCrystal key={s.id} seam={s} seed={seed} auth={auth} />
      ))}
    </group>
  );
}
