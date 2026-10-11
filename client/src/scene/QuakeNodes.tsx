import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  IcosahedronGeometry,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type Group,
  type Mesh,
} from 'three';
import { surfacePoint } from '@starforge/shared';
import { act } from '../net/actions';
import { onFx } from '../state/fx';
import { useGame } from '../state/store';
import { shockwave, sparks } from './bus';
import { byId, damp, hostNow, SEP, splitIds, useBundle } from './util';

const IDLE = new Color('#ff4a1a');
const PRIMED = new Color('#4de8ff');
const LOCKED = new Color('#4dff8a');
const QUAKE_WAVE = new Color('#ff7a3a');
const Y_UP = new Vector3(0, 1, 0);

type Shared = {
  ring: TorusGeometry;
  ring2: TorusGeometry;
  core: IcosahedronGeometry;
  pillar: CylinderGeometry;
  hit: SphereGeometry;
};

/**
 * Seismic Shockwave resonance nodes. Each node sits on the surface along its
 * direction: unstable red-orange flicker when idle, fast cyan pulse while a
 * strike has primed it, steady green with a light pillar once locked. While
 * the quake lasts it also drives the camera rumble and a periodic shockwave.
 */
export function QuakeNodes() {
  const key = useGame((st) => (st.s?.event?.kind === 'quake' ? st.s.event.nodes.map((n) => n.id).join(SEP) : ''));
  const seed = useGame((st) => st.s?.seed ?? 1);
  const startedAt = useGame((st) => (st.s?.event?.kind === 'quake' ? st.s.event.startedAt : 0));
  const ids = useMemo(() => splitIds(key).map(Number), [key]);
  const shared = useBundle<Shared>(
    () => ({
      ring: new TorusGeometry(0.4, 0.03, 6, 40, Math.PI * 1.6),
      ring2: new TorusGeometry(0.6, 0.016, 4, 48, Math.PI * 1.15),
      core: new IcosahedronGeometry(0.15, 1),
      pillar: new CylinderGeometry(0.07, 0.025, 1, 10, 1, true).translate(0, 0.5, 0),
      hit: new SphereGeometry(0.66, 10, 8),
    }),
    [],
  );

  return (
    <>
      {ids.map((id) => (
        <QuakeNode key={`${startedAt}:${id}`} id={id} seed={seed} shared={shared} />
      ))}
      {ids.length > 0 && <QuakePulse />}
    </>
  );
}

/** Periodic shockwave rings while the quake is on (the rumble lives in CameraRig). */
function QuakePulse() {
  const t = useRef(1.2);
  useFrame((_, dt) => {
    t.current -= Math.min(dt, 0.05);
    if (t.current <= 0) {
      t.current = 3.2 + Math.random() * 0.8;
      shockwave(QUAKE_WAVE, 0.55);
    }
  });
  return null;
}

