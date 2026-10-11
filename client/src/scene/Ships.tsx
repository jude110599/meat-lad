import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Group,
  type Mesh,
} from 'three';
import { useShallow } from 'zustand/react/shallow';
import { hueColor, refs } from '../state/refs';
import { useGame } from '../state/store';
import { SEP, glowTexture, setCss, splitIds, useBundle } from './util';

const ORIGIN = new Vector3();
const UP = new Vector3(0, 1, 0);
/** Screen-space spread of the ring the ships hover on, around the rock's silhouette. */
const HALO_R = 2.35;
/** How far the ring sits toward the camera, so ships hover in front of the rock's edge. */
const HALO_PUSH = 1.55;
/**
 * Clock angles around the rock (0 = straight up, positive = screen right),
 * in order of preference. Slots that a HUD panel covers are skipped.
 */
const CANDIDATES = [2.55, -2.55, Math.PI, 1.95, -1.95, 0.55, -0.55, 1.3, -1.3, 0];

/** A point on the halo for `angle`, given the camera position seen from the rock. */
function haloPoint(camPos: Vector3, angle: number, out: Vector3, tmp: { cam: Vector3; up: Vector3; right: Vector3 }, bob = 0): Vector3 {
  const { cam, up, right } = tmp;
  cam.copy(camPos).normalize();
  up.copy(UP).addScaledVector(cam, -cam.y);
  if (up.lengthSq() < 1e-4) up.set(0, 0, -1);
  up.normalize();
  right.crossVectors(up, cam);
  return out
    .copy(cam)
    .multiplyScalar(HALO_PUSH)
    .addScaledVector(up, Math.cos(angle) * HALO_R + bob)
    .addScaledVector(right, Math.sin(angle) * HALO_R);
}

/** Emote ids the HUD might send, mapped to a glyph; unknown ids are shown as-is. */
const EMOTES: Record<string, string> = {
  wave: '👋',
  hi: '👋',
  hello: '👋',
  gg: '🤝',
  nice: '👍',
  thumbs: '👍',
  ok: '👌',
  yes: '✅',
  no: '❌',
  fire: '🔥',
  heart: '❤️',
  love: '❤️',
  lol: '😂',
  laugh: '😂',
  wow: '😮',
  cool: '😎',
  sad: '😢',
  think: '🤔',
  go: '🚀',
  rocket: '🚀',
  help: '🆘',
  sos: '🆘',
  party: '🎉',
  star: '⭐',
  gem: '💎',
  ore: '⛏️',
  power: '⚡',
  zap: '⚡',
};
export const emoteGlyph = (id: string): string => EMOTES[id] ?? id;

type ShipGeo = ReturnType<typeof makeShipGeometry>;
function makeShipGeometry() {
  return {
    body: new CylinderGeometry(0.06, 0.12, 0.5, 7).rotateX(Math.PI / 2),
    nose: new ConeGeometry(0.06, 0.18, 7).rotateX(Math.PI / 2),
    wing: new BoxGeometry(0.64, 0.022, 0.17),
    fin: new BoxGeometry(0.02, 0.15, 0.13),
    canopy: new SphereGeometry(0.055, 10, 8),
    tip: new SphereGeometry(0.022, 6, 5),
    flame: new ConeGeometry(0.07, 0.3, 8, 1, true).rotateX(-Math.PI / 2),
  };
}

/**
 * Other online players' ships, hovering beside the rock in fixed screen
 * slots, facing it, with a thruster glow, a name tag and emote bubbles.
 * Keeps `refs.ships` (laser origins) current every frame.
 */
