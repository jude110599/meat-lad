import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  IcosahedronGeometry,
  MathUtils,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Group,
  type PerspectiveCamera,
} from 'three';
import { rng } from '@starforge/shared';
import { act } from '../net/actions';
import { emitFx, onFx } from '../state/fx';
import { useGame } from '../state/store';
import { bus, sparks } from './bus';
import { flash, motes } from './fxkit';
import { cssColor, glowTexture, hostNow, isLite, setCss, useBundle } from './util';

/** Radius of the invisible hit sphere, in the comet's own units (≈ world units on a phone). */
const HIT_R = 0.6;
/** How far in front of the rock's centre (toward the camera) the comet flies. */
const IN_FRONT = 3.6;
const TAIL_L = 2.1;
const TAIL_W = 0.7;
const FADE_IN_MS = 500;
const FADE_OUT_S = 0.7;
const POP_S = 0.55;
const TRAIL_RATE = isLite() ? 22 : 40;
const GLINT_RATE = isLite() ? 4 : 7;
const ORIGIN = new Vector3();
const UP = new Vector3(0, 1, 0);
const HEAD = new Color('#f2fdff');
const HALO = new Color('#8fe6ff');
const TRAIL = new Color('#a8ecff');
const WHITE = new Color(1, 1, 1);
const GLINT = new Color('#d8f6ff');
const ORE = new Color('#ffb03a');

const TAIL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const TAIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uHead;
uniform vec3 uEnd;
uniform float uNarrow;
uniform float uStreak;
uniform float uFlow;
varying vec2 vUv;
void main() {
  // y runs from the head (0) to the end of the tail (1).
  float along = clamp(vUv.y, 0.0, 1.0);
  float across = abs(vUv.x * 2.0 - 1.0);
  float width = max(0.05, mix(uNarrow, 1.0, sqrt(along)));
  float q = across / width;
  float body = exp(-q * q * 3.0);
  float qc = q / 0.3;
  float core = exp(-qc * qc * 2.0) * (1.0 - along);
  float fade = pow(max(1.0 - along, 0.0), 1.7);
  // Fine streaks flowing back along the tail, and knots drifting down it.
  float streaks = 0.7 + 0.3 * sin(vUv.x * uStreak + along * 7.0 - uTime * 9.0);
  float knots = 0.85 + 0.15 * sin(along * 23.0 - uTime * uFlow);
  vec3 col = mix(uHead, uEnd, smoothstep(0.0, 0.7, along));
  gl_FragColor = vec4((col * body * streaks * knots + vec3(core)) * fade * uAlpha, 1.0);
}
`;

const RAYS_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const RAYS_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // A slowly turning corona of rays around the nucleus.
  vec2 p = vUv * 2.0 - 1.0;
  float d2 = dot(p, p);
  if (d2 >= 1.0) discard;
  float r = sqrt(max(d2, 0.0));
  float a = d2 > 1e-8 ? atan(p.y, p.x) : 0.0;
  float w = 0.5 + 0.5 * sin(a * 7.0 + uTime * 0.9) * sin(a * 4.0 - uTime * 0.6 + 1.7);
  float rays = w * w * w;
  float fall = exp(-r * 3.5) * (1.0 - d2);
  gl_FragColor = vec4(uColor * (rays * 1.3 + 0.15) * fall * uAlpha, 1.0);
}
`;

/** An icy, lumpy nucleus. */
function nucleusGeometry() {
  const g = new IcosahedronGeometry(0.11, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const h = Math.sin(x * 91.7 + y * 47.3 + z * 13.1) * 43758.5453;
    const k = 0.8 + (h - Math.floor(h)) * 0.35;
    p.setXYZ(i, x * k, y * k * 0.85, z * k);
  }
  g.computeVertexNormals();
  return g;
}

interface Path {
  sign: number;
  y0: number;
  y1: number;
  bulge: number;
  wob: number;
}

