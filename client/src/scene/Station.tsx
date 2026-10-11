import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
  type Group,
  type Material,
  type Mesh,
  type PointLight,
} from 'three';
import { MACHINE_DEFS, MACHINES, RESOURCE_DEFS, fmt, type MachineId } from '@starforge/shared';
import { act } from '../net/actions';
import { onFx } from '../state/fx';
import { refs } from '../state/refs';
import { useGame } from '../state/store';
import { floater, sparks } from './bus';
import { MACHINE_ANGLE, STATION_POS, machineLocal, machineWorld } from './layout';
import { buffActive, damp, glowTexture, hostNow, useBundle } from './util';

export { STATION_POS };

const GOLD = new Color('#ffcf5a');
const CYAN = new Color('#7fd8ff');
const BEACON = new Color('#ff3b30');
const PANEL_BLUE = new Color('#2a5aa8');
const LAMP = new Color('#9fc4ff');
const Y_UP = new Vector3(0, 1, 0);
const RING_LIGHTS = 16;

type Geo = ReturnType<typeof makeGeometry>;
function makeGeometry() {
  return {
    base: new BoxGeometry(0.74, 0.1, 0.74),
    box: new BoxGeometry(0.56, 0.48, 0.5),
    mouth: new PlaneGeometry(0.3, 0.16),
    strip: new BoxGeometry(0.035, 0.28, 0.3),
    chimney: new CylinderGeometry(0.055, 0.075, 0.36, 8),
    ember: new SphereGeometry(0.05, 8, 6),
    hopper: new CylinderGeometry(0.2, 0.09, 0.18, 8),
    tank: new CylinderGeometry(0.2, 0.2, 0.58, 14),
    tankRing: new TorusGeometry(0.235, 0.022, 6, 28),
    dome: new SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    window: new BoxGeometry(0.06, 0.38, 0.03),
    pillar: new BoxGeometry(0.06, 0.62, 0.06),
    plate: new BoxGeometry(0.58, 0.08, 0.58),
    anvil: new BoxGeometry(0.44, 0.16, 0.44),
    hammer: new BoxGeometry(0.34, 0.16, 0.34),
    slab: new BoxGeometry(0.3, 0.025, 0.3),
    orb: new SphereGeometry(0.15, 18, 12),
    gyro: new TorusGeometry(0.3, 0.016, 6, 40),
    gyro2: new TorusGeometry(0.24, 0.012, 6, 36),
    pedestal: new CylinderGeometry(0.1, 0.2, 0.28, 8),
    hit: new BoxGeometry(0.95, 1.1, 0.95),
    // Hub.
    core: new CylinderGeometry(0.42, 0.5, 1.15, 12),
    cap: new SphereGeometry(0.42, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    band: new TorusGeometry(0.47, 0.035, 6, 36),
    ring: new TorusGeometry(1.18, 0.045, 6, 72),
    spoke: new BoxGeometry(2.36, 0.03, 0.03),
    strut: new BoxGeometry(1.0, 0.05, 0.05),
    mast: new CylinderGeometry(0.018, 0.018, 0.9, 5),
    beacon: new SphereGeometry(0.045, 8, 6),
    panel: new BoxGeometry(0.95, 0.02, 0.34),
    ringLight: new BoxGeometry(0.07, 0.045, 0.07),
  };
}

/**
 * Refinery station: a hub with a slowly turning ring and four machine
 * modules (smelter, infuser, compressor, condenser), each tinted with its
 * output resource. Unbuilt machines are wireframe ghosts; built ones light up
 * and work faster while production flows. Tap a built machine to press it.
 */
export function Station() {
  const geo = useBundle<Geo>(makeGeometry, []);
  return (
    <group position={STATION_POS}>
      <Hub geo={geo} />
      {MACHINES.map((m) => (
        <Machine key={m} id={m} geo={geo} />
      ))}
    </group>
  );
}

/* ---------------- hub ---------------- */

function Hub({ geo }: { geo: Geo }) {
  const mats = useBundle(
    () => ({
      hull: new MeshStandardMaterial({ color: '#9aa3b5', metalness: 0.7, roughness: 0.38, flatShading: true }),
      dark: new MeshStandardMaterial({ color: '#2b303b', metalness: 0.6, roughness: 0.5, flatShading: true }),
      band: new MeshStandardMaterial({ color: '#0b1016', emissive: CYAN, emissiveIntensity: 2.2 }),
      panel: new MeshStandardMaterial({ color: '#16233f', metalness: 0.4, roughness: 0.3, emissive: PANEL_BLUE, emissiveIntensity: 0.4 }),
      beacon: new MeshBasicMaterial({ color: BEACON, toneMapped: false }),
      light: new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }),
      halo: new SpriteMaterial({ map: glowTexture(), color: GOLD, blending: AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }),
    }),
    [],
  );

  const objs = useMemo(() => {
    const lights = new InstancedMesh(geo.ringLight, mats.light, RING_LIGHTS);
    lights.instanceColor = new InstancedBufferAttribute(new Float32Array(RING_LIGHTS * 3), 3).setUsage(DynamicDrawUsage);
    const m = new Matrix4();
    for (let i = 0; i < RING_LIGHTS; i++) {
      const a = (i / RING_LIGHTS) * Math.PI * 2;
      m.makeTranslation(Math.cos(a) * 1.18, 0.05, Math.sin(a) * 1.18);
      lights.setMatrixAt(i, m);
    }
    lights.instanceMatrix.needsUpdate = true;
    lights.computeBoundingSphere();
    const halo = new Sprite(mats.halo);
    halo.scale.setScalar(6);
    halo.position.set(0, 0.2, 0);
    return { lights, halo };
  }, [geo, mats]);
  useEffect(() => () => objs.lights.dispose(), [objs]);

  const ring = useRef<Group>(null!);
  const beacon = useRef<Mesh>(null!);
  const lamp = useRef<PointLight>(null!);
  const sim = useMemo(() => ({ solar: 0, c: new Color() }), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const s = useGame.getState().s;
    sim.solar = damp(sim.solar, s && buffActive(s, 'solar', hostNow()) ? 1 : 0, 2.5, dt);
    const sol = sim.solar;
    ring.current.rotation.y += dt * (0.18 + sol * 0.4);

    mats.band.emissive.copy(CYAN).lerp(GOLD, sol);
    mats.band.emissiveIntensity = 2 + Math.sin(t * 2) * 0.4 + sol * 2;
    mats.panel.emissive.copy(PANEL_BLUE).lerp(GOLD, sol);
    mats.panel.emissiveIntensity = 0.4 + sol * (1.6 + Math.sin(t * 3) * 0.4);
    mats.hull.emissive.copy(GOLD);
    mats.hull.emissiveIntensity = sol * 0.25;
    mats.halo.opacity = sol * (0.55 + Math.sin(t * 2.4) * 0.12);
    objs.halo.visible = sol > 0.01;

    const blink = Math.sin(t * 3.1) > 0.7 ? 3 : 0.25;
    mats.beacon.color.copy(BEACON).multiplyScalar(blink);
    beacon.current.scale.setScalar(blink > 1 ? 1.3 : 1);

    // Chase lights around the ring.
    const lights = objs.lights;
    for (let i = 0; i < RING_LIGHTS; i++) {
      const head = (t * 6) % RING_LIGHTS;
      let d = Math.abs(i - head);
      d = Math.min(d, RING_LIGHTS - d);
      const k = Math.max(0, 1 - d / 3);
      sim.c.copy(CYAN).lerp(GOLD, sol).multiplyScalar(0.4 + k * 3);
      lights.setColorAt(i, sim.c);
    }
    if (lights.instanceColor) lights.instanceColor.needsUpdate = true;

    lamp.current.color.copy(LAMP).lerp(GOLD, sol);
    lamp.current.intensity = 7 + sol * 10;
  });

  return (
    <group>
      <mesh geometry={geo.core} material={mats.hull} />
      <mesh geometry={geo.cap} material={mats.hull} position={[0, 0.575, 0]} />
      <mesh geometry={geo.cap} material={mats.dark} position={[0, -0.575, 0]} rotation={[Math.PI, 0, 0]} />
      <mesh geometry={geo.band} material={mats.band} position={[0, 0.18, 0]} rotation={[Math.PI / 2, 0, 0]} />
      <mesh geometry={geo.band} material={mats.band} position={[0, -0.3, 0]} rotation={[Math.PI / 2, 0, 0]} scale={1.05} />
      <mesh geometry={geo.mast} material={mats.dark} position={[0, 1.3, 0]} />
      <mesh ref={beacon} geometry={geo.beacon} material={mats.beacon} position={[0, 1.78, 0]} />
      {/* Solar wings. */}
      <mesh geometry={geo.panel} material={mats.panel} position={[0.98, 0.95, 0]} rotation={[0.25, 0, 0]} />
      <mesh geometry={geo.panel} material={mats.panel} position={[-0.98, 0.95, 0]} rotation={[0.25, 0, 0]} />
      <mesh geometry={geo.strut} material={mats.dark} position={[0, 0.95, 0]} scale={[1.1, 0.6, 0.6]} />
      {/* Turning ring with spokes and chase lights. */}
      <group ref={ring}>
        <mesh geometry={geo.ring} material={mats.hull} position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]} />
        <mesh geometry={geo.spoke} material={mats.dark} position={[0, 0.05, 0]} />
        <mesh geometry={geo.spoke} material={mats.dark} position={[0, 0.05, 0]} rotation={[0, Math.PI / 2, 0]} />
        <primitive object={objs.lights} />
      </group>
      {/* Struts out to each machine. */}
      {MACHINES.map((m) => {
        const a = MACHINE_ANGLE[m];
        const r = 1.05;
        return (
          <mesh key={m} geometry={geo.strut} material={mats.dark} position={[Math.cos(a) * r, -0.36, Math.sin(a) * r]} rotation={[0, -a, 0]} scale={[1.15, 1, 1]} />
        );
      })}
      <primitive object={objs.halo} />
      <pointLight ref={lamp} position={[0, 1.9, 1.3]} intensity={7} distance={9} decay={2} />
    </group>
  );
}

