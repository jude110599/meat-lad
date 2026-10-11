import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, Vector3, type AmbientLight, type DirectionalLight, type HemisphereLight } from 'three';
import { bus } from './bus';
import { damp } from './util';

/** Direction toward the sun. The key light, the sun billboard and the planet's day side all use it. */
export const SUN_DIR = new Vector3(6, 4, 5).normalize();

const KEY_POS = SUN_DIR.clone().multiplyScalar(30);
/** Cool rim from behind the rock as seen from the default camera; it follows the view (see Lights). */
const RIM_POS = new Vector3(-0.5, -0.02, -0.87).normalize().multiplyScalar(30);
/** Warm bounce from the gas giant, up and behind on the left. */
const SHINE_POS = new Vector3(-0.42, 0.62, -0.66).normalize().multiplyScalar(30);

const KEY = new Color('#fff0da');
const RIM = new Color('#5a7dff');
const SHINE = new Color('#ffb98a');
const SKY = new Color('#5a74f0');
const GROUND = new Color('#2a1530');
const AMBIENT = new Color('#7d8cc4');
const SURGE = new Color('#5fe6ff');

/**
 * The light rig: a warm key from the sun, a cool blue rim that stays behind
 * the rock relative to the camera and a soft peach bounce from the gas giant, so the rock and the
 * models read as solid forms, plus hemisphere and ambient fill. A 'flash'
 * fx (routed through PostFX into bus.tint) washes the fills in its colour
 * for a moment; a resonance surge (bus.surge) leans the fills and the rim
 * cyan for as long as it lasts.
 */
export function Lights() {
  const hemi = useRef<HemisphereLight>(null!);
  const amb = useRef<AmbientLight>(null!);
  const rim = useRef<DirectionalLight>(null!);
  const c = useMemo(() => new Color(), []);
  const tmp = useMemo(() => ({ b: new Vector3(), r: new Vector3(), u: new Vector3() }), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    bus.tintAmt = damp(bus.tintAmt, 0, 2.4, dt);
    const k = bus.tintAmt;
    const sg = bus.surge;
    hemi.current.color.copy(SKY).lerp(SURGE, sg * 0.15).lerp(bus.tint, Math.min(1, k * 0.9));
    hemi.current.groundColor.copy(GROUND).lerp(c.copy(bus.tint).multiplyScalar(0.5), Math.min(1, k * 0.7));
    hemi.current.intensity = 0.8 + k * 2.2;
    amb.current.color.copy(AMBIENT).lerp(SURGE, sg * 0.12).lerp(bus.tint, Math.min(1, k));
    amb.current.intensity = 0.24 + k * 0.5;
    rim.current.color.copy(RIM).lerp(SURGE, sg * 0.35);
    rim.current.intensity = 1.8 + sg * 0.3;
    // Keep the rim behind the rock (and a little left) whichever way the
    // camera has orbited, so it always edges the silhouettes instead of
    // turning into a blue front light.
    const cam = state.camera;
    tmp.b.copy(cam.position);
    if (tmp.b.lengthSq() > 1e-8) {
      tmp.b.normalize();
      tmp.r.setFromMatrixColumn(cam.matrixWorld, 0);
      tmp.u.setFromMatrixColumn(cam.matrixWorld, 1);
      tmp.b.multiplyScalar(-0.86).addScaledVector(tmp.r, -0.5).addScaledVector(tmp.u, 0.06);
      if (tmp.b.lengthSq() > 1e-8) rim.current.position.copy(tmp.b.normalize()).multiplyScalar(30);
    }
  });

  return (
    <>
      <ambientLight ref={amb} intensity={0.24} color={AMBIENT} />
      <hemisphereLight ref={hemi} args={[SKY, GROUND, 0.8]} />
      <directionalLight position={KEY_POS} intensity={3.1} color={KEY} />
      <directionalLight ref={rim} position={RIM_POS} intensity={1.8} color={RIM} />
      <directionalLight position={SHINE_POS} intensity={0.55} color={SHINE} />
    </>
  );
}