/** A comet's route, the same on every client: in from one side, arcing across in front of the rock, out the other. */
function pathFor(seed: number): Path {
  const r = rng(seed >>> 0);
  return { sign: r() < 0.5 ? 1 : -1, y0: (r() * 2 - 1) * 0.55, y1: (r() * 2 - 1) * 0.55, bulge: (r() * 2 - 1) * 0.35, wob: r() * Math.PI * 2 };
}

/** Frame-constant placement: a plane `z` in front of the camera, spanned by `right`/`up` scaled to the visible area. */
interface Frame {
  origin: Vector3;
  right: Vector3;
  up: Vector3;
  /** World units per visible-area unit (x: half the visible width, y: half its height, both inset by the hit radius). */
  sx: number;
  sy: number;
}

/** World point at progress `u` (0..1) along the path. */
function pathPoint(p: Path, u: number, f: Frame, out: Vector3): Vector3 {
  const x = p.sign * (2 * u - 1);
  const y = p.y0 + (p.y1 - p.y0) * u + p.bulge * Math.sin(Math.PI * u) + 0.05 * Math.sin(u * 9 + p.wob);
  return out
    .copy(f.origin)
    .addScaledVector(f.right, x * f.sx)
    .addScaledVector(f.up, y * f.sy);
}

/**
 * The comet. When the room has one, every client draws it crossing the part
 * of the screen the HUD leaves visible, in front of the rock, from `at` to
 * `until` (host clock), along a path derived from its seed: an icy nucleus
 * in a white-hot core with a turning corona, a warm dust tail and a longer
 * blue ion tail, a trail of sparks and twinkling glints. It is placed
 * relative to the camera, so it stays on screen however the view is
 * orbited, and sized in screen terms, so it is just as easy to tap on a
 * phone.
 *
 * Tapping it (an invisible hit sphere, generous on purpose) sends the catch;
 * when the host confirms with 'cometCaught' it bursts in the catcher's
 * colour (a starburst, rings, sparks) and vanishes, and its ore streams to
 * the HUD (everyone shares the reward). Uncaught, it fades out at `until`.
 */
