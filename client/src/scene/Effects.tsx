import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { onFx } from '../state/fx';

const MAX_PARTICLES = 3000;

/**
 * One pooled THREE.Points cloud for every spark and ore chip in the scene.
 * Bursts write into a ring buffer, so spawning is allocation-free and the
 * GPU draws all particles in a single call.
 */
export function Particles() {
  const { geo, pos, vel, col, base, life, maxLife } = useMemo(() => {
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const col = new Float32Array(MAX_PARTICLES * 3);
    const base = new Float32Array(MAX_PARTICLES * 3);
    const vel = new Float32Array(MAX_PARTICLES * 3);
    const life = new Float32Array(MAX_PARTICLES);
    const maxLife = new Float32Array(MAX_PARTICLES).fill(1);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    pos.fill(9999);
    return { geo, pos, vel, col, base, life, maxLife };
  }, []);
  const head = useRef(0);
  const sprite = useMemo(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }, []);

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind !== 'burst') return;
        const c = new THREE.Color(e.color);
        const dir = new THREE.Vector3();
        for (let n = 0; n < e.count; n++) {
          const i = head.current;
          head.current = (head.current + 1) % MAX_PARTICLES;
          // Cone around the surface normal, biased outward.
          dir.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.8).add(e.normal).normalize();
          const sp = e.speed * (0.3 + Math.random() * 0.9);
          pos[i * 3] = e.at.x;
          pos[i * 3 + 1] = e.at.y;
          pos[i * 3 + 2] = e.at.z;
          vel[i * 3] = dir.x * sp;
          vel[i * 3 + 1] = dir.y * sp;
          vel[i * 3 + 2] = dir.z * sp;
          const tint = 0.75 + Math.random() * 0.5;
          base[i * 3] = c.r * tint;
          base[i * 3 + 1] = c.g * tint;
          base[i * 3 + 2] = c.b * tint;
          maxLife[i] = life[i] = 0.5 + Math.random() * 0.7;
        }
      }),
    [pos, vel, base, life, maxLife],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        pos[i * 3] = pos[i * 3 + 1] = pos[i * 3 + 2] = 9999;
        continue;
      }
      vel[i * 3] *= drag;
      vel[i * 3 + 1] *= drag;
      vel[i * 3 + 2] *= drag;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      // Additive blending: fading the colour toward black fades the spark out.
      const fade = life[i] / maxLife[i];
      col[i * 3] = base[i * 3] * fade;
      col[i * 3 + 1] = base[i * 3 + 1] * fade;
      col[i * 3 + 2] = base[i * 3 + 2] * fade;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  });

  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial
        size={0.09}
        map={sprite}
        vertexColors
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        toneMapped={false}
      />
    </points>
  );
}

/** Laser burst from the player's rig (bottom-right of the view) to the strike point. */
export function Laser() {
  const mesh = useRef<THREE.Mesh>(null!);
  const mat = useRef<THREE.MeshBasicMaterial>(null!);
  const t = useRef(0);
  const target = useRef(new THREE.Vector3());
  const { camera } = useThree();
  const from = useMemo(() => new THREE.Vector3(), []);
  const mid = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind === 'laser') {
          target.current.copy(e.to);
          t.current = 1;
        }
      }),
    [],
  );

  useFrame((_, dt) => {
    t.current = Math.max(0, t.current - dt * 8);
    mesh.current.visible = t.current > 0;
    if (!mesh.current.visible) return;
    from.set(0.9, -0.7, -1.2);
    camera.localToWorld(from);
    const len = from.distanceTo(target.current);
    mid.copy(from).add(target.current).multiplyScalar(0.5);
    mesh.current.position.copy(mid);
    mesh.current.quaternion.setFromUnitVectors(up, target.current.clone().sub(from).normalize());
    mesh.current.scale.set(t.current, len, t.current);
    mat.current.opacity = t.current;
  });

  return (
    <mesh ref={mesh} visible={false}>
      <cylinderGeometry args={[0.025, 0.025, 1, 6, 1, true]} />
      <meshBasicMaterial ref={mat} color="#7cf0ff" transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

interface Floater {
  id: number;
  at: THREE.Vector3;
  text: string;
  color: string;
  big: boolean;
}

/** Floating "+12" yield numbers, anchored in 3D and rendered as DOM for crisp text. */
export function Floaters() {
  const [items, setItems] = useState<Floater[]>([]);
  const nextId = useRef(0);

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind !== 'float') return;
        const f = { id: nextId.current++, at: e.at, text: e.text, color: e.color, big: e.big };
        setItems((xs) => [...xs.slice(-14), f]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== f.id)), 900);
      }),
    [],
  );

  return (
    <>
      {items.map((f) => (
        <Html key={f.id} position={f.at} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div className={'floater' + (f.big ? ' big' : '')} style={{ color: f.color }}>
            {f.text}
          </div>
        </Html>
      ))}
    </>
  );
}

/** Decaying camera shake on crits and seam depletions. */
export function CameraShake() {
  const amount = useRef(0);
  const offset = useMemo(() => new THREE.Vector3(), []);
  useEffect(
    () =>
      onFx((e) => {
        if (e.kind === 'shake') amount.current = Math.min(0.4, amount.current + e.strength);
      }),
    [],
  );
  useFrame(({ camera }, dt) => {
    camera.position.sub(offset);
    amount.current = Math.max(0, amount.current - dt * 1.6);
    const a = amount.current * amount.current;
    offset.set((Math.random() - 0.5) * a, (Math.random() - 0.5) * a, 0);
    camera.position.add(offset);
  });
  return null;
}
