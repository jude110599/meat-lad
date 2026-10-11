import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, Color, DoubleSide, Mesh, RingGeometry, ShaderMaterial, SphereGeometry } from 'three';
import { onFx } from '../state/fx';
import { bus } from './bus';
import { cssColor, useBundle } from './util';

const POOL = 6;
const INNER = 0.82;

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
varying float vR;
void main() {
  // Sharp bright leading edge, soft trailing glow.
  float x = clamp((vR - ${INNER.toFixed(2)}) / ${(1 - INNER).toFixed(2)}, 0.0, 1.0);
  float edge = pow(x, 6.0) * 2.2 + pow(x, 1.6) * 0.5;
  float fadeOut = smoothstep(1.0, 0.94, x);
  gl_FragColor = vec4(uColor * edge * fadeOut * uAlpha, 1.0);
}
`;

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0);
  gl_FragColor = vec4(uColor * pow(f, 3.0) * uAlpha, 1.0);
}
`;

interface Wave {
  t: number;
  dur: number;
  maxR: number;
  strength: number;
  bill: Mesh;
  flat: Mesh;
  shell: Mesh;
  ringMat: ShaderMaterial;
  shellMat: ShaderMaterial;
  tilt: number;
}

/**
 * Expanding rings of light from the rock: a camera-facing ring, a tilted
 * equatorial ring and a faint fresnel sphere. Fired by 'shockwave' fx (a
 * Forge Tree node unlocked, a surge began) or directly via `shockwave()` in bus.ts.
 */
export function Shockwaves() {
  const res = useBundle(
    () => ({
      ring: new RingGeometry(INNER, 1, 96, 1),
      sphere: new SphereGeometry(1, 32, 16),
      ringMats: Array.from(
        { length: POOL },
        () =>
          new ShaderMaterial({
            vertexShader: RING_VERT,
            fragmentShader: RING_FRAG,
            uniforms: { uColor: { value: new Color() }, uAlpha: { value: 0 } },
            transparent: true,
            depthWrite: false,
            blending: AdditiveBlending,
            side: DoubleSide,
          }),
      ),
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
    }),
    [],
  );

  const waves = useMemo<Wave[]>(
    () =>
      Array.from({ length: POOL }, (_, i) => {
        const bill = new Mesh(res.ring, res.ringMats[i]);
        const flat = new Mesh(res.ring, res.ringMats[i]);
        const shell = new Mesh(res.sphere, res.shellMats[i]);
        for (const m of [bill, flat, shell]) {
          m.visible = false;
          m.frustumCulled = false;
          m.renderOrder = 9;
        }
        return { t: 1, dur: 1, maxR: 12, strength: 1, bill, flat, shell, ringMat: res.ringMats[i], shellMat: res.shellMats[i], tilt: 0 };
      }),
    [res],
  );
  const head = useMemo(() => ({ i: 0 }), []);

  useEffect(() => {
    const spawn = (color: Color, strength: number) => {
      const w = waves[head.i];
      head.i = (head.i + 1) % POOL;
      w.t = 0;
      w.strength = strength;
      w.dur = 0.9 + strength * 0.5;
      w.maxR = 7 + strength * 9;
      w.tilt = (Math.random() - 0.5) * 0.6;
      (w.ringMat.uniforms.uColor.value as Color).copy(color).multiplyScalar(1.4 + strength);
      (w.shellMat.uniforms.uColor.value as Color).copy(color).multiplyScalar(0.6 + strength * 0.6);
    };
    bus.wave = spawn;
    const off = onFx((e) => {
      if (e.kind === 'shockwave') spawn(cssColor(e.color), 1);
    });
    return () => {
      off();
      if (bus.wave === spawn) bus.wave = null;
    };
  }, [waves, head]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const cam = state.camera;
    for (const w of waves) {
      if (w.t >= 1) {
        w.bill.visible = w.flat.visible = w.shell.visible = false;
        continue;
      }
      w.t = Math.min(1, w.t + dt / w.dur);
      const e = 1 - Math.pow(1 - w.t, 3);
      const r = 2.3 + (w.maxR - 2.3) * e;
      const a = Math.pow(1 - w.t, 1.4);
      w.ringMat.uniforms.uAlpha.value = a;
      w.shellMat.uniforms.uAlpha.value = a * (1 - w.t) * 0.9;
      w.bill.visible = w.flat.visible = true;
      w.shell.visible = w.t < 0.6;
      w.bill.scale.setScalar(r);
      w.bill.quaternion.copy(cam.quaternion);
      w.flat.scale.setScalar(r * 1.05);
      w.flat.rotation.set(-Math.PI / 2 + w.tilt, 0, w.tilt * 0.5);
      w.shell.scale.setScalar(2.3 + (w.maxR * 0.55 - 2.3) * e);
    }
  });

  return (
    <>
      {waves.map((w, i) => (
        <group key={i}>
          <primitive object={w.bill} />
          <primitive object={w.flat} />
          <primitive object={w.shell} />
        </group>
      ))}
    </>
  );
}
