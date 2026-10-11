import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, DynamicDrawUsage, Group, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3 } from 'three';
import { onFx } from '../state/fx';
import { useGame } from '../state/store';
import { bus } from './bus';
import { useBundle } from './util';

const COUNT = 220;
const DURATION = 1.5;
const FAR = 90;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const FRAG = /* glsl */ `
uniform float uAmt;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float along = vUv.y * vUv.y;
  vec3 c = mix(vec3(0.45, 0.65, 1.0), vec3(1.0), along);
  gl_FragColor = vec4(c * along * across * across * uAmt * 2.2, 1.0);
}
`;

/**
 * Quantum Leap warp, ~1.5 s: the FOV punches wide (CameraRig reads
 * bus.warp), star streaks rush past the camera, then everything settles.
 * Triggered by the 'leap' fx or a new `leap` in the store, whichever comes
 * first. The HUD draws the white flash.
 */
export function Warp() {
  const res = useBundle(
    () => ({
      geo: new PlaneGeometry(1, 1).translate(0, -0.5, 0),
      mat: new ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uAmt: { value: 0 } }, transparent: true, depthWrite: false, depthTest: false, blending: AdditiveBlending }),
    }),
    [],
  );

  const sys = useMemo(() => {
    const group = new Group();
    const mesh = new InstancedMesh(res.geo, res.mat, COUNT);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.renderOrder = 20;
    group.add(mesh);
    group.visible = false;
    const quats: Quaternion[] = [];
    const radius = new Float32Array(COUNT);
    const angle = new Float32Array(COUNT);
    const z = new Float32Array(COUNT);
    const xAxis = new Vector3();
    const yAxis = new Vector3(0, 0, 1);
    const zAxis = new Vector3();
    const m = new Matrix4();
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      angle[i] = a;
      radius[i] = 0.8 + Math.pow(Math.random(), 0.7) * 9;
      z[i] = -Math.random() * FAR;
      // Quad spans the tangential direction (width) and camera Z (length).
      xAxis.set(-Math.sin(a), Math.cos(a), 0);
      zAxis.crossVectors(xAxis, yAxis);
      m.makeBasis(xAxis, yAxis, zAxis);
      quats.push(new Quaternion().setFromRotationMatrix(m));
    }
    return { group, mesh, quats, radius, angle, z, start: -1, last: -10 };
  }, [res]);
  useEffect(() => () => sys.mesh.dispose(), [sys]);

  const tmp = useMemo(() => ({ m: new Matrix4(), p: new Vector3(), s: new Vector3() }), []);

  useEffect(() => {
    const trigger = () => {
      const now = performance.now() / 1000;
      if (now - sys.last < 1.2) return;
      sys.last = now;
      sys.start = now;
    };
    const off = onFx((e) => {
      if (e.kind === 'leap') trigger();
    });
    const unsub = useGame.subscribe((st, prev) => {
      if (st.leap && st.leap !== prev.leap) trigger();
    });
    return () => {
      off();
      unsub();
    };
  }, [sys]);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    if (sys.start < 0) {
      bus.warp = 0;
      return;
    }
    const t = performance.now() / 1000 - sys.start;
    if (t >= DURATION) {
      sys.start = -1;
      sys.group.visible = false;
      bus.warp = 0;
      return;
    }
    const env = t < 0.28 ? Math.sin((t / 0.28) * Math.PI * 0.5) : 1 - smooth((t - 0.28) / (DURATION - 0.28));
    bus.warp = env;
    res.mat.uniforms.uAmt.value = env;

    const cam = state.camera;
    sys.group.visible = true;
    sys.group.position.copy(cam.position);
    sys.group.quaternion.copy(cam.quaternion);
    const speed = 40 + 170 * env;
    const len = 0.6 + 16 * env;
    for (let i = 0; i < COUNT; i++) {
      sys.z[i] += speed * dt;
      if (sys.z[i] > 2) sys.z[i] -= FAR + Math.random() * 10;
      const r = sys.radius[i];
      tmp.p.set(Math.cos(sys.angle[i]) * r, Math.sin(sys.angle[i]) * r, sys.z[i]);
      tmp.m.compose(tmp.p, sys.quats[i], tmp.s.set(0.03 + r * 0.004, len, 1));
      sys.mesh.setMatrixAt(i, tmp.m);
    }
    sys.mesh.instanceMatrix.needsUpdate = true;
  });

  return <primitive object={sys.group} />;
}

function smooth(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}
