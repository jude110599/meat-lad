import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import { RESOURCE_DEFS } from '@starforge/shared';
import { onFx } from '../state/fx';
import { bus } from './bus';
import { easeOutBack, easeOutCubic } from './fxkit';

const POOL = 40;
/** Two numbers spawned this close together (px) and this soon after each other (ms) stack instead of overlapping. */
const STACK_PX = 64;
const STACK_MS = 450;
const LANE_PX = 22;
const ORE = RESOURCE_DEFS.ore.color;

interface Slot {
  wrap: HTMLDivElement;
  inner: HTMLDivElement | null;
  at: Vector3;
  born: number;
  life: number;
  /** Pixel offset from the anchor: stacking lane and sideways drift. */
  ox: number;
  oy: number;
  dx: number;
  rise: number;
  big: boolean;
  spin: number;
  /** Anchor in screen px at spawn, for stacking. */
  sx: number;
  sy: number;
  active: boolean;
}

/**
 * Floating yield numbers ("+12"), anchored to a world point and drawn as DOM
 * for crisp text. A fixed pool of absolutely positioned wrappers is moved
 * imperatively every frame: no React state, no per-number portals.
 *
 * Each number pops in with a springy overshoot, rises and drifts as it
 * slows, and fades; crits get a "CRIT" tag, a bigger pop and a little
 * twist. Numbers that land on top of each other stack upward in lanes. Ore
 * amounts carry a small ore gem.
 *
 * The wrapper owns position, rise, pop and fade. The inner element carries
 * the `floater` / `floater big` classes for typography and glow (styles.css),
 * plus `--c` and `color` set to the floater colour.
 */
export function Floaters() {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
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
      pool.push({ wrap, inner: null, at: new Vector3(), born: 0, life: 1, ox: 0, oy: 0, dx: 0, rise: 60, big: false, spin: 0, sx: 0, sy: 0, active: false });
    }
    let next = 0;
    const spawn = (at: Vector3, text: string, color: string, big: boolean) => {
      const s = pool[next];
      next = (next + 1) % POOL;
      // A fresh inner element restarts any CSS animation on .floater.
      s.inner?.remove();
      const inner = document.createElement('div');
      inner.className = big ? 'floater big' : 'floater';
      inner.style.color = color;
      inner.style.setProperty('--c', color);
      inner.style.whiteSpace = 'nowrap';
      Object.assign(inner.style, { display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: '1' });
      const crit = text.startsWith('CRIT ');
      const num = crit ? text.slice(5) : text;
      if (crit) {
        const tag = document.createElement('div');
        tag.textContent = 'CRIT!';
        Object.assign(tag.style, { fontSize: '0.5em', letterSpacing: '0.24em', marginBottom: '2px', paddingLeft: '0.24em', opacity: '0.95' });
        inner.appendChild(tag);
      }
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', gap: '0.18em' });
      const value = document.createElement('span');
      value.textContent = num;
      row.appendChild(value);
      if (num.startsWith('+')) {
        // A little ore gem after the amount.
        const gem = document.createElement('span');
        Object.assign(gem.style, {
          display: 'inline-block',
          width: '0.42em',
          height: '0.42em',
          background: ORE,
          transform: 'rotate(45deg)',
          borderRadius: '0.08em',
          boxShadow: `0 0 6px ${ORE}, 0 0 2px #fff inset`,
          marginLeft: '0.12em',
        });
        row.appendChild(gem);
      }
      inner.appendChild(row);
      s.wrap.appendChild(inner);
      s.inner = inner;
      s.at.copy(at);
      s.born = performance.now();
      s.big = big || crit;
      s.life = s.big ? 1400 : 1050;
      s.dx = (Math.random() - 0.5) * (s.big ? 16 : 26);
      s.rise = s.big ? 84 : 60;
      s.spin = s.big ? (Math.random() < 0.5 ? -1 : 1) * 7 : 0;

      // Stack on top of recent numbers that landed in the same spot.
      const st = get();
      tmp.copy(at).project(st.camera);
      s.sx = (tmp.x * 0.5 + 0.5) * st.size.width;
      s.sy = (-tmp.y * 0.5 + 0.5) * st.size.height;
      let lane = 0;
      for (const o of pool) {
        if (o === s || !o.active || s.born - o.born > STACK_MS) continue;
        if (Math.abs(o.sx - s.sx) < STACK_PX && Math.abs(o.sy + o.oy - s.sy) < LANE_PX * (lane + 1.5)) lane++;
      }
      s.oy = -lane * LANE_PX;
      s.ox = lane ? (lane % 2 ? 1 : -1) * Math.min(18, lane * 7) : 0;
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
  }, [gl, get, pool, tmp]);

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
      const e = easeOutCubic(t);
      const sway = Math.sin(t * Math.PI * 1.6 + i) * 3 * t;
      const x = (tmp.x * 0.5 + 0.5) * width + s.ox + s.dx * e + sway;
      const y = (-tmp.y * 0.5 + 0.5) * height + s.oy - s.rise * e;
      // Springy pop in, a gentle shrink on the way out.
      const popT = Math.min(1, t / (s.big ? 0.26 : 0.2));
      const pop = (0.35 + 0.65 * easeOutBack(popT, s.big ? 3.2 : 2.2)) * (s.big ? 1.12 : 1) * (t > 0.7 ? 1 - (t - 0.7) * 0.35 : 1);
      const alpha = t < 0.05 ? t / 0.05 : t > 0.66 ? 1 - (t - 0.66) / 0.34 : 1;
      const rot = s.spin * (1 - easeOutCubic(Math.min(1, t * 3)));
      s.wrap.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) translate(-50%,-50%) scale(${pop.toFixed(3)}) rotate(${rot.toFixed(2)}deg)`;
      s.wrap.style.opacity = alpha.toFixed(3);
    }
  });

  return null;
}