export function Ships() {
  const key = useGame((st) => {
    const s = st.s;
    if (!s) return '';
    const ids: string[] = [];
    for (const p of Object.values(s.players)) if (p.online && p.id !== st.me) ids.push(p.id);
    return ids.sort().join(SEP);
  });
  const ids = useMemo(() => splitIds(key), [key]);
  const geo = useBundle<ShipGeo>(makeShipGeometry, []);

  useEffect(() => {
    for (const id of [...refs.ships.keys()]) if (!ids.includes(id)) refs.ships.delete(id);
  }, [ids]);
  useEffect(() => () => refs.ships.clear(), []);

  // Twice a second, find the halo slots the HUD leaves visible and hand them
  // out in order of preference, so teammates never hide behind a panel.
  const gl = useThree((st) => st.gl);
  const slots = useMemo(() => ({ angles: CANDIDATES.slice(), next: 0, p: new Vector3(), tmp: { cam: new Vector3(), up: new Vector3(), right: new Vector3() } }), []);
  useFrame((state) => {
    const now = state.clock.elapsedTime;
    if (now < slots.next || !ids.length) return;
    slots.next = now + 0.5;
    const rect = gl.domElement.getBoundingClientRect();
    const free: number[] = [];
    const covered: number[] = [];
    for (const a of CANDIDATES) {
      haloPoint(state.camera.position, a, slots.p, slots.tmp).project(state.camera);
      const x = rect.left + (slots.p.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-slots.p.y * 0.5 + 0.5) * rect.height;
      // Check the ship and both ends of the name tag above it.
      const open = (px: number, py: number) => document.elementFromPoint(px, py) === gl.domElement;
      const clear = Math.abs(slots.p.x) < 0.95 && Math.abs(slots.p.y) < 0.9 && open(x, y) && open(x - 50, y - 26) && open(x + 50, y - 26);
      (clear ? free : covered).push(a);
    }
    slots.angles = free.concat(covered);
  });

  return (
    <>
      {ids.map((id, i) => (
        <Ship key={id} id={id} slot={i} slots={slots} geo={geo} />
      ))}
    </>
  );
}