function QuakeNode({ id, seed, shared }: { id: number; seed: number; shared: Shared }) {
  const node = useMemo(() => {
    const ev = useGame.getState().s?.event;
    return ev?.kind === 'quake' ? ev.nodes.find((n) => n.id === id) : undefined;
  }, [id]);

  const mats = useBundle(
    () => ({
      ring: new MeshBasicMaterial({ color: IDLE, toneMapped: false }),
      core: new MeshBasicMaterial({ color: IDLE, toneMapped: false }),
      pillar: new MeshBasicMaterial({ color: LOCKED, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
    }),
    [],
  );

  const placement = useMemo(() => {
    if (!node) return null;
    const n = new Vector3(...node.dir).normalize();
    const p = new Vector3(...surfacePoint(node.dir, seed)).addScaledVector(n, 0.04);
    const q = new Quaternion().setFromUnitVectors(Y_UP, n);
    return { p, q };
  }, [node, seed]);

  const ring = useRef<Mesh>(null!);
  const ring2 = useRef<Mesh>(null!);
  const core = useRef<Mesh>(null!);
  const pillar = useRef<Mesh>(null!);
  const root = useRef<Group>(null!);
  const anim = useMemo(() => ({ grow: 0, flash: 0, lock: 0, color: new Color(), phase: Math.random() * 10 }), []);
  const tmp = useMemo(() => ({ p: new Vector3(), n: new Vector3() }), []);

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind !== 'nodeLock' || e.nodeId !== id) return;
        anim.flash = 1;
        const g = root.current;
        if (!g) return;
        g.localToWorld(tmp.p.set(0, 0.15, 0));
        tmp.n.copy(Y_UP).transformDirection(g.matrixWorld);
        sparks(tmp.p, tmp.n, LOCKED, 40, 4.5, { spread: 1.1, life: 0.8, white: 0.4 });
      }),
    [id, anim, tmp],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const ev = useGame.getState().s?.event;
    const cur = ev?.kind === 'quake' ? byId(ev.nodes, id) : undefined;
    if (!cur || !ring.current) return;
    const now = hostNow();
    const t = state.clock.elapsedTime + anim.phase;
    const primed = !cur.locked && cur.primedUntil > now;
    anim.grow = damp(anim.grow, 1, 5, dt);
    anim.flash = Math.max(0, anim.flash - dt * 2.5);
    anim.lock = damp(anim.lock, cur.locked ? 1 : 0, 4, dt);

    let bright: number;
    let pulse: number;
    if (cur.locked) {
      anim.color.copy(LOCKED);
      bright = 2.2;
      pulse = 1;
    } else if (primed) {
      anim.color.copy(PRIMED);
      const s = 0.5 + 0.5 * Math.sin(t * 16);
      bright = 2 + s * 2.2;
      pulse = 1 + s * 0.22;
    } else {
      anim.color.copy(IDLE);
      // Unstable: jittery flicker with occasional dropouts.
      const n = Math.sin(t * 23.1) * 0.5 + Math.sin(t * 37.7 + 1.3) * 0.3 + Math.sin(t * 9.1) * 0.2;
      bright = 1.3 + n * 0.9 + (Math.sin(t * 3.7) > 0.93 ? -0.9 : 0);
      pulse = 1 + Math.sin(t * 5) * 0.07;
    }
    bright += anim.flash * 5;
    mats.ring.color.copy(anim.color).multiplyScalar(Math.max(0.2, bright));
    mats.core.color.copy(anim.color).multiplyScalar(Math.max(0.3, bright * 1.3));
    mats.pillar.color.copy(LOCKED).multiplyScalar(1.6 + anim.flash * 3);
    mats.pillar.opacity = anim.lock * (0.55 + 0.1 * Math.sin(t * 4));

    const g = anim.grow * (1 + anim.flash * 0.6);
    ring.current.scale.setScalar(g * pulse);
    ring.current.rotation.z += dt * (primed ? 5 : cur.locked ? 0.6 : 1.6);
    ring2.current.scale.setScalar(g * (cur.locked ? 1 : 1 + 0.12 * Math.sin(t * 2.3)));
    ring2.current.rotation.z -= dt * (primed ? 3 : 0.8);
    core.current.scale.setScalar(g * (0.85 + 0.25 * pulse + anim.flash * 0.6));
    core.current.rotation.y += dt * 2;
    core.current.rotation.x += dt * 1.3;
    pillar.current.scale.set(1 + anim.flash, Math.max(0.001, anim.lock * 7), 1 + anim.flash);
    pillar.current.visible = anim.lock > 0.01;
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.nativeEvent.button > 0) return;
    const g = root.current;
    if (e.face) tmp.n.copy(e.face.normal).transformDirection(e.object.matrixWorld);
    else tmp.n.set(0, 0, 0);
    tmp.p.copy(Y_UP).transformDirection(g.matrixWorld);
    tmp.n.add(tmp.p).normalize();
    g.localToWorld(tmp.p.set(0, 0.12, 0));
    act.strike({ nodeId: id }, tmp.p, tmp.n);
  };

  if (!placement) return null;
  return (
    <group ref={root} position={placement.p} quaternion={placement.q}>
      <mesh ref={ring} geometry={shared.ring} material={mats.ring} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} scale={0} />
      <mesh ref={ring2} geometry={shared.ring2} material={mats.ring} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} scale={0} />
      <mesh ref={core} geometry={shared.core} material={mats.core} position={[0, 0.16, 0]} scale={0} />
      <mesh ref={pillar} geometry={shared.pillar} material={mats.pillar} visible={false} />
      <mesh geometry={shared.hit} visible={false} position={[0, 0.15, 0]} onPointerDown={onDown} />
    </group>
  );
}
