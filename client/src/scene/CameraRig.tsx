import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { onFx } from '../state/fx';
import { useGame } from '../state/store';
import { bus } from './bus';
import { BASE_FOV, STATION_POS } from './layout';
import { damp } from './util';

const ORIGIN = new Vector3(0, 0, 0);
const ROCK_DIST = 7.6;
const STATION_DIST = 5.4;

/** Pull back on portrait screens so the subject stays in frame (as the prototype's FitCamera). */
function fitFactor(aspect: number): number {
  if (aspect >= 1) return 1;
  return Math.max(1, Math.min(1.95, (1 / Math.max(aspect, 0.42)) * 0.8));
}

/**
 * OrbitControls plus everything that moves the camera on its own: the orbit
 * target eases between the rock and the station according to `view`, the
 * distance adapts to the view and the screen shape, shake and quake rumble
 * are applied as a small rotation after the controls update (so they never
 * accumulate into the orbit), and the Quantum Leap punches the FOV.
 *
 * Target and camera move together, which keeps the user's orbit angle; the
 * distance is only eased right after a view or screen change and stops as
 * soon as the user starts dragging or zooming.
 */
export function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const view = useGame((s) => s.view);

  const desired = useMemo(() => (view === 'station' ? STATION_DIST : ROCK_DIST) * fitFactor(width / Math.max(1, height)), [view, width, height]);
  const anim = useMemo(() => ({ dist: true, first: true }), []);
  const tmp = useMemo(() => ({ delta: new Vector3(), off: new Vector3() }), []);

  useEffect(() => {
    anim.dist = true;
  }, [desired, anim]);

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind === 'shake') bus.shake = Math.min(0.75, bus.shake + e.strength);
      }),
    [],
  );

  // Stop easing the distance as soon as the user zooms (wheel or pinch);
  // plain taps and orbit drags don't fight it.
  useEffect(() => {
    const el = (gl.domElement.parentElement ?? gl.domElement) as HTMLElement;
    const down = new Set<number>();
    const onWheel = () => {
      anim.dist = false;
    };
    const onDown = (e: PointerEvent) => {
      down.add(e.pointerId);
      if (down.size >= 2) anim.dist = false;
    };
    const onUp = (e: PointerEvent) => {
      down.delete(e.pointerId);
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [gl, anim]);

  // Before the controls update (-1): move the orbit target, ease distance, set FOV.
  useFrame((state, dtRaw) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(dtRaw, 0.05);
    const goal = useGame.getState().view === 'station' ? STATION_POS : ORIGIN;
    const { delta, off } = tmp;

    if (anim.first) {
      anim.first = false;
      delta.copy(goal).sub(c.target);
      c.target.add(delta);
      camera.position.add(delta);
      off.copy(camera.position).sub(c.target).setLength(desired);
      camera.position.copy(c.target).add(off);
      anim.dist = false;
    } else {
      delta.copy(goal).sub(c.target).multiplyScalar(1 - Math.exp(-dt * 3.2));
      c.target.add(delta);
      camera.position.add(delta);
      if (anim.dist) {
        off.copy(camera.position).sub(c.target);
        const d = off.length();
        const nd = damp(d, desired, 3.4, dt);
        off.setLength(nd);
        camera.position.copy(c.target).add(off);
        if (Math.abs(nd - desired) < 0.01) anim.dist = false;
      }
    }

    const fov = BASE_FOV + bus.warp * 34;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    bus.pointScale = (state.size.height * state.viewport.dpr * 0.5) / Math.tan(MathUtils.degToRad(camera.fov) * 0.5);
  }, -2);

  // After the controls update: shake and rumble as a tiny rotation; the next
  // update's lookAt() resets it, so nothing drifts.
  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    bus.shake = Math.max(0, bus.shake - dt * (0.9 + bus.shake * 1.6));
    const ev = useGame.getState().s?.event;
    bus.rumble = damp(bus.rumble, ev?.kind === 'quake' ? 1 : 0, 2, dt);
    const t = state.clock.elapsedTime;
    const a = bus.shake * bus.shake * 0.09;
    const r = bus.rumble * 0.0035;
    if (a + r < 1e-5) return;
    camera.rotateX((Math.sin(t * 47.3) * 0.6 + Math.sin(t * 83.1 + 1.7) * 0.4) * a + Math.sin(t * 13.1) * Math.sin(t * 3.3) * r);
    camera.rotateY((Math.sin(t * 52.7 + 0.5) * 0.6 + Math.sin(t * 71.9 + 2.3) * 0.4) * a + Math.sin(t * 11.7 + 1.1) * r);
    camera.rotateZ(Math.sin(t * 39.1 + 0.9) * a * 0.5 + Math.sin(t * 7.9) * r * 0.6);
    camera.updateMatrixWorld();
  });

  const station = view === 'station';
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      minDistance={station ? 2.8 : 4.2}
      maxDistance={station ? 15 : 19}
    />
  );
}