function Ship({ id, slot, slots, geo }: { id: string; slot: number; slots: { angles: number[] }; geo: ShipGeo }) {
  const [name, hue] = useGame(
    useShallow((st) => {
      const p = st.s?.players[id];
      return [p?.name ?? '', p?.hue ?? 200] as const;
    }),
  );
  const emote = useGame((st) => st.emotes[id]);
  const css = hueColor(hue);

  const mats = useBundle(
    () => ({
      hull: new MeshStandardMaterial({ color: '#c9cfdc', metalness: 0.65, roughness: 0.32, flatShading: true }),
      paint: new MeshStandardMaterial({ metalness: 0.4, roughness: 0.4, flatShading: true }),
      glow: new MeshBasicMaterial({ toneMapped: false }),
      flame: new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      thruster: new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true }),
    }),
    [],
  );
  const color = useMemo(() => setCss(new Color(), css), [css]);
  useEffect(() => {
    mats.paint.color.copy(color);
    mats.paint.emissive.copy(color);
    mats.paint.emissiveIntensity = 0.15;
    mats.glow.color.copy(color).multiplyScalar(2.6);
    mats.flame.color.copy(color).lerp(new Color(1, 1, 1), 0.35).multiplyScalar(2.2);
    mats.thruster.color.copy(color).multiplyScalar(2);
  }, [color, mats]);

  const thruster = useMemo(() => {
    const s = new Sprite(mats.thruster);
    s.position.set(0, 0, -0.33);
    return s;
  }, [mats]);

  const root = useRef<Group>(null!);
  const flame = useRef<Mesh>(null!);
  const gl = useThree((st) => st.gl);

  // Name tag and emote bubble as plain DOM next to the canvas, positioned
  // every frame. (drei <Html> double-removes its content on unmount under
  // React 19, which throws when a teammate leaves.)
  const tag = useMemo(() => {
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', willChange: 'transform', zIndex: '2', display: 'none' });
    const box = document.createElement('div');
    Object.assign(box.style, { position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', transform: 'translate(-50%, -100%)' });
    const bubble = document.createElement('div');
    bubble.className = 'emote';
    Object.assign(bubble.style, {
      position: 'absolute',
      bottom: '100%',
      left: '50%',
      marginBottom: '6px',
      padding: '3px 8px',
      borderRadius: '12px',
      background: 'rgba(12,14,24,0.85)',
      fontSize: '18px',
      lineHeight: '22px',
      whiteSpace: 'nowrap',
      opacity: '0',
      transform: 'translate(-50%, 6px) scale(0.6)',
      transition: 'opacity 0.18s ease-out, transform 0.22s cubic-bezier(0.3, 1.6, 0.5, 1)',
    });
    const label = document.createElement('div');
    label.className = 'shiptag';
    Object.assign(label.style, {
      padding: '2px 7px',
      borderRadius: '999px',
      fontSize: '11px',
      fontWeight: '700',
      letterSpacing: '0.04em',
      whiteSpace: 'nowrap',
      background: 'rgba(8,10,18,0.66)',
      textShadow: '0 1px 3px rgba(0,0,0,0.9)',
    });
    box.append(bubble, label);
    el.append(box);
    return { el, bubble, label, p: new Vector3() };
  }, []);
  useEffect(() => {
    gl.domElement.parentElement?.appendChild(tag.el);
    return () => tag.el.remove();
  }, [gl, tag]);
  useEffect(() => {
    tag.label.textContent = name;
    tag.label.style.color = css;
    tag.label.style.border = `1px solid ${hueColor(hue, 40)}`;
    tag.bubble.style.border = `1px solid ${css}`;
    tag.bubble.style.boxShadow = `0 0 12px ${hueColor(hue, 40)}`;
  }, [tag, name, css, hue]);
  useEffect(() => {
    if (emote) tag.bubble.textContent = emoteGlyph(emote.id);
  }, [tag, emote]);
  const anim = useMemo(
    () => ({
      placed: false,
      pos: new Vector3(),
      target: new Vector3(),
      nose: new Vector3(),
      basis: { cam: new Vector3(), up: new Vector3(), right: new Vector3() },
      shown: false,
      phase: Math.random() * 10,
    }),
    [],
  );

  useEffect(() => {
    refs.ships.set(id, anim.nose);
    return () => {
      if (refs.ships.get(id) === anim.nose) refs.ships.delete(id);
    };
  }, [id, anim]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    // Teammates hover on a halo around the rock's silhouette as seen from
    // this camera, a little in front of it, so they stay in view wherever
    // the camera orbits and never sit dead centre over the rock.
    const a = slots.angles[slot % slots.angles.length] + Math.sin(t * 0.21 + anim.phase) * 0.08;
    haloPoint(state.camera.position, a, anim.target, anim.basis, Math.sin(t * 1.3 + anim.phase) * 0.06);
    if (!anim.placed) {
      anim.pos.copy(anim.target);
      anim.placed = true;
    } else anim.pos.lerp(anim.target, 1 - Math.exp(-dt * 2));
    const g = root.current;
    g.position.copy(anim.pos);
    g.lookAt(ORIGIN);
    g.rotateZ(Math.sin(t * 0.9 + anim.phase) * 0.12);
    g.updateMatrixWorld();
    anim.nose.set(0, 0, 0.42).applyMatrix4(g.matrixWorld);

    const f = 0.85 + Math.sin(t * 31 + anim.phase) * 0.1 + Math.sin(t * 17) * 0.08;
    flame.current.scale.set(f, f, 0.8 + f * 0.6);
    thruster.scale.setScalar(0.42 * f);

    const show = !!emote && Date.now() - emote.at < 3000;
    if (show !== anim.shown) {
      anim.shown = show;
      tag.bubble.style.opacity = show ? '1' : '0';
      tag.bubble.style.transform = show ? 'translate(-50%, 0) scale(1)' : 'translate(-50%, 6px) scale(0.6)';
    }
    // Project the tag anchor (just above the ship) to screen space.
    tag.p.set(0, 0.34, 0).applyMatrix4(g.matrixWorld).project(state.camera);
    if (tag.p.z > 1 || Math.abs(tag.p.x) > 1.2 || Math.abs(tag.p.y) > 1.2) {
      tag.el.style.display = 'none';
    } else {
      tag.el.style.display = 'block';
      const x = (tag.p.x * 0.5 + 0.5) * state.size.width;
      const y = (-tag.p.y * 0.5 + 0.5) * state.size.height;
      tag.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
  });

  return (
    <group ref={root}>
      <mesh geometry={geo.body} material={mats.hull} />
      <mesh geometry={geo.nose} material={mats.paint} position={[0, 0, 0.33]} />
      <mesh geometry={geo.wing} material={mats.paint} position={[0, -0.01, -0.06]} />
      <mesh geometry={geo.fin} material={mats.paint} position={[0, 0.08, -0.18]} />
      <mesh geometry={geo.canopy} material={mats.glow} position={[0, 0.06, 0.08]} scale={[1, 0.7, 1.5]} />
      <mesh geometry={geo.tip} material={mats.glow} position={[0.32, -0.01, -0.06]} />
      <mesh geometry={geo.tip} material={mats.glow} position={[-0.32, -0.01, -0.06]} />
      <mesh ref={flame} geometry={geo.flame} material={mats.flame} position={[0, 0, -0.27]} />
      <primitive object={thruster} />
    </group>
  );
}
