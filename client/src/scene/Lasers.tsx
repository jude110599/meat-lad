import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, PlaneGeometry, Vector3 } from 'three';
import { RESOURCE_DEFS, surgeOn } from '@starforge/shared';
import { onFx } from '../state/fx';
import { hueColor, refs } from '../state/refs';
import { useGame } from '../state/store';
import { Flashes } from './Flashes';
import { flash, makeBeamMaterial, ribbonMatrix } from './fxkit';
import { cssColor, hostNow, useBundle } from './util';

const POOL = 12;
const BEAM_LIFE = 0.16;
/** My laser fires from a point fixed relative to the camera (bottom right). */
const MUZZLE = new Vector3(0.9, -0.7, -1.2);
const WHITE = new Color(1, 1, 1);
const SURGE = new Color('#bff8ff');
const GOLD = new Color('#ffd36a');
const ORE = new Color(RESOURCE_DEFS.ore.color);
const BREAK = new Color('#ffb46a');

interface Beam {
  t: number;
  mine: boolean;
  from: Vector3;
  to: Vector3;
  color: Color;
  width: number;
}

/**
 * Pooled drill lasers: camera-facing ribbons with a white-hot core inside a
 * coloured glow and energy rippling down them, one instanced draw for every
 * laser in flight. Mine fire from the camera rig, other players' from their
 * ships. Each shot flashes at the muzzle and flares where it lands; crits
 * (from the strike result, 'impact') add a gold star burst, an anamorphic
 * streak and rings in the striker's colour. During a resonance surge every
 * beam runs thicker, brighter and a little icy.
 *
 * Also renders the shared flash pool (Flashes.tsx).
 */
export function Lasers() {
  const camera = useThree((s) => s.camera);
  const res = useBundle(
    () => ({
      geo: new PlaneGeometry(1, 1).translate(0, 0.5, 0),
      mat: makeBeamMaterial({ core: 1, flow: 70, freq: 7, taper: 0.3 }),
    }),
    [],
  );

  const beams = useMemo(() => {
    const m = new InstancedMesh(res.geo, res.mat, POOL);
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(POOL * 3), 3).setUsage(DynamicDrawUsage);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = 6;
    return m;
  }, [res]);
  useEffect(() => () => beams.dispose(), [beams]);

  const pool = useMemo<Beam[]>(
    () => Array.from({ length: POOL }, () => ({ t: 0, mine: false, from: new Vector3(), to: new Vector3(), color: new Color(), width: 0.1 })),
    [],
  );
  const tmp = useMemo(() => ({ head: 0, m: new Matrix4(), c: new Color(), c2: new Color(), p: new Vector3() }), []);

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind === 'laser') {
          const st = useGame.getState();
          const mine = e.from === st.me;
          let origin: Vector3 | undefined;
          if (mine) {
            camera.updateMatrixWorld();
            origin = tmp.p.copy(MUZZLE).applyMatrix4(camera.matrixWorld);
          } else {
            origin = refs.ships.get(e.from);
            if (!origin) return;
          }
          const b = pool[tmp.head];
          tmp.head = (tmp.head + 1) % POOL;
          b.mine = mine;
          b.from.copy(origin);
          b.to.copy(e.to);
          const surge = !!st.s && surgeOn(st.s, hostNow());
          b.color.copy(cssColor(e.color));
          if (e.crit) b.color.lerp(WHITE, 0.5);
          else if (surge) b.color.lerp(SURGE, 0.35);
          b.color.multiplyScalar(e.crit ? 2.6 : surge ? 2.3 : 1.8);
          b.width = (mine ? 0.12 : 0.1) * (e.crit ? 1.5 : 1) * (surge ? 1.35 : 1);
          b.t = 1;
          // Muzzle flash and the impact: a star flare and a quick ring.
          const hot = e.crit || surge;
          flash(b.from, tmp.c.copy(b.color).multiplyScalar(0.8), { kind: 'glow', size: mine ? 0.32 : 0.36, size1: 0.12, life: 0.12 });
          flash(b.to, tmp.c.copy(b.color).lerp(WHITE, 0.25).multiplyScalar(0.8), { kind: 'star', size: hot ? 0.7 : 0.5, size1: hot ? 0.95 : 0.7, life: 0.2, lift: 0.25 });
          flash(b.to, tmp.c.copy(b.color).multiplyScalar(0.3), { kind: 'ring', size: 0.1, size1: hot ? 0.7 : 0.48, life: 0.22, lift: 0.22 });
        } else if (e.kind === 'impact') {
          if (!e.crit && !e.broke) {
            // A plain hit on a seam glints ore-gold.
            if (e.seam) flash(e.at, tmp.c.copy(ORE).multiplyScalar(1.6), { kind: 'glow', size: 0.5, size1: 0.3, life: 0.3, lift: 0.22 });
            return;
          }
          const st = useGame.getState();
          const hue = st.s?.players[e.by]?.hue ?? 50;
          const own = tmp.c2.copy(cssColor(hueColor(hue, 62)));
          const big = e.broke ? 1.35 : 1;
          const mine = e.by === st.me;
          const k = (mine ? 1 : 0.7) * big;
          flash(e.at, tmp.c.copy(GOLD).multiplyScalar(3), { kind: 'star', size: 0.9 * k, size1: 1.9 * k, life: 0.42, lift: 0.4 });
          flash(e.at, tmp.c.copy(GOLD).lerp(WHITE, 0.4).multiplyScalar(2), { kind: 'streak', size: 0.28 * k, size1: 0.4 * k, aspect: 9, life: 0.34, lift: 0.42 });
          flash(e.at, tmp.c.copy(own).multiplyScalar(2.6), { kind: 'ring', size: 0.2, size1: 1.8 * k, life: 0.5, lift: 0.3 });
          flash(e.at, tmp.c.copy(GOLD).multiplyScalar(1.8), { kind: 'ring', size: 0.15, size1: 1.15 * k, life: 0.42, lift: 0.32, delay: 0.07 });
          if (e.broke) flash(e.at, tmp.c.copy(BREAK).multiplyScalar(2.2), { kind: 'ring', size: 0.3, size1: 2.6, life: 0.7, lift: 0.3, delay: 0.03 });
        }
      }),
    [pool, tmp, camera],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    const cam = state.camera;
    res.mat.uniforms.uTime.value = state.clock.elapsedTime;
    let n = 0;
    for (let i = 0; i < POOL; i++) {
      const b = pool[i];
      if (b.t <= 0) continue;
      b.t = Math.max(0, b.t - dt / BEAM_LIFE);
      if (b.t <= 0) continue;
      if (b.mine) b.from.copy(MUZZLE).applyMatrix4(cam.matrixWorld);
      const age = 1 - b.t;
      // Snaps open wide, then thins out as it fades.
      const w = b.width * (age < 0.15 ? 0.7 + (age / 0.15) * 0.5 : 0.45 + 0.75 * b.t);
      ribbonMatrix(tmp.m, b.from, b.to, w, cam.position);
      beams.setMatrixAt(n, tmp.m);
      beams.setColorAt(n, tmp.c.copy(b.color).multiplyScalar(b.t * Math.sqrt(b.t)));
      n++;
    }
    beams.count = n;
    if (n) {
      beams.instanceMatrix.needsUpdate = true;
      if (beams.instanceColor) beams.instanceColor.needsUpdate = true;
    }
  });

  return (
    <>
      <primitive object={beams} />
      <Flashes />
    </>
  );
}