/* ---------------- machines ---------------- */

interface MachineMats {
  body: Material;
  dark: Material;
  panel: Material;
  glow: Material;
}

interface MachineAnim {
  /** 0 idle .. 1 producing, eased. */
  speed: number;
  /** Accumulated work phase; advances faster while producing. */
  phase: number;
  /** Press flash 0..1. */
  flash: number;
  x: number;
  v: number;
}

function Machine({ id, geo }: { id: MachineId; geo: Geo }) {
  const def = MACHINE_DEFS[id];
  const outCss = RESOURCE_DEFS[def.output].color;
  const out = useMemo(() => new Color(outCss), [outCss]);
  const built = useGame((st) => (st.s?.levels[id] ?? 0) > 0);

  const mats = useBundle(
    () => ({
      body: new MeshStandardMaterial({ color: '#8d96a8', metalness: 0.7, roughness: 0.38, flatShading: true }),
      dark: new MeshStandardMaterial({ color: '#262b36', metalness: 0.55, roughness: 0.55, flatShading: true }),
      panel: new MeshStandardMaterial({ color: '#0a0c10', emissive: out, emissiveIntensity: 1.5, roughness: 0.4 }),
      glow: new MeshBasicMaterial({ color: out, toneMapped: false }),
      ghost: new MeshBasicMaterial({ color: out, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false }),
    }),
    [out],
  );
  const use: MachineMats = built ? mats : { body: mats.ghost, dark: mats.ghost, panel: mats.ghost, glow: mats.ghost };

  const local = useMemo(() => machineLocal(id, new Vector3()), [id]);
  const rotY = Math.PI / 2 - MACHINE_ANGLE[id];
  const pulse = useRef<Group>(null!);
  const anim = useMemo<MachineAnim>(() => ({ speed: 0, phase: Math.random() * 10, flash: 0, x: 0, v: 0 }), []);
  const tmp = useMemo(() => ({ at: new Vector3(), c: new Color() }), []);

  useEffect(() => {
    const w = machineWorld(id, new Vector3());
    refs.machines.set(id, w);
    return () => {
      if (refs.machines.get(id) === w) refs.machines.delete(id);
    };
  }, [id]);

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind !== 'press' || e.machine !== id) return;
        anim.v += e.sync ? 7 : 5.5;
        anim.flash = 1;
        machineWorld(id, tmp.at).y += 0.45;
        sparks(tmp.at, Y_UP, out, e.sync ? 36 : 22, 3.4, { spread: 1.1, white: 0.35, life: 0.7 });
        if (e.made > 0) {
          tmp.at.y += 0.3;
          floater(tmp.at, `+${fmt(e.made)}`, RESOURCE_DEFS[e.output].color, e.sync);
        }
      }),
    [id, anim, out, tmp],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const t = state.clock.elapsedTime;
    const s = useGame.getState().s;
    let target = 0;
    let solar = 0;
    if (s && s.levels[id] > 0) {
      const on = s.machinesOn[id];
      const flowing = on && (s.rates[def.output] > 0 || s.wallet[def.input] >= def.ratio);
      target = flowing ? 1 : on ? 0.22 : 0.04;
      solar = buffActive(s, 'solar', hostNow()) ? 1 : 0;
    }
    anim.speed = damp(anim.speed, target, 3, dt);
    anim.phase += dt * (0.4 + anim.speed * (4.5 + solar * 3));
    anim.flash = Math.max(0, anim.flash - dt * 3.5);

    // Press: punchy overshoot.
    anim.v += (-320 * anim.x - 13 * anim.v) * dt;
    anim.x += anim.v * dt;
    const sc = 1 + Math.max(-0.2, Math.min(0.35, anim.x * 0.35));
    pulse.current.scale.set(sc, 1 + (sc - 1) * 1.4, sc);

    if (built) {
      const beat = 0.5 + 0.5 * Math.sin(anim.phase * 2);
      tmp.c.copy(out).lerp(GOLD, solar * 0.45);
      mats.panel.emissive.copy(tmp.c);
      mats.panel.emissiveIntensity = (0.5 + anim.speed * 1.3 + beat * (0.3 + anim.speed * 1.8) + anim.flash * 4) * (1 + solar * 0.5);
      mats.glow.color.copy(tmp.c).multiplyScalar(0.8 + anim.speed * 1.6 + beat * anim.speed * 1.2 + anim.flash * 3);
    } else {
      mats.ghost.opacity = 0.1 + 0.07 * Math.sin(t * 2 + MACHINE_ANGLE[id]);
    }
  });

  useEffect(
    () => () => {
      document.body.style.cursor = '';
    },
    [built],
  );

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.nativeEvent.button > 0) return;
    act.press(id);
  };
  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
  };
  const onOut = () => {
    document.body.style.cursor = '';
  };

  return (
    <group position={local} rotation={[0, rotY, 0]}>
      <group ref={pulse}>
        {id === 'smelter' && <Smelter geo={geo} m={use} anim={anim} built={built} />}
        {id === 'infuser' && <Infuser geo={geo} m={use} anim={anim} />}
        {id === 'compressor' && <Compressor geo={geo} m={use} anim={anim} />}
        {id === 'condenser' && <Condenser geo={geo} m={use} anim={anim} />}
      </group>
      {built && <mesh geometry={geo.hit} visible={false} onPointerDown={onDown} onPointerOver={onOver} onPointerOut={onOut} />}
    </group>
  );
}

