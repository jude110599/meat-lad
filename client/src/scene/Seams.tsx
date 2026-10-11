import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type BufferGeometry,
  type Group,
} from 'three';
import { RESOURCE_DEFS, rng, surgeOn, surfacePoint } from '@starforge/shared';
import { act } from '../net/actions';
import { useGame } from '../state/store';
import { crystalGeometry } from './geometry';
import { byId, damp, glowTexture, hostNow, SEP, splitIds, tapOk, useBundle } from './util';

const ORE = new Color(RESOURCE_DEFS.ore.color);
const ORE_HOT = new Color('#ffd27a');
const Y_UP = new Vector3(0, 1, 0);
const SHARDS = 6;

type Shared = {
  crystal: BufferGeometry;
  hit: SphereGeometry;
};

/** Glowing crystal clusters on every mineral seam; tap one to strike it. */
export function Seams() {
  const key = useGame((st) => (st.s ? st.s.seams.map((x) => x.id).join(SEP) : ''));
  const seed = useGame((st) => st.s?.seed ?? 1);
  const ids = useMemo(() => splitIds(key).map(Number), [key]);
  const shared = useBundle<Shared>(() => ({ crystal: crystalGeometry(), hit: new SphereGeometry(0.52, 10, 8) }), []);
  return (
    <>
      {ids.map((id) => (
        <SeamCrystal key={`${seed}:${id}`} id={id} seed={seed} shared={shared} />
      ))}
    </>
  );
}

function SeamCrystal({ id, seed, shared }: { id: number; seed: number; shared: Shared }) {
  const seam = useMemo(() => useGame.getState().s?.seams.find((x) => x.id === id), [id]);
  const dir = seam?.dir;

  const res = useBundle(
    () => ({
      mat: new MeshStandardMaterial({ color: '#2a1606', emissive: ORE, emissiveIntensity: 2.5, roughness: 0.22, metalness: 0.15, flatShading: true }),
      glowMat: new SpriteMaterial({ map: glowTexture(), color: ORE, blending: AdditiveBlending, depthWrite: false, transparent: true }),
    }),
    [],
  );

  const objs = useMemo(() => {
    const mesh = new InstancedMesh(shared.crystal, res.mat, SHARDS);
    const r = rng((id * 9973) >>> 0);
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Vector3();
    const p = new Vector3();
    const s = new Vector3();
    for (let i = 0; i < SHARDS; i++) {
      const center = i === 0;
      const ang = (i / (SHARDS - 1)) * Math.PI * 2 + r() * 0.6;
      const off = center ? 0 : 0.1 + r() * 0.1;
      p.set(Math.cos(ang) * off, -0.02, Math.sin(ang) * off);
      // Tilt outward from the cluster centre.
      e.set(Math.sin(ang), 0, -Math.cos(ang)).normalize();
      q.setFromAxisAngle(e, center ? 0 : -(0.35 + r() * 0.45));
      const w = center ? 0.11 : 0.06 + r() * 0.04;
      const h = center ? 0.42 : 0.2 + r() * 0.2;
      m.compose(p, q, s.set(w, h, w));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    const glow = new Sprite(res.glowMat);
    glow.position.set(0, 0.3, 0);
    return { mesh, glow };
  }, [shared, res, id]);

  useEffect(() => () => objs.mesh.dispose(), [objs]);

  const placement = useMemo(() => {
    if (!dir) return null;
    const n = new Vector3(dir[0], dir[1], dir[2]).normalize();
    const p = new Vector3(...surfacePoint(dir, seed)).addScaledVector(n, -0.04);
    const q = new Quaternion().setFromUnitVectors(Y_UP, n);
    return { p, q };
  }, [dir, seed]);

  const group = useRef<Group>(null!);
  const cluster = useRef<Group>(null!);
  const anim = useMemo(() => ({ scale: 0, hp: seam?.hp ?? 1, flash: 0, res: 0, phase: Math.random() * Math.PI * 2 }), [seam]);
  const tmp = useMemo(() => ({ p: new Vector3(), n: new Vector3() }), []);

  useFrame((state, dtRaw) => {
    if (!cluster.current) return;
    const dt = Math.min(dtRaw, 0.05);
    const s = useGame.getState().s;
    const cur = byId(s?.seams, id);
    const health = cur ? Math.max(0, cur.hp / cur.maxHp) : 0;
    if (cur && cur.hp < anim.hp - 1e-6) anim.flash = 1;
    if (cur) anim.hp = cur.hp;
    anim.flash = Math.max(0, anim.flash - dt * 4);
    anim.res = damp(anim.res, s && surgeOn(s, hostNow()) ? 1 : 0, 3, dt);

    const target = 0.45 + 0.55 * health;
    anim.scale = damp(anim.scale, target, 7, dt);
    const t = state.clock.elapsedTime;
    const pulse = 0.5 + 0.5 * Math.sin(t * 3 + anim.phase);
    const kick = 1 + anim.flash * 0.22;
    cluster.current.scale.setScalar(anim.scale * kick);

    const boost = 1 + anim.res * 0.9;
    res.mat.emissiveIntensity = (1.8 + pulse * 1.8 + anim.flash * 5) * boost;
    res.mat.emissive.copy(ORE).lerp(ORE_HOT, anim.flash * 0.7 + anim.res * 0.3);
    res.glowMat.color.copy(ORE).multiplyScalar((0.9 + pulse * 0.6 + anim.flash * 2.5) * boost);
    objs.glow.scale.setScalar((0.95 + pulse * 0.25 + anim.flash * 0.5 + anim.res * 0.35) * anim.scale);
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!tapOk(e.nativeEvent)) return;
    // World normal from the hit face, blended with the surface normal so
    // sparks fly away from the rock instead of sideways off the hit sphere.
    if (e.face) tmp.n.copy(e.face.normal).transformDirection(e.object.matrixWorld);
    else tmp.n.set(0, 0, 0);
    tmp.p.copy(Y_UP).transformDirection(group.current.matrixWorld);
    tmp.n.add(tmp.p).normalize();
    // Aim the laser at the crystal itself rather than the invisible hit sphere.
    group.current.localToWorld(tmp.p.set(0, 0.22, 0));
    act.strike(id, tmp.p, tmp.n);
  };

  if (!placement) return null;
  return (
    <group ref={group} position={placement.p} quaternion={placement.q}>
      <group ref={cluster} scale={0}>
        <primitive object={objs.mesh} />
        <primitive object={objs.glow} />
      </group>
      <mesh geometry={shared.hit} visible={false} position={[0, 0.2, 0]} onPointerDown={onDown} />
    </group>
  );
}
