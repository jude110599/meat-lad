import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, Mesh, PlaneGeometry, RingGeometry, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { onFx } from '../state/fx';
import { refs } from '../state/refs';
import { bus, sparks } from './bus';
import { flash } from './fxkit';
import { cssColor, isLite, useBundle } from './util';

const POOL = 6;
const INNER = 0.82;
const LITE = isLite();
const WHITE = new Color(1, 1, 1);
const GOLD = new Color('#ffe28a');
/** Rough radius of the rock's silhouette, where rings start and sparkles circle. */
const ROCK_R = 2.3;

const RING_VERT = /* glsl */ `
varying float vR;
void main() {
  vR = length(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSharp;
varying float vR;
void main() {
  // Sharp bright leading edge, soft trailing glow.
  float x = clamp((vR - ${INNER.toFixed(2)}) / ${(1 - INNER).toFixed(2)}, 0.0, 1.0);
  float edge = pow(x, uSharp) * 2.2 + x * x * 0.4;
  float fadeOut = 1.0 - smoothstep(0.94, 1.0, x);
  gl_FragColor = vec4(uColor * edge * fadeOut * uAlpha, 1.0);
}
`;

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vV;
void main() {
  float nn = max(length(vN) * length(vV), 1e-5);
  float f = clamp(1.0 - abs(dot(vN, vV)) / nn, 0.0, 1.0);
  float f2 = f * f;
  gl_FragColor = vec4(uColor * f2 * f2 * uAlpha, 1.0);
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
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSeed;
varying vec2 vUv;
void main() {
  // Shafts of light fanning out from behind the rock.
  vec2 p = vUv * 2.0 - 1.0;
  float d2 = dot(p, p);
  if (d2 >= 1.0) discard;
  float r = sqrt(max(d2, 0.0));
  float a = d2 > 1e-8 ? atan(p.y, p.x) : 0.0;
  float w = 0.5 + 0.5 * sin(a * 9.0 + uSeed) * sin(a * 13.0 - uSeed * 1.7);
  float rays = w * w * w * w;
  float band = smoothstep(0.22, 0.4, r) * (1.0 - d2);
  gl_FragColor = vec4(uColor * rays * band * uAlpha, 1.0);
}
`;

interface Wave {
  t: number;
  dur: number;
  maxR: number;
  strength: number;
  bill: Mesh;
  echo: Mesh;
  flat: Mesh;
  shell: Mesh;
  rays: Mesh;
  ringMat: ShaderMaterial;
  echoMat: ShaderMaterial;
  shellMat: ShaderMaterial;
  raysMat: ShaderMaterial;
  tilt: number;
  /** A small wave (an upgrade): just the camera-facing rings. */
  small: boolean;
}

const ringMat = (sharp: number) =>
  new ShaderMaterial({
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0 }, uSharp: { value: sharp } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

/**
 * Expanding rings of light from the rock: a camera-facing ring with a
 * thinner echo just behind it, a tilted equatorial ring, shafts of light
 * fanning out and a faint fresnel shell, plus a circle of sparks flung off
 * the rock's silhouette. Fired by 'shockwave' fx (a Forge Tree node
 * unlocked, a surge began) or directly via `shockwave()` in bus.ts.
 *
 * Buying an upgrade ('upgrade' fx) gets a smaller celebration: a quick ring
 * in my colour and a sweep of twinkles around the rock (or a sparkle at the
 * crewmate's ship when they buy).
 */
export function Shockwaves() {
  const camera = useThree((s) => s.camera);
  const res = useBundle(
    () => ({
      ring: new RingGeometry(INNER, 1, 96, 1),
      quad: new PlaneGeometry(2, 2),
      sphere: new SphereGeometry(1, 32, 16),
      ringMats: Array.from({ length: POOL }, () => ringMat(6)),
      echoMats: Array.from({ length: POOL }, () => ringMat(14)),
      shellMats: Array.from(
        { length: POOL },
        () =>
          new ShaderMaterial({
            vertexShader: SHELL_VERT,
            fragmentShader: SHELL_FRAG,
            uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0 } },
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
          }),
      ),
      raysMats: Array.from(
        { length: POOL },
        () =>
          new ShaderMaterial({
            vertexShader: RAYS_VERT,
            fragmentShader: RAYS_FRAG,
            uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0 }, uSeed: { value: 0 } },
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
          }),
      ),
    }),
    [],
  );

  const waves = useMemo<Wave[]>(
    () =>
      Array.from({ length: POOL }, (_, i) => {
        const bill = new Mesh(res.ring, res.ringMats[i]);
        const echo = new Mesh(res.ring, res.echoMats[i]);
        const flat = new Mesh(res.ring, res.ringMats[i]);
        const shell = new Mesh(res.sphere, res.shellMats[i]);
        const rays = new Mesh(res.quad, res.raysMats[i]);
        for (const m of [bill, echo, flat, shell, rays]) {
          m.visible = false;
          m.frustumCulled = false;
          m.renderOrder = 9;
        }
        rays.renderOrder = 1;
        return {
          t: 1,
          dur: 1,
          maxR: 12,
          strength: 1,
          bill,
          echo,
          flat,
          shell,
          rays,
          ringMat: res.ringMats[i],
          echoMat: res.echoMats[i],
          shellMat: res.shellMats[i],
          raysMat: res.raysMats[i],
          tilt: 0,
          small: false,
        };
      }),
    [res],
  );
  const tmp = useMemo(
    () => ({ head: 0, lastParty: -10, cam: new Vector3(), up: new Vector3(), right: new Vector3(), p: new Vector3(), d: new Vector3(), c: new Color() }),
    [],
  );

  useEffect(() => {
    /** Unit vectors spanning the screen plane through the rock. */
    const basis = () => {
      tmp.cam.copy(camera.position);
      const l = tmp.cam.length();
      if (l > 1e-6) tmp.cam.multiplyScalar(1 / l);
      else tmp.cam.set(0, 0, 1);
      tmp.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      tmp.right.crossVectors(tmp.up, tmp.cam);
      const rl = tmp.right.length();
      if (rl > 1e-6) tmp.right.multiplyScalar(1 / rl);
      else tmp.right.set(1, 0, 0);
      tmp.up.crossVectors(tmp.cam, tmp.right);
    };

    const spawn = (color: Color, strength: number, small = false) => {
      const w = waves[tmp.head];
      tmp.head = (tmp.head + 1) % POOL;
      w.t = 0;
      w.strength = strength;
      w.small = small;
      w.dur = small ? 0.75 : 0.9 + strength * 0.5;
      w.maxR = small ? 4.6 : 7 + strength * 9;
      w.tilt = (Math.random() - 0.5) * 0.6;
      (w.ringMat.uniforms.uColor.value as Color).copy(color).multiplyScalar(small ? 1.1 : 0.8 + strength * 0.7);
      (w.echoMat.uniforms.uColor.value as Color).copy(color).lerp(WHITE, 0.4).multiplyScalar(small ? 0.7 : 0.6 + strength * 0.4);
      (w.shellMat.uniforms.uColor.value as Color).copy(color).multiplyScalar(0.4 + strength * 0.3);
      (w.raysMat.uniforms.uColor.value as Color).copy(color).lerp(WHITE, 0.3).multiplyScalar(0.7 + strength * 0.4);
      w.raysMat.uniforms.uSeed.value = Math.random() * 100;
      if (small) return;
      // Sparks flung off the rock's silhouette, all the way round.
      basis();
      const N = LITE ? 22 : 40;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2 + Math.random() * 0.1;
        tmp.d.copy(tmp.right).multiplyScalar(Math.cos(a)).addScaledVector(tmp.up, Math.sin(a));
        tmp.p.copy(tmp.d).multiplyScalar(ROCK_R);
        sparks(tmp.p, tmp.d, k % 3 === 0 ? WHITE : color, 2, 4 + strength * 3, { spread: 0.2, life: 0.9, size: 1.3, drag: 1.6, white: 0.4 });
      }
    };
    bus.wave = spawn;

    // An upgrade bought: a sweep of twinkles around the rock and a small ring, in the buyer's colour.
    const party = (color: Color) => {
      const now = performance.now() / 1000;
      if (now - tmp.lastParty < 0.35) return;
      tmp.lastParty = now;
      spawn(color, 0.4, true);
      basis();
      const N = LITE ? 12 : 20;
      const start = Math.random() * Math.PI * 2;
      for (let k = 0; k < N; k++) {
        const a = start + (k / N) * Math.PI * 2;
        const r = ROCK_R * (1.08 + Math.random() * 0.2);
        tmp.p.copy(tmp.right).multiplyScalar(Math.cos(a) * r).addScaledVector(tmp.up, Math.sin(a) * r).addScaledVector(tmp.cam, 0.8);
        const c = k % 2 ? tmp.c.copy(color).lerp(WHITE, 0.4) : tmp.c.copy(GOLD);
        flash(tmp.p, c.multiplyScalar(2.4), { kind: 'star', size: 0.5 + Math.random() * 0.25, size1: 0.05, life: 0.5, delay: k * 0.022 });
        if (k % 4 === 0) {
          tmp.d.copy(tmp.p).normalize();
          sparks(tmp.p, tmp.d, color, 3, 1.6, { spread: 0.6, life: 0.7, size: 0.8, drag: 1.5, white: 0.6 });
        }
      }
    };

    const off = onFx((e) => {
      if (e.kind === 'shockwave') spawn(cssColor(e.color), 1);
      else if (e.kind === 'upgrade') {
        const color = cssColor(e.color);
        if (e.mine) party(color);
        else {
          const ship = refs.ships.get(e.by);
          if (!ship) return;
          flash(ship, tmp.c.copy(color).multiplyScalar(2.2), { kind: 'star', size: 0.9, size1: 0.2, life: 0.5 });
          flash(ship, tmp.c.copy(color).multiplyScalar(1.6), { kind: 'ring', size: 0.15, size1: 1.1, life: 0.5 });
        }
      }
    });
    return () => {
      off();
      if (bus.wave === spawn) bus.wave = null;
    };
  }, [waves, tmp, camera]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
    const cam = state.camera;
    for (const w of waves) {
      if (w.t >= 1) {
        w.bill.visible = w.echo.visible = w.flat.visible = w.shell.visible = w.rays.visible = false;
        continue;
      }
      w.t = Math.min(1, w.t + dt / w.dur);
      const e = 1 - Math.pow(1 - w.t, 3);
      const r = ROCK_R + (w.maxR - ROCK_R) * e;
      const a = Math.pow(1 - w.t, 1.4);
      w.ringMat.uniforms.uAlpha.value = a;
      w.bill.visible = true;
      w.bill.scale.setScalar(r);
      w.bill.quaternion.copy(cam.quaternion);
      // The echo trails the main ring a beat behind.
      const t2 = Math.max(0, w.t - 0.12);
      const e2 = 1 - Math.pow(1 - t2, 3);
      w.echo.visible = t2 > 0;
      w.echo.scale.setScalar(ROCK_R + (w.maxR * 0.8 - ROCK_R) * e2);
      w.echo.quaternion.copy(cam.quaternion);
      w.echoMat.uniforms.uAlpha.value = Math.pow(1 - t2, 1.6) * 0.9;
      if (w.small) {
        w.flat.visible = w.shell.visible = w.rays.visible = false;
        continue;
      }
      w.flat.visible = true;
      w.flat.scale.setScalar(r * 1.05);
      w.flat.rotation.set(-Math.PI / 2 + w.tilt, 0, w.tilt * 0.5);
      w.shell.visible = w.t < 0.5;
      w.shell.scale.setScalar(ROCK_R + (w.maxR * 0.5 - ROCK_R) * e);
      w.shellMat.uniforms.uAlpha.value = a * (1 - w.t) * 0.3;
      // Rays: a quick fan of light behind the rock.
      w.rays.visible = w.t < 0.7;
      w.rays.quaternion.copy(cam.quaternion);
      w.rays.scale.setScalar(ROCK_R * 1.4 + 6 * e);
      w.raysMat.uniforms.uAlpha.value = Math.max(0, 1 - w.t / 0.7) * Math.min(1, w.t / 0.06);
    }
  });

  return (
    <>
      {waves.map((w, i) => (
        <group key={i}>
          <primitive object={w.rays} />
          <primitive object={w.bill} />
          <primitive object={w.echo} />
          <primitive object={w.flat} />
          <primitive object={w.shell} />
        </group>
      ))}
    </>
  );
}