interface ModelProps {
  geo: Geo;
  m: MachineMats;
  anim: MachineAnim;
}

const SMOKE = new Color('#ff9a4a');

function Smelter({ geo, m, anim, built }: ModelProps & { built: boolean }) {
  const ember = useRef<Mesh>(null!);
  const top = useRef<Mesh>(null!);
  const next = useRef(0);
  const tmp = useMemo(() => new Vector3(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ember.current.scale.setScalar(0.8 + 0.4 * Math.abs(Math.sin(anim.phase * 3)) * anim.speed);
    if (built && anim.speed > 0.5 && t > next.current) {
      next.current = t + 0.25 + Math.random() * 0.5;
      top.current.getWorldPosition(tmp);
      sparks(tmp, Y_UP, SMOKE, 3, 1.4, { spread: 0.5, life: 0.9, size: 0.8, drag: 1.2, white: 0.1 });
    }
  });
  return (
    <>
      <mesh geometry={geo.base} material={m.dark} position={[0, -0.38, 0]} />
      <mesh geometry={geo.box} material={m.body} position={[0, -0.09, 0]} />
      <mesh geometry={geo.mouth} material={m.glow} position={[0, -0.13, 0.252]} />
      <mesh geometry={geo.strip} material={m.panel} position={[0.285, -0.09, 0]} />
      <mesh geometry={geo.strip} material={m.panel} position={[-0.285, -0.09, 0]} />
      <mesh geometry={geo.hopper} material={m.dark} position={[-0.08, 0.24, 0.02]} />
      <mesh geometry={geo.chimney} material={m.body} position={[0.17, 0.33, -0.13]} />
      <mesh ref={top} geometry={geo.ember} material={m.glow} position={[0.17, 0.53, -0.13]} visible={false} />
      <mesh ref={ember} geometry={geo.ember} material={m.glow} position={[-0.08, 0.34, 0.02]} />
    </>
  );
}