export function Comet() {
  const res = useBundle(
    () => ({
      tailGeo: new PlaneGeometry(1, 1).translate(0, 0.5, 0),
      ringGeo: new RingGeometry(0.9, 1, 48),
      hitGeo: new SphereGeometry(HIT_R, 12, 8),
      tailMat: new ShaderMaterial({
        vertexShader: TAIL_VERT,
        fragmentShader: TAIL_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: 0 },
          uHead: { value: new Color(1, 0.96, 0.88).multiplyScalar(2) },
          uEnd: { value: new Color('#6a7dff').multiplyScalar(1.1) },
          uNarrow: { value: 0.2 },
          uStreak: { value: 31 },
          uFlow: { value: 5 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
      ionMat: new ShaderMaterial({
        vertexShader: TAIL_VERT,
        fragmentShader: TAIL_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: 0 },
          uHead: { value: new Color(0.7, 0.95, 1).multiplyScalar(2.4) },
          uEnd: { value: new Color('#2f6bff').multiplyScalar(1.3) },
          uNarrow: { value: 0.35 },
          uStreak: { value: 57 },
          uFlow: { value: 14 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
      raysMat: new ShaderMaterial({
        vertexShader: RAYS_VERT,
        fragmentShader: RAYS_FRAG,
        uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new Color('#bdf3ff').multiplyScalar(1.8) } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      nucleusGeo: nucleusGeometry(),
      nucleusMat: new MeshStandardMaterial({ color: '#cfe9ff', roughness: 0.5, metalness: 0.1, flatShading: true, emissive: '#9fe6ff', emissiveIntensity: 1.4, transparent: true }),
      quadGeo: new PlaneGeometry(1, 1),
      coreMat: new SpriteMaterial({ map: glowTexture(), color: HEAD.clone().multiplyScalar(3.2), blending: AdditiveBlending, depthWrite: false, transparent: true }),
      haloMat: new SpriteMaterial({ map: glowTexture(), color: HALO.clone().multiplyScalar(1.6), blending: AdditiveBlending, depthWrite: false, transparent: true }),
      ringMat: new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false }),
    }),
    [],
  );

  const objs = useMemo(() => {
    const tail = new Mesh(res.tailGeo, res.tailMat);
    const ion = new Mesh(res.tailGeo, res.ionMat);
    const halo = new Sprite(res.haloMat);
    const rays = new Mesh(res.quadGeo, res.raysMat);
    const nucleus = new Mesh(res.nucleusGeo, res.nucleusMat);
    const core = new Sprite(res.coreMat);
    const ring = new Mesh(res.ringGeo, res.ringMat);
    tail.renderOrder = ion.renderOrder = 8;
    halo.renderOrder = rays.renderOrder = 9;
    core.renderOrder = ring.renderOrder = 10;
    for (const o of [tail, ion, halo, rays, nucleus, core, ring]) o.frustumCulled = false;
    return { tail, ion, halo, rays, nucleus, core, ring };
  }, [res]);

  const root = useRef<Group>(null!);
  const c = useMemo(
    () => ({
      id: 0,
      at: 0,
      until: 0,
      path: null as Path | null,
      phase: 'idle' as 'idle' | 'fly' | 'fade' | 'pop',
      /** Seconds into the fade or pop. */
      t: 0,
      alpha: 0,
      /** Alpha when the fade or pop began. */
      from: 1,
      /** Scale from comet units to world units this frame. */
      k: 1,
      /** Catch already sent (once per comet, so a double tap can't earn a "got away"). */
      sent: false,
      /** Brief flare after my tap, before the host answers. */
      tapped: 0,
      acc: 0,
      glint: 0,
      pos: new Vector3(),
      /** Unit direction the tail streams in (opposite to the motion). */
      dir: new Vector3(1, 0, 0),
    }),
    [],
  );
  const tmp = useMemo(
    () => ({
      frame: { origin: new Vector3(), right: new Vector3(), up: new Vector3(), sx: 1, sy: 1 } as Frame,
      fwd: new Vector3(),
      back: new Vector3(),
      toCam: new Vector3(),
      x: new Vector3(),
      z: new Vector3(),
      m: new Matrix4(),
      col: new Color(),
    }),
    [],
  );

  useEffect(
    () =>
      onFx((e) => {
        if (e.kind !== 'cometCaught' || e.id !== c.id || (c.phase !== 'fly' && c.phase !== 'fade')) return;
        c.from = c.alpha;
        c.phase = 'pop';
        c.t = 0;
        setCss(res.ringMat.color, e.color).multiplyScalar(1.6);
        const fwd = c.dir.clone().negate();
        emitFx({ kind: 'burst', at: c.pos.clone(), normal: fwd, color: e.color, count: 110, speed: 6 * c.k });
        emitFx({ kind: 'burst', at: c.pos.clone(), normal: fwd, color: '#ffffff', count: 40, speed: 9 * c.k });
        // A starburst and rings in the catcher's colour, and the reward streaming home as ore.
        const own = cssColor(e.color);
        flash(c.pos, WHITE.clone().multiplyScalar(3), { kind: 'star', size: 1.2 * c.k, size1: 3.2 * c.k, life: 0.55 });
        flash(c.pos, own.clone().lerp(WHITE, 0.3).multiplyScalar(2.2), { kind: 'streak', size: 0.5 * c.k, size1: 0.7 * c.k, aspect: 8, life: 0.45 });
        flash(c.pos, own.clone().multiplyScalar(2.4), { kind: 'ring', size: 0.3 * c.k, size1: 3.4 * c.k, life: 0.7, delay: 0.05 });
        flash(c.pos, HALO.clone().multiplyScalar(2), { kind: 'ring', size: 0.2 * c.k, size1: 2.2 * c.k, life: 0.55, delay: 0.14 });
        motes(c.pos, null, ORE, 18, { speed: 3.5 * c.k, size: 1.3 });
      }),
    [c, res],
  );

  useFrame((state, dtRaw) => {
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    const g = root.current;
    const sc = useGame.getState().s?.comet ?? null;
    const now = hostNow();

    if (sc && sc.id !== c.id && now < sc.until) {
      c.id = sc.id;
      c.at = sc.at;
      c.until = sc.until;
      c.path = pathFor(sc.seed);
      c.phase = 'fly';
      c.t = 0;
      c.sent = false;
      c.tapped = 0;
      c.acc = 0;
    }
    // Expired, or gone from the room (caught: the 'cometCaught' fx may still land during the fade).
    if (c.phase === 'fly' && (!sc || sc.id !== c.id || now >= c.until)) {
      c.phase = 'fade';
      c.t = 0;
      c.from = c.alpha;
    }
    if (c.phase !== 'fly') c.t += dt;
    if ((c.phase === 'fade' && c.t >= FADE_OUT_S) || (c.phase === 'pop' && c.t >= POP_S)) c.phase = 'idle';
    if (c.phase === 'idle' || !c.path) {
      g.visible = false;
      return;
    }

    // Fly on a plane in front of the rock, facing the camera, spanning the
    // visible area minus the hit radius so the whole target stays tappable.
    const cam = state.camera as PerspectiveCamera;
    const f = tmp.frame;
    tmp.fwd.copy(ORIGIN).sub(cam.position);
    const dist = tmp.fwd.length();
    tmp.fwd.divideScalar(Math.max(1e-6, dist));
    f.right.crossVectors(tmp.fwd, UP);
    if (f.right.lengthSq() < 1e-6) f.right.set(1, 0, 0);
    f.right.normalize();
    f.up.crossVectors(f.right, tmp.fwd);
    const z = Math.max(0.8, dist - IN_FRONT);
    f.origin.copy(cam.position).addScaledVector(tmp.fwd, z);
    const pxToWorld = (2 * Math.tan(MathUtils.degToRad(cam.fov) * 0.5) * z) / Math.max(1, state.size.height);
    const { w, h } = bus.view;
    const hitPx = MathUtils.clamp(0.14 * Math.min(w, h), 44, 72);
    f.sx = MathUtils.clamp(1 - (1.1 * hitPx) / (w / 2), 0.5, 0.85) * (w / 2) * pxToWorld;
    f.sy = (MathUtils.clamp(1 - (1.1 * hitPx) / (h / 2), 0.35, 0.8) / 0.95) * (h / 2) * pxToWorld;
    c.k = (hitPx * pxToWorld) / HIT_R;

    if (c.phase !== 'pop') {
      const u = (now - c.at) / Math.max(1, c.until - c.at);
      pathPoint(c.path, u, f, c.pos);
      pathPoint(c.path, u - 0.01, f, tmp.back).sub(c.pos);
      if (tmp.back.lengthSq() > 1e-10) c.dir.copy(tmp.back).normalize();
    }

    if (c.phase === 'fly') c.alpha = Math.min(1, Math.max(0, (now - c.at) / FADE_IN_MS));
    else if (c.phase === 'fade') c.alpha = c.from * Math.max(0, 1 - c.t / FADE_OUT_S);
    else c.alpha = 0;
    const a = c.alpha;
    c.tapped = Math.max(0, c.tapped - dt);

    g.visible = true;
    g.position.copy(c.pos);
    g.scale.setScalar(c.k);
    const t = state.clock.elapsedTime;
    const flare = 1 + c.tapped * 2.5;

    // Head: an icy nucleus inside a hot white core, a turning corona of rays
    // and a breathing cyan halo (it wants to be tapped).
    objs.core.visible = a > 0.001;
    objs.core.scale.setScalar(0.24 * (1 + 0.06 * Math.sin(t * 31)) * flare);
    res.coreMat.opacity = a * 0.85;
    objs.nucleus.visible = a > 0.001;
    objs.nucleus.rotation.set(t * 0.7, t * 1.1, 0);
    objs.nucleus.scale.setScalar(flare);
    res.nucleusMat.opacity = a;
    objs.rays.visible = a > 0.001;
    objs.rays.quaternion.copy(cam.quaternion);
    objs.rays.scale.setScalar(1.25 * (1 + 0.05 * Math.sin(t * 4.1)) * Math.sqrt(flare));
    res.raysMat.uniforms.uTime.value = t;
    res.raysMat.uniforms.uAlpha.value = a;
    if (c.phase === 'pop') {
      const p = c.t / POP_S;
      const e = 1 - Math.pow(1 - p, 3);
      objs.halo.scale.setScalar(1.4 + 2.6 * e);
      res.haloMat.opacity = c.from * (1 - p) * (1 - p);
      objs.ring.visible = true;
      objs.ring.scale.setScalar(0.4 + 1.9 * e);
      objs.ring.quaternion.copy(cam.quaternion);
      res.ringMat.opacity = (1 - p) * (1 - p);
    } else {
      objs.halo.scale.setScalar(1.4 * (1 + 0.1 * Math.sin(t * 6.3)) * Math.sqrt(flare));
      res.haloMat.opacity = a;
      objs.ring.visible = false;
    }

    // Tail: a camera-facing ribbon streaming back along the path.
    tmp.toCam.copy(cam.position).sub(c.pos).normalize();
    tmp.x.crossVectors(c.dir, tmp.toCam);
    if (tmp.x.lengthSq() > 1e-8) {
      tmp.x.normalize();
      tmp.z.crossVectors(tmp.x, c.dir);
      tmp.m.makeBasis(tmp.x, c.dir, tmp.z);
      objs.tail.quaternion.setFromRotationMatrix(tmp.m);
    }
    const tailA = c.phase === 'pop' ? c.from * Math.max(0, 1 - c.t / 0.25) : a;
    objs.tail.visible = objs.ion.visible = tailA > 0.001;
    objs.tail.scale.set(TAIL_W, TAIL_L * (0.35 + 0.65 * a), 1);
    res.tailMat.uniforms.uTime.value = t;
    res.tailMat.uniforms.uAlpha.value = tailA * 0.85;
    // The ion tail: narrower, longer, bluer and straighter, with faster streaks.
    objs.ion.quaternion.copy(objs.tail.quaternion);
    objs.ion.scale.set(TAIL_W * 0.45, TAIL_L * 1.45 * (0.35 + 0.65 * a), 1);
    res.ionMat.uniforms.uTime.value = t;
    res.ionMat.uniforms.uAlpha.value = tailA;

    // A trail of sparks shed into the world behind it.
    if (c.phase !== 'pop' && a > 0.2) {
      c.acc += dt * TRAIL_RATE * a;
      const n = Math.floor(c.acc);
      if (n > 0) {
        c.acc -= n;
        sparks(c.pos, c.dir, TRAIL, n, 1.6 * c.k, { spread: 0.35, life: 0.9, size: 0.9 * c.k, drag: 0.7, white: 0.6 });
      }
      // Now and then a glint twinkles in its wake.
      c.glint += dt * GLINT_RATE * a;
      if (c.glint >= 1) {
        c.glint -= 1;
        tmp.x.copy(c.pos).addScaledVector(c.dir, (0.15 + Math.random() * 0.7) * c.k);
        flash(tmp.x, tmp.col.copy(GLINT).multiplyScalar(2), { kind: 'star', size: (0.18 + Math.random() * 0.14) * c.k, size1: 0.02, life: 0.45 + Math.random() * 0.3 });
      }
    }
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    // Not catchable right now: let the tap through to the rock behind.
    if (c.phase !== 'fly' || e.nativeEvent.button > 0) return;
    e.stopPropagation();
    if (c.sent) return;
    c.sent = true;
    c.tapped = 0.3;
    act.comet(c.id);
    sparks(c.pos, null, WHITE, 16, 2.5 * c.k, { spread: 1, life: 0.35, white: 0.8 });
  };

  return (
    <group ref={root} visible={false}>
      <primitive object={objs.ion} />
      <primitive object={objs.tail} />
      <primitive object={objs.halo} />
      <primitive object={objs.rays} />
      <primitive object={objs.nucleus} />
      <primitive object={objs.core} />
      <primitive object={objs.ring} />
      <mesh geometry={res.hitGeo} visible={false} onPointerDown={onDown} />
    </group>
  );
}
