import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  BackSide,
  Color,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { onFx } from '../state/fx';
import { useGame } from '../state/store';
import { bus } from './bus';
import { isLite, useBundle } from './util';

const COUNT = isLite() ? 160 : 260;
const DURATION = 1.6;
const FAR = 90;
const TUNNEL_L = 70;
const PALETTE = ['#8fb4ff', '#ffffff', '#b59bff', '#7ff0ff', '#ffffff', '#9fc4ff'].map((c) => new Color(c));

const STREAK_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv;
#ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
#else
  vCol = vec3(1.0);
#endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
const STREAK_FRAG = /* glsl */ `
uniform float uAmt;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float along = vUv.y * vUv.y;
  vec3 c = mix(vCol, vec3(1.0), along * 0.6);
  gl_FragColor = vec4(c * along * across * across * uAmt * 2.4, 1.0);
}
`;

const TUNNEL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const TUNNEL_FRAG = /* glsl */ `
uniform float uAmt;
uniform float uTime;
varying vec2 vUv;
float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
  // Columns of light racing past: each column a thin line with dashes flowing toward the camera.
  float cols = 48.0;
  float u = vUv.x * cols;
  float id = floor(u);
  float h = hash(id);
  float x = fract(u) - 0.5;
  // Keep lines about two pixels wide at any distance, dimming them as they
  // crowd together far down the tube so it never turns into a solid wall.
  float w = max(fwidth(u) * 1.1, 0.04);
  float line = exp(-x * x / (w * w)) * clamp(0.1 / w, 0.0, 1.0);
  // z: 0 by the camera, 1 at the far end.
  float z = vUv.y;
  // Dashes measured in log-depth so they read near the camera and far away.
  float ld = log2(1.0 + z * 40.0);
  float flow = fract(ld * (0.7 + h * 0.6) + uTime * (1.1 + h * 1.4) + h);
  float dash = smoothstep(0.0, 0.25, flow) * (1.0 - smoothstep(0.4, 0.65, flow));
  // Fade both ends.
  float ends = smoothstep(0.0, 0.03, z) * (1.0 - smoothstep(0.45, 1.0, z));
  vec3 c = mix(vec3(0.35, 0.55, 1.0), vec3(0.75, 0.55, 1.0), h);
  gl_FragColor = vec4(c * line * dash * ends * (0.35 + h * 0.65) * uAmt * 1.6, 1.0);
}
`;

const CORE_FRAG = /* glsl */ `
uniform float uAmt;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = dot(p, p);
  if (d >= 1.0) discard;
  float g = exp(-d * 6.0) * (1.0 - d);
  float streak = exp(-abs(p.y) * 40.0) * (1.0 - d);
  gl_FragColor = vec4(vec3(0.75, 0.88, 1.0) * (g * 1.6 + streak) * uAmt, 1.0);
}
`;

/**
 * Quantum Leap warp, ~1.6 s: the FOV punches wide (CameraRig reads
 * bus.warp), coloured star streaks rush past the camera inside a tunnel of
 * racing light, with a white-hot glow at the vanishing point; then it all
 * settles. Triggered by the 'leap' fx or a new `leap` in the store,
 * whichever comes first. The HUD draws the white flash.
 */
export function Warp() {
  const res = useBundle(
    () => ({
      geo: new PlaneGeometry(1, 1).translate(0, -0.5, 0),
      quad: new PlaneGeometry(1, 1),
      // Starts just ahead of the camera: a vertex on the camera plane has
      // clip w = 0 and wrecks the varyings (NaN) on some GPUs.
      tube: new CylinderGeometry(3.2, 3.2, TUNNEL_L, 36, 6, true).rotateX(-Math.PI / 2).translate(0, 0, -TUNNEL_L / 2 - 0.6),
      mat: new ShaderMaterial({
        vertexShader: STREAK_VERT,
        fragmentShader: STREAK_FRAG,
        uniforms: { uAmt: { value: 0 } },
        // The camera sits inside the ring of streaks, looking at their backs.
        side: DoubleSide,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
      tunnelMat: new ShaderMaterial({
        vertexShader: TUNNEL_VERT,
        fragmentShader: TUNNEL_FRAG,
        uniforms: { uAmt: { value: 0 }, uTime: { value: 0 } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
        side: BackSide,
      }),
      coreMat: new ShaderMaterial({
        vertexShader: TUNNEL_VERT,
        fragmentShader: CORE_FRAG,
        uniforms: { uAmt: { value: 0 } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: AdditiveBlending,
      }),
    }),
    [],
  );

  const sys = useMemo(() => {
    const group = new Group();
    const mesh = new InstancedMesh(res.geo, res.mat, COUNT);
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(COUNT * 3), 3);
    mesh.renderOrder = 20;
    const tunnel = new Mesh(res.tube, res.tunnelMat);
    tunnel.frustumCulled = false;
    tunnel.renderOrder = 19;
    const core = new Mesh(res.quad, res.coreMat);
    core.position.set(0, 0, -40);
    core.scale.set(18, 18, 1);
    core.frustumCulled = false;
    core.renderOrder = 19;
    group.add(tunnel, core, mesh);
    group.visible = false;
    const quats: Quaternion[] = [];
    const radius = new Float32Array(COUNT);
    const wide = new Float32Array(COUNT);
    const angle = new Float32Array(COUNT);
    const z = new Float32Array(COUNT);
    const xAxis = new Vector3();
    const yAxis = new Vector3(0, 0, 1);
    const zAxis = new Vector3();
    const m = new Matrix4();
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      angle[i] = a;
      radius[i] = 0.7 + Math.pow(Math.random(), 0.8) * 13;
      wide[i] = 0.7 + Math.random() * 0.7;
      z[i] = -Math.random() * FAR;
      // Quad spans the tangential direction (width) and camera Z (length).
      xAxis.set(-Math.sin(a), Math.cos(a), 0);
      zAxis.crossVectors(xAxis, yAxis);
      m.makeBasis(xAxis, yAxis, zAxis);
      quats.push(new Quaternion().setFromRotationMatrix(m));
      mesh.setColorAt(i, PALETTE[i % PALETTE.length]);
    }
    return { group, mesh, quats, radius, wide, angle, z, start: -1, last: -10, flow: 0 };
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
    const dt = Math.min(Math.max(dtRaw, 0), 0.05);
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
    res.tunnelMat.uniforms.uAmt.value = env * env * 0.55;
    // Integrate the flow so the dashes speed up and slow down without jumping.
    sys.flow = (sys.flow + dt * (0.6 + env * 2.4)) % 1000;
    res.tunnelMat.uniforms.uTime.value = sys.flow;
    // The vanishing point blazes as the jump peaks.
    res.coreMat.uniforms.uAmt.value = env * env * 1.1;

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
      // Width grows with distance so far streaks stay a couple of pixels wide.
      const w = Math.max(0.03, -sys.z[i] * 0.0042) * sys.wide[i];
      tmp.m.compose(tmp.p, sys.quats[i], tmp.s.set(w, len, 1));
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