function Infuser({ geo, m, anim }: ModelProps) {
  const r1 = useRef<Mesh>(null!);
  const r2 = useRef<Mesh>(null!);
  useFrame(() => {
    const p = anim.phase;
    r1.current.position.y = -0.12 + Math.sin(p * 2) * 0.06 * (0.3 + anim.speed);
    r2.current.position.y = 0.13 + Math.sin(p * 2 + 2) * 0.06 * (0.3 + anim.speed);
    r1.current.rotation.set(Math.PI / 2 + Math.sin(p) * 0.15, Math.cos(p * 1.3) * 0.15, 0);
    r2.current.rotation.set(Math.PI / 2 + Math.cos(p) * 0.15, Math.sin(p * 1.1) * 0.15, 0);
  });
  return (
    <>
      <mesh geometry={geo.base} material={m.dark} position={[0, -0.38, 0]} />
      <mesh geometry={geo.tank} material={m.body} position={[0, -0.04, 0]} />
      <mesh geometry={geo.dome} material={m.body} position={[0, 0.25, 0]} />
      <mesh geometry={geo.window} material={m.panel} position={[0, -0.04, 0.2]} />
      <mesh geometry={geo.window} material={m.panel} position={[0, -0.04, -0.2]} />
      <mesh ref={r1} geometry={geo.tankRing} material={m.glow} />
      <mesh ref={r2} geometry={geo.tankRing} material={m.glow} />
    </>
  );
}

