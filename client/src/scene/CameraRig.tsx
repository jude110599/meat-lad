import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { onFx } from '../state/fx';
import { useGame } from '../state/store';
import { bus } from './bus';
import { BASE_FOV, visibleRect } from './layout';
import { damp } from './util';

/** Camera distance that frames the rock when the whole screen is visible. */
const ROCK_DIST = 7.6;
const MIN_DIST = 4.2;

/** Pull back on portrait views so the rock (and a little of its orbit) stays in frame. */
function fitFactor(aspect: number): number {
  if (aspect >= 1) return 1;
  return Math.max(1, Math.min(2.1, (1 / Math.max(aspect, 0.42)) * 0.88));
}

/**
 * OrbitControls around the rock plus everything that moves the camera on its
 * own. The HUD covers part of the canvas (top bar; side panel on wide
 * screens; tab bar and bottom sheet on phones), so the projection is shifted
 * with setViewOffset to put the rock in the middle of what is left visible,
 * and the distance fits the rock to that area's size and shape. Both ease
 * when the sheet opens or closes or the window resizes. Shake is applied as
 * a small rotation after the controls update (so it never accumulates into
 * the orbit), and the Quantum Leap punches the FOV.
 *
 * The user's own zoom is kept as a ratio to the fitted distance, so a layout
 * change re-fits without throwing it away; easing stops as soon as the user
 * starts zooming.
 */
export function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const sheet = useGame((s) => s.sheet);

  const rect = useMemo(() => visibleRect(width, height, sheet), [width, height, sheet]);
  const desired = useMemo(() => ROCK_DIST * (height / rect.h) * fitFactor(rect.w / rect.h), [rect, height]);
  const anim = useMemo(() => ({ dist: true, first: true, base: 0, zoom: 1, cx: 0, cy: 0, w: 0, h: 0 }), []);
  const tmp = useMemo(() => ({ off: new Vector3() }), []);

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

  useEffect(() => () => camera.clearViewOffset(), [camera]);

  // Before the controls update (-1): ease the view offset and distance, set FOV.
  useFrame((state, dtRaw) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(dtRaw, 0.05);
    const { off } = tmp;
    const W = state.size.width;
    const H = state.size.height;
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;

    off.copy(camera.position).sub(c.target);
    // A new layout: ease to the new fit (checked here rather than in an
    // effect, so no frame ever measures the zoom against the wrong fit).
    if (anim.base !== desired) {
      anim.base = desired;
      anim.dist = true;
    }
    if (anim.first) {
      anim.first = false;
      anim.cx = cx;
      anim.cy = cy;
      anim.w = rect.w;
      anim.h = rect.h;
      off.setLength(desired);
      camera.position.copy(c.target).add(off);
      anim.dist = false;
    } else {
      anim.cx = damp(anim.cx, cx, 5, dt);
      anim.cy = damp(anim.cy, cy, 5, dt);
      anim.w = damp(anim.w, rect.w, 5, dt);
      anim.h = damp(anim.h, rect.h, 5, dt);
      if (anim.dist) {
        const goal = MathUtils.clamp(desired * anim.zoom, MIN_DIST, maxDist(desired));
        const nd = damp(off.length(), goal, 4, dt);
        off.setLength(nd);
        camera.position.copy(c.target).add(off);
        if (Math.abs(nd - goal) < 0.01) anim.dist = false;
      } else {
        // Remember how far the user has zoomed relative to the fit.
        anim.zoom = off.length() / desired;
      }
    }
    bus.view.w = anim.w;
    bus.view.h = anim.h;

    // Shift the projection so the orbit target lands on the visible area's centre.
    const ox = W / 2 - anim.cx;
    const oy = H / 2 - anim.cy;
    const fov = BASE_FOV + bus.warp * 34;
    const v = camera.view;
    if (!v || !v.enabled || v.fullWidth !== W || v.fullHeight !== H || Math.abs(v.offsetX - ox) > 0.01 || Math.abs(v.offsetY - oy) > 0.01 || Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.setViewOffset(W, H, ox, oy, W, H);
    }
    bus.pointScale = (H * state.viewport.dpr * 0.5) / Math.tan(MathUtils.degToRad(camera.fov) * 0.5);
  }, -2);

  // After the controls update: shake as a tiny rotation; the next update's
  // lookAt() resets it, so nothing drifts.
  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    bus.shake = Math.max(0, bus.shake - dt * (0.9 + bus.shake * 1.6));
    const a = bus.shake * bus.shake * 0.09;
    if (a < 1e-5) return;
    const t = state.clock.elapsedTime;
    camera.rotateX((Math.sin(t * 47.3) * 0.6 + Math.sin(t * 83.1 + 1.7) * 0.4) * a);
    camera.rotateY((Math.sin(t * 52.7 + 0.5) * 0.6 + Math.sin(t * 71.9 + 2.3) * 0.4) * a);
    camera.rotateZ(Math.sin(t * 39.1 + 0.9) * a * 0.5);
    camera.updateMatrixWorld();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      minDistance={MIN_DIST}
      maxDistance={maxDist(desired)}
    />
  );
}

/** Zoom-out limit, with room to spare however small the visible area gets. */
function maxDist(desired: number): number {
  return Math.max(19, desired * 1.6);
}
