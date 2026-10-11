import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { AdditiveBlending, Color, FrontSide, MeshStandardMaterial, ShaderMaterial, Vector3, type Group, type Mesh } from 'three';
import { surgeOn } from '@starforge/shared';
import { act } from '../net/actions';
import { onFx } from '../state/fx';
import { refs } from '../state/refs';
import { useGame } from '../state/store';
import { buildRock } from './geometry';
import { Rigs } from './Rigs';
import { Scorches } from './Scorches';
import { Seams } from './Seams';
import { damp, hostNow, tapOk, useBundle, useDisposable } from './util';

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  vLocal = position;
  gl_Position = projectionMatrix * mv;
}
`;

const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform float uRes;
uniform vec3 uHeatColor;
varying vec3 vN;
varying vec3 vV;
varying vec3 vLocal;
void main() {
  float f = clamp(1.0 - dot(normalize(vN), normalize(vV)), 0.0, 1.0);
  float rim = pow(f, 2.4);
  // Heat crawls over the surface.
  float crawl = 0.7 + 0.3 * sin(vLocal.y * 5.0 + uTime * 3.1) * sin(vLocal.x * 4.3 - uTime * 2.2 + vLocal.z * 3.0);
  vec3 col = uHeatColor * uHeat * (rim * 1.7 + f * 0.22) * crawl;
  // Resonance surge: a cool cyan rim.
  col += vec3(0.25, 0.95, 1.0) * uRes * (pow(f, 3.0) * 2.2 + 0.03);
  gl_FragColor = vec4(col, 1.0);
}
`;

const ORANGE = new Color('#ff8a2a');
const RED = new Color('#ff2414');
/** Heat each of my strikes adds, and how fast it bleeds off (per second). */
const HEAT_PER_TAP = 0.065;
const HEAT_COOL = 0.9;

/**
 * The spinning rock. `refs.rock` is the spin group (seam directions live in
 * its local space); an inner squash group carries the "thunk" on every burst
 * so seams, rigs and scorch marks squash with the surface.
 *
 * The rock glows hotter the faster I tap: every laser I fire adds heat that
 * bleeds off over a second or two, so a steady frenzy keeps it orange-red.
 * A resonance surge adds a cyan rim.
 */
export function Asteroid() {
  const seed = useGame((s) => s.s?.seed ?? 1);
  const geo = useBundle(() => buildRock(seed), [seed]);
  const rockMat = useDisposable(() => new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.93, metalness: 0.06 }), []);
  const shellMat = useDisposable(
    () =>
      new ShaderMaterial({
        vertexShader: SHELL_VERT,
        fragmentShader: SHELL_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uHeat: { value: 0 },
          uRes: { value: 0 },
          uHeatColor: { value: ORANGE.clone() },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: FrontSide,
      }),
    [],
  );

  const spin = useRef<Group>(null!);
  const squash = useRef<Group>(null!);
  const shell = useRef<Mesh>(null!);
  const sim = useMemo(() => ({ x: 0, v: 0, taps: 0, heat: 0, hot: 0, res: 0 }), []);
  const normal = useMemo(() => new Vector3(), []);

  useLayoutEffect(() => {
    const g = spin.current;
    refs.rock = g;
    return () => {
      if (refs.rock === g) refs.rock = null;
    };
  }, []);

  useEffect(
    () =>
      onFx((e) => {
        // Only bursts on the rock thunk it (a caught comet bursts further out).
        if (e.kind === 'burst' && e.at.lengthSq() < 10.5) sim.v -= Math.min(0.75, 0.22 + e.count * 0.012);
        else if (e.kind === 'laser' && e.from === useGame.getState().me) sim.taps = Math.min(1, sim.taps + HEAT_PER_TAP);
      }),
    [sim],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const g = spin.current;
    g.rotation.y += dt * 0.06;
    g.rotation.x += dt * 0.015;

    // Damped spring: a squash on impact that rebounds with a little wobble.
    sim.v += (-260 * sim.x - 11 * sim.v) * dt;
    sim.x = Math.max(-0.07, Math.min(0.05, sim.x + sim.v * dt));
    squash.current.scale.set(1 + sim.x * 0.8, 1 + sim.x, 1 + sim.x * 0.8);

    const s = useGame.getState().s;
    sim.taps = Math.max(0, sim.taps - sim.taps * HEAT_COOL * dt - 0.01 * dt);
    sim.heat = damp(sim.heat, sim.taps, 7, dt);
    sim.hot = damp(sim.hot, sim.taps > 0.7 ? 1 : 0, 4, dt);
    sim.res = damp(sim.res, s && surgeOn(s, hostNow()) ? 1 : 0, 3, dt);

    const u = shellMat.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uHeat.value = Math.pow(sim.heat, 1.3) * (1.2 + sim.hot * 1.1);
    (u.uHeatColor.value as Color).copy(ORANGE).lerp(RED, sim.hot);
    u.uRes.value = sim.res;
    shell.current.visible = u.uHeat.value > 0.004 || sim.res > 0.004;
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (!tapOk(e.nativeEvent)) return;
    if (e.face) normal.copy(e.face.normal).transformDirection(e.object.matrixWorld);
    else normal.copy(e.point).normalize();
    act.strike(null, e.point, normal);
  };

  return (
    <group ref={spin}>
      <group ref={squash}>
        <mesh geometry={geo.rock} material={rockMat} onPointerDown={onDown} />
        <mesh ref={shell} geometry={geo.shell} material={shellMat} renderOrder={2} />
        <Seams />
        <Rigs />
        <Scorches parent={squash} />
      </group>
    </group>
  );
}