function Compressor({ geo, m, anim }: ModelProps) {
  const hammer = useRef<Mesh>(null!);
  useFrame(() => {
    // Slow lift, fast slam.
    const c = (anim.phase * 0.5) % 1;
    const lift = c < 0.8 ? c / 0.8 : 1 - (c - 0.8) / 0.2;
    hammer.current.position.y = -0.03 + lift * lift * 0.19 * (0.25 + anim.speed * 0.75);
  });
  return (
    <>
      <mesh geometry={geo.base} material={m.dark} position={[0, -0.38, 0]} />
      <mesh geometry={geo.anvil} material={m.dark} position={[0, -0.25, 0]} />
      <mesh geometry={geo.slab} material={m.glow} position={[0, -0.16, 0]} />
      <mesh geometry={geo.pillar} material={m.body} position={[0.24, -0.02, 0.24]} />
      <mesh geometry={geo.pillar} material={m.body} position={[-0.24, -0.02, 0.24]} />
      <mesh geometry={geo.pillar} material={m.body} position={[0.24, -0.02, -0.24]} />
      <mesh geometry={geo.pillar} material={m.body} position={[-0.24, -0.02, -0.24]} />
      <mesh geometry={geo.plate} material={m.body} position={[0, 0.31, 0]} />
      <mesh ref={hammer} geometry={geo.hammer} material={m.panel} />
    </>
  );
}

function Condenser({ geo, m, anim }: ModelProps) {
  const orb = useRef<Mesh>(null!);
  const g1 = useRef<Mesh>(null!);
  const g2 = useRef<Mesh>(null!);
  const g3 = useRef<Mesh>(null!);
  useFrame(() => {
    const p = anim.phase;
    orb.current.scale.setScalar(0.9 + 0.15 * Math.sin(p * 3) * (0.3 + anim.speed));
    g1.current.rotation.set(p * 0.9, 0, 0.4);
    g2.current.rotation.set(0.3, p * 1.2, p * 0.7);
    g3.current.rotation.set(Math.PI / 2, 0, -p * 1.6);
  });
  return (
    <>
      <mesh geometry={geo.base} material={m.dark} position={[0, -0.38, 0]} />
      <mesh geometry={geo.pedestal} material={m.dark} position={[0, -0.2, 0]} />
      <mesh ref={orb} geometry={geo.orb} material={m.glow} position={[0, 0.1, 0]} />
      <mesh ref={g1} geometry={geo.gyro} material={m.body} position={[0, 0.1, 0]} />
      <mesh ref={g2} geometry={geo.gyro2} material={m.panel} position={[0, 0.1, 0]} />
      <mesh ref={g3} geometry={geo.gyro} material={m.panel} position={[0, 0.1, 0]} scale={1.18} />
    </>
  );
}
