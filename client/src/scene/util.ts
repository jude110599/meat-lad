import { useEffect, useMemo, useState, type DependencyList } from 'react';
import { CanvasTexture, Color, SRGBColorSpace, type Texture } from 'three';
import { WIDE_MIN_PX } from '../state/store';

/* ---------------- colours ---------------- */

const HSL_RE = /^hsla?\(\s*(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i;

/**
 * Parse any CSS colour the game emits into `out`. three's Color.setStyle only
 * understands the comma form of hsl(), while `hueColor()` emits the modern
 * space-separated form, so hsl is parsed here.
 */
export function setCss(out: Color, css: string): Color {
  const m = HSL_RE.exec(css);
  if (m) {
    const h = (((Number(m[1]) % 360) + 360) % 360) / 360;
    return out.setHSL(h, Number(m[2]) / 100, Number(m[3]) / 100, SRGBColorSpace);
  }
  return out.set(css);
}

const colorCache = new Map<string, Color>();
/** Cached parse of a CSS colour. Treat the result as read-only. */
export function cssColor(css: string): Color {
  let c = colorCache.get(css);
  if (!c) {
    if (colorCache.size > 256) colorCache.clear();
    c = setCss(new Color(), css);
    colorCache.set(css, c);
  }
  return c;
}

/* ---------------- time ---------------- */

/**
 * The host's clock. Surge and comet deadlines are host epoch ms; comparing
 * them with this instead of Date.now() keeps guests correct even when their
 * clock is skewed.
 */
export { hostNow } from '../state/store';

/** Frame-rate independent exponential approach. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** Cheap smooth pseudo-noise in [-1, 1] for flicker and shake. */
export function wobble(t: number, seed = 0): number {
  return Math.sin(t * 1.7 + seed) * 0.5 + Math.sin(t * 2.9 + seed * 1.3) * 0.3 + Math.sin(t * 5.3 + seed * 0.7) * 0.2;
}

/** Stable hash of an integer to [0, 1). */
export function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ---------------- device ---------------- */

const LITE_QUERY = `(pointer: coarse), (max-width: ${WIDE_MIN_PX - 1}px)`;

/** Phones and narrow windows: lower pixel ratio and fewer particles. */
export function isLite(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(LITE_QUERY).matches === true;
}

/** isLite() that follows the window across resizes and rotations. */
export function useLite(): boolean {
  const [lite, setLite] = useState(isLite);
  useEffect(() => {
    const mq = window.matchMedia?.(LITE_QUERY);
    if (!mq) return;
    const on = () => setLite(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return lite;
}

/* ---------------- input ---------------- */

/** Touches currently down: where and when each landed, and whether it has dragged. */
const touches = new Map<number, { x: number; y: number; t: number; moved: boolean }>();
let tracking = false;

function trackTouches(): void {
  if (tracking || typeof window === 'undefined') return;
  tracking = true;
  // Capture phase on window, so this runs before R3F's handlers see the event.
  const opts = { capture: true, passive: true } as const;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse') return;
      if (e.isPrimary) touches.clear();
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: false });
    },
    opts,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      const d = touches.get(e.pointerId);
      if (d && !d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) d.moved = true;
    },
    opts,
  );
  const up = (e: PointerEvent) => touches.delete(e.pointerId);
  window.addEventListener('pointerup', up, opts);
  window.addEventListener('pointercancel', up, opts);
}
trackTouches();

/**
 * Should this pointerdown strike? Strikes fire on pointerdown with no click
 * delay. Only the main mouse button counts, and a finger that lands while
 * another one is dragging or holding (a pinch or an orbit) is part of that
 * gesture, not a tap. Quick taps with two thumbs still both count.
 */
export function tapOk(e: PointerEvent): boolean {
  if (e.button > 0) return false;
  if (e.isPrimary) return true;
  const now = performance.now();
  for (const [id, d] of touches) if (id !== e.pointerId && (d.moved || now - d.t > 250)) return false;
  return true;
}

/* ---------------- textures ---------------- */

let glow: Texture | null = null;
/** Shared soft radial glow, used by every sprite halo. Lives for the whole session. */
export function glowTexture(): Texture {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.15, 'rgba(255,255,255,0.8)');
    grad.addColorStop(0.4, 'rgba(255,255,255,0.25)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.06)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  glow = new CanvasTexture(c);
  return glow;
}

/* ---------------- lifetimes ---------------- */

export interface Disposable {
  dispose(): void;
}

/** useMemo for a GPU resource that is disposed when deps change or the component unmounts. */
export function useDisposable<T extends Disposable>(make: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const v = useMemo(make, deps);
  useEffect(() => () => v.dispose(), [v]);
  return v;
}

/** Same as useDisposable for a record of resources (or arrays of them). */
export function useBundle<T extends Record<string, Disposable | Disposable[]>>(make: () => T, deps: DependencyList): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const v = useMemo(make, deps);
  useEffect(
    () => () => {
      for (const x of Object.values(v)) {
        if (Array.isArray(x)) for (const d of x) d.dispose();
        else x.dispose();
      }
    },
    [v],
  );
  return v;
}

/** Allocation-free lookup by id (avoids a closure per frame). */
export function byId<T extends { id: number }>(xs: readonly T[] | undefined, id: number): T | undefined {
  if (!xs) return undefined;
  for (let i = 0; i < xs.length; i++) if (xs[i].id === id) return xs[i];
  return undefined;
}

/**
 * Hand out up to `cap` visible units round-robin between owners, so everyone
 * shows up even when one of them owns hundreds. Returns each unit's owner index.
 */
export function roundRobin(counts: readonly number[], cap: number): number[] {
  const left = counts.slice();
  const out: number[] = [];
  let more = true;
  while (out.length < cap && more) {
    more = false;
    for (let i = 0; i < left.length && out.length < cap; i++) {
      if (left[i] <= 0) continue;
      left[i]--;
      out.push(i);
      more = true;
    }
  }
  return out;
}

/** Comma-free join for id lists used as cheap, stable zustand selector results. */
export const SEP = '\u0001';
export const splitIds = (key: string): string[] => (key ? key.split(SEP) : []);
