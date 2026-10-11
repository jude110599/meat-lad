import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  ShaderMaterial,
  Shape,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Group,
} from 'three';
import { useShallow } from 'zustand/react/shallow';
import { onFx } from '../state/fx';
import { hueColor, refs } from '../state/refs';
import { useGame } from '../state/store';
import { sparks } from './bus';
import { mergeParts, ribbonMatrix, type Part } from './fxkit';
import { SEP, glowTexture, isLite, setCss, splitIds, useBundle } from './util';

const ORIGIN = new Vector3();
const WHITE = new Color(1, 1, 1);
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

const at = (g: BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
const alongZ = (g: BufferGeometry) => g.rotateX(Math.PI / 2);

/** A flat shape in the XZ plane (x right, y of the shape = forward), `depth` thick, centred on y = 0. */
function plate(pts: [number, number][], depth: number): BufferGeometry {
  const sh = new Shape(pts.map(([x, z]) => new Vector2(x, z)));
  return new ExtrudeGeometry(sh, { depth, bevelEnabled: false })
    .rotateX(Math.PI / 2)
    .translate(0, depth / 2, 0);
}
const mirror = (pts: [number, number][]): [number, number][] => pts.map(([x, z]) => [-x, z] as [number, number]).reverse();

/** A tail fin standing on y = 0 (the shape's x = forward, y = up), `depth` thick. */
function fin(pts: [number, number][], depth: number): BufferGeometry {
  const sh = new Shape(pts.map(([z, y]) => new Vector2(z, y)));
  return new ExtrudeGeometry(sh, { depth, bevelEnabled: false })
    .rotateY(-Math.PI / 2)
    .translate(depth / 2, 0, 0);
}

const WING: [number, number][] = [
  [0.07, 0.13],
  [0.37, -0.09],
  [0.39, -0.2],
  [0.07, -0.25],
];
const WING_TIP: [number, number][] = [
  [0.27, -0.02],
  [0.37, -0.09],
  [0.39, -0.2],
  [0.29, -0.215],
];
const FIN: [number, number][] = [
  [-0.12, 0],
  [-0.27, 0],
  [-0.31, 0.14],
  [-0.24, 0.14],
];

/** Model space: +Z is the nose, +Y up, the hull about 0.75 long with a 0.8 span. */
function makeShipGeometry() {
  const body = new LatheGeometry(
    [
      [0.001, -0.31],
      [0.062, -0.31],
      [0.088, -0.22],
      [0.098, -0.05],
      [0.082, 0.12],
      [0.05, 0.27],
      [0.001, 0.42],
    ].map(([r, y]) => new Vector2(r, y)),
    8,
  )
    .rotateX(Math.PI / 2)
    .scale(1, 0.72, 1);
  const hull: Part[] = [
    [body, '#d4dae3'],
    [plate(WING.concat(mirror(WING)), 0.022), '#aab3bf'],
    [at(alongZ(new CylinderGeometry(0.046, 0.052, 0.3, 10)), 0.135, -0.012, -0.12), '#8f99a6'],
    [at(alongZ(new CylinderGeometry(0.046, 0.052, 0.3, 10)), -0.135, -0.012, -0.12), '#8f99a6'],
    [at(alongZ(new CylinderGeometry(0.054, 0.054, 0.022, 10)), 0.135, -0.012, 0.03), '#3b414a'],
    [at(alongZ(new CylinderGeometry(0.054, 0.054, 0.022, 10)), -0.135, -0.012, 0.03), '#3b414a'],
    [at(alongZ(new CylinderGeometry(0.052, 0.04, 0.05, 10)), 0.135, -0.012, -0.29), '#353a42'],
    [at(alongZ(new CylinderGeometry(0.052, 0.04, 0.05, 10)), -0.135, -0.012, -0.29), '#353a42'],
    [at(new BoxGeometry(0.032, 0.03, 0.2), 0, 0.068, -0.1), '#9ba4b0'],
    [at(alongZ(new CylinderGeometry(0.014, 0.018, 0.08, 6)), 0, -0.05, 0.27), '#454c56'],
  ];
  const paint: Part[] = [
    [plate(WING_TIP, 0.027), '#ffffff'],
    [plate(mirror(WING_TIP), 0.027), '#ffffff'],
    [at(fin(FIN, 0.014).rotateZ(-0.38), 0.07, 0.04, 0), '#ffffff'],
    [at(fin(FIN, 0.014).rotateZ(0.38), -0.07, 0.04, 0), '#ffffff'],
    [at(alongZ(new ConeGeometry(0.053, 0.15, 8)).scale(1, 0.74, 1), 0, 0, 0.345), '#ffffff'],
  ];
  const glow: Part[] = [
    [at(alongZ(new CylinderGeometry(0.036, 0.036, 0.01, 12)), 0.135, -0.012, -0.317), '#ffffff'],
    [at(alongZ(new CylinderGeometry(0.036, 0.036, 0.01, 12)), -0.135, -0.012, -0.317), '#ffffff'],
    [at(new BoxGeometry(0.008, 0.012, 0.2), 0.093, 0.004, -0.04), '#9a9a9a'],
    [at(new BoxGeometry(0.008, 0.012, 0.2), -0.093, 0.004, -0.04), '#9a9a9a'],
    [at(new OctahedronGeometry(0.014, 0), 0, -0.05, 0.315), '#ffffff'],
  ];
  return {
    hull: mergeParts(hull),
    paint: mergeParts(paint),
    glow: mergeParts(glow),
    canopy: new SphereGeometry(0.06, 12, 8).scale(0.85, 0.62, 1.9).translate(0, 0.05, 0.1),
    ribbon: new PlaneGeometry(1, 1).translate(0, 0.5, 0),
  };
}
type ShipGeo = ReturnType<typeof makeShipGeometry>;

const ENGINES = [new Vector3(0.135, -0.012, -0.33), new Vector3(-0.135, -0.012, -0.33)];
const NAV = [new Vector3(0.385, 0, -0.16), new Vector3(-0.385, 0, -0.16)];
const PLUME_LEN = 0.75;
const TRAIL_RATE = isLite() ? 8 : 16;

const PLUME_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const PLUME_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // y: 0 at the nozzle, 1 at the end of the plume.
  float x = vUv.x * 2.0 - 1.0;
  float y = clamp(vUv.y, 0.0, 1.0);
  float w = mix(0.32, 1.0, y);
  float q = (x * x) / (w * w);
  float body = exp(-q * 3.0) * max(0.0, 1.0 - x * x);
  float core = exp(-q * 22.0) * (1.0 - y) * (1.0 - y);
  float flick = 0.72 + 0.18 * sin(y * 26.0 - uTime * 38.0 + uSeed) + 0.1 * sin(y * 61.0 - uTime * 71.0 + uSeed * 2.0);
  float fade = (1.0 - y) * (1.0 - y) * smoothstep(0.0, 0.04, y);
  gl_FragColor = vec4((uColor * body * flick + vec3(core * 1.6)) * fade, 1.0);
}
`;

/**
 * Other online players' ships, hovering beside the rock in fixed screen
 * slots, facing it: a sleek faceted hull with swept wings and twin tail
 * fins painted in the player's colour, a glowing cockpit, twin engines with
 * flickering glows, exhaust plumes and a light spark trail, blinking wingtip
 * lights, a little recoil when they fire, a name tag and emote bubbles.
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
      hull: new MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.42, flatShading: true, emissive: '#111826' }),
      paint: new MeshStandardMaterial({ metalness: 0.25, roughness: 0.4, flatShading: true }),
      glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
      canopy: new MeshStandardMaterial({ color: '#0b1a2a', metalness: 0.5, roughness: 0.15, emissive: '#ffffff', emissiveIntensity: 1 }),
      plumes: [0, 1].map(
        (i) =>
          new ShaderMaterial({
            vertexShader: PLUME_VERT,
            fragmentShader: PLUME_FRAG,
            uniforms: { uTime: { value: 0 }, uSeed: { value: i * 3.7 }, uColor: { value: new Color() } },
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
          }),
      ),
      thruster: new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true }),
      nav: [0, 1].map(() => new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true })),
    }),
    [],
  );
  const color = useMemo(() => setCss(new Color(), css), [css]);
  useEffect(() => {
    mats.paint.color.copy(color);
    mats.paint.emissive.copy(color);
    mats.paint.emissiveIntensity = 0.22;
    mats.glow.color.copy(color).lerp(WHITE, 0.15).multiplyScalar(2.8);
    mats.canopy.emissive.copy(color).lerp(WHITE, 0.35).multiplyScalar(0.7);
    for (const m of mats.plumes) (m.uniforms.uColor.value as Color).copy(color).lerp(WHITE, 0.2).multiplyScalar(1.8);
    mats.thruster.color.copy(color).lerp(WHITE, 0.3).multiplyScalar(2.2);
  }, [color, mats]);

  const objs = useMemo(() => {
    const thrusters = ENGINES.map((p) => {
      const s = new Sprite(mats.thruster);
      s.position.copy(p);
      return s;
    });
    const navs = NAV.map((p, i) => {
      const s = new Sprite(mats.nav[i]);
      s.position.copy(p);
      return s;
    });
    const plumes = mats.plumes.map((m) => {
      const mesh = new Mesh(geo.ribbon, m);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 4;
      return mesh;
    });
    return { thrusters, navs, plumes };
  }, [mats, geo]);

  const root = useRef<Group>(null!);
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
      kick: 0,
      acc: 0,
      a: new Vector3(),
      b: new Vector3(),
      back: new Vector3(),
      m: new Matrix4(),
    }),
    [],
  );

  useEffect(() => {
    refs.ships.set(id, anim.nose);
    return () => {
      if (refs.ships.get(id) === anim.nose) refs.ships.delete(id);
    };
  }, [id, anim]);

  // Recoil when this ship fires.
  useEffect(
    () =>
      onFx((e) => {
        if (e.kind === 'laser' && e.from === id) anim.kick = 1;
      }),
    [id, anim],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
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
    anim.kick = Math.max(0, anim.kick - dt * 6);
    const g = root.current;
    g.position.copy(anim.pos);
    g.lookAt(ORIGIN);
    g.rotateZ(Math.sin(t * 0.9 + anim.phase) * 0.12);
    g.rotateX(Math.sin(t * 0.7 + anim.phase * 2) * 0.04);
    if (anim.kick > 0) g.translateZ(-0.05 * anim.kick * anim.kick);
    g.updateMatrixWorld();
    anim.nose.set(0, -0.05, 0.4).applyMatrix4(g.matrixWorld);

    // Engines: flickering glow sprites, exhaust plumes streaming back, a light trail of sparks.
    const cam = state.camera;
    const boost = 1 + anim.kick * 0.5;
    anim.back.set(0, 0, -1).transformDirection(g.matrixWorld);
    for (let i = 0; i < 2; i++) {
      const f = 0.85 + Math.sin(t * 31 + anim.phase + i * 2.1) * 0.1 + Math.sin(t * 17 + i) * 0.06;
      objs.thrusters[i].scale.setScalar(0.3 * f * boost);
      anim.a.copy(ENGINES[i]).applyMatrix4(g.matrixWorld);
      anim.b.copy(anim.a).addScaledVector(anim.back, PLUME_LEN * (0.85 + 0.15 * f) * boost);
      ribbonMatrix(objs.plumes[i].matrix, anim.a, anim.b, 0.12 * boost, cam.position);
      objs.plumes[i].matrixWorldNeedsUpdate = true;
      mats.plumes[i].uniforms.uTime.value = t;
    }
    anim.acc += dt * TRAIL_RATE;
    if (anim.acc >= 1) {
      anim.acc -= 1;
      const i = Math.random() < 0.5 ? 0 : 1;
      anim.a.copy(ENGINES[i]).applyMatrix4(g.matrixWorld);
      sparks(anim.a, anim.back, mats.thruster.color, 1, 1.4, { spread: 0.25, life: 0.7, size: 0.7, drag: 1.2, white: 0.4 });
    }
    // Wingtip nav lights double-blink, out of step.
    for (let i = 0; i < 2; i++) {
      const ph = (t * 0.8 + anim.phase + i * 0.5) % 1;
      const on = ph < 0.05 || (ph > 0.12 && ph < 0.17) ? 1 : 0;
      mats.nav[i].color.copy(color).lerp(WHITE, 0.3).multiplyScalar(0.3 + on * 2.4);
      objs.navs[i].scale.setScalar(0.09 + on * 0.07);
    }

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
    <>
      <group ref={root} name={'ship:' + id}>
        <mesh geometry={geo.hull} material={mats.hull} />
        <mesh geometry={geo.paint} material={mats.paint} />
        <mesh geometry={geo.glow} material={mats.glow} />
        <mesh geometry={geo.canopy} material={mats.canopy} />
        {objs.thrusters.map((s, i) => (
          <primitive key={'t' + i} object={s} />
        ))}
        {objs.navs.map((s, i) => (
          <primitive key={'n' + i} object={s} />
        ))}
      </group>
      {objs.plumes.map((m, i) => (
        <primitive key={'p' + i} object={m} />
      ))}
    </>
  );
}
