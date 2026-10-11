import { useEffect, useMemo, type DependencyList } from 'react';
import { CanvasTexture, Color, SRGBColorSpace, type Texture } from 'three';
import type { BuffId, RoomState } from '@starforge/shared';
import { useGame } from '../state/store';

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
 * The host's clock, extrapolated from the last snapshot. Buff expiries,
 * overheat locks and node primes are host epoch ms; comparing them with this
 * instead of Date.now() keeps guests correct even when their clock is skewed.
 */
export function hostNow(): number {
  const st = useGame.getState();
  if (!st.s || st.snapAt <= 0) return Date.now();
  const since = performance.now() - st.snapAt;
  return st.s.now + Math.min(5000, Math.max(0, since));
}

export const buffActive = (s: RoomState, b: BuffId, now: number): boolean => (s.buffs[b] ?? 0) > now;

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

/** Comma-free join for id lists used as cheap, stable zustand selector results. */
export const SEP = '\u0001';
export const splitIds = (key: string): string[] => (key ? key.split(SEP) : []);
