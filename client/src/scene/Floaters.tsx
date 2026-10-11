import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { onFx } from '../state/fx';
import { bus } from './bus';

const POOL = 40;

interface Slot {
  wrap: HTMLDivElement;
  inner: HTMLDivElement | null;
  at: Vector3;
  born: number;
  life: number;
  dx: number;
  rise: number;
  active: boolean;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/**
 * Floating yield numbers ("+12"), anchored to a world point and drawn as DOM
 * for crisp text. A fixed pool of absolutely positioned wrappers is moved
 * imperatively every frame: no React state, no per-number portals.
 *
 * The wrapper owns position, rise, pop and fade. The inner element carries
 * the `floater` / `floater big` classes for typography and glow (styles.css),
 * plus `--c` and `color` set to the floater colour.
 */
export function Floaters() {
  const gl = useThree((s) => s.gl);
  const tmp = useMemo(() => new Vector3(), []);
  const pool = useMemo<Slot[]>(() => [], []);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent) return;
    const layer = document.createElement('div');
    layer.className = 'floaters';
    Object.assign(layer.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      overflow: 'hidden',
      zIndex: '1',
    });
    parent.appendChild(layer);
    for (let i = 0; i < POOL; i++) {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        display: 'none',
        willChange: 'transform, opacity',
        pointerEvents: 'none',
      });
      layer.appendChild(wrap);
      pool.push({ wrap, inner: null, at: new Vector3(), born: 0, life: 1, dx: 0, rise: 60, active: false });
    }
    let next = 0;
    const spawn = (at: Vector3, text: string, color: string, big: boolean) => {
      const s = pool[next];
      next = (next + 1) % POOL;
      // A fresh inner element restarts any CSS animation on .floater.
      s.inner?.remove();
      const inner = document.createElement('div');
      inner.className = big ? 'floater big' : 'floater';
      inner.textContent = text;
      inner.style.color = color;
      inner.style.setProperty('--c', color);
      inner.style.whiteSpace = 'nowrap';
      s.wrap.appendChild(inner);
      s.inner = inner;
      s.at.copy(at);
      s.born = performance.now();
      s.life = big ? 1350 : 1000;
      s.dx = (Math.random() - 0.5) * (big ? 20 : 34);
      s.rise = big ? 78 : 58;
      s.active = true;
      s.wrap.style.display = 'block';
      s.wrap.style.opacity = '0';
    };
    bus.floater = spawn;
    const off = onFx((e) => {
      if (e.kind === 'float') spawn(e.at, e.text, e.color, e.big);
    });
    return () => {
      off();
      if (bus.floater === spawn) bus.floater = null;
      layer.remove();
      pool.length = 0;
    };
  }, [gl, pool]);

  useFrame((state) => {
    const now = performance.now();
    const { width, height } = state.size;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i];
      if (!s.active) continue;
      const t = (now - s.born) / s.life;
      if (t >= 1) {
        s.active = false;
        s.wrap.style.display = 'none';
        continue;
      }
      tmp.copy(s.at).project(state.camera);
      if (tmp.z > 1 || tmp.z < -1) {
        s.wrap.style.opacity = '0';
        continue;
      }
      const e = easeOut(t);
      const x = (tmp.x * 0.5 + 0.5) * width + s.dx * e;
      const y = (-tmp.y * 0.5 + 0.5) * height - s.rise * e;
      const pop = t < 0.1 ? 0.55 + (t / 0.1) * 0.65 : 1.2 - Math.min(1, (t - 0.1) / 0.18) * 0.2;
      const alpha = t < 0.06 ? t / 0.06 : t > 0.62 ? 1 - (t - 0.62) / 0.38 : 1;
      s.wrap.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${pop.toFixed(3)})`;
      s.wrap.style.opacity = alpha.toFixed(3);
    }
  });

  return null;
}
