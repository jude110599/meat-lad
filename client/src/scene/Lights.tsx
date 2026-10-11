import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, type AmbientLight, type HemisphereLight } from 'three';
import { bus } from './bus';
import { damp } from './util';

const SKY = new Color('#5a78ff');
const GROUND = new Color('#26122e');
const AMBIENT = new Color('#7d8cc4');
const SURGE = new Color('#5fe6ff');

/**
 * Fill lights. The key light lives with the sun in Sky. A 'flash' fx
 * (routed through PostFX into bus.tint) washes these lights in its colour
 * for a moment, which reads as a scene-wide tint pulse; a resonance surge
 * (bus.surge) leans them a little cyan for as long as it lasts.
 */
export function Lights() {
  const hemi = useRef<HemisphereLight>(null!);
  const amb = useRef<AmbientLight>(null!);
  const c = useMemo(() => new Color(), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    bus.tintAmt = damp(bus.tintAmt, 0, 2.4, dt);
    const k = bus.tintAmt;
    hemi.current.color.copy(SKY).lerp(SURGE, bus.surge * 0.15).lerp(bus.tint, Math.min(1, k * 0.9));
    hemi.current.groundColor.copy(GROUND).lerp(c.copy(bus.tint).multiplyScalar(0.5), Math.min(1, k * 0.7));
    hemi.current.intensity = 1.05 + k * 2.2;
    amb.current.color.copy(AMBIENT).lerp(SURGE, bus.surge * 0.12).lerp(bus.tint, Math.min(1, k));
    amb.current.intensity = 0.32 + k * 0.5;
  });

  return (
    <>
      <ambientLight ref={amb} intensity={0.32} color={AMBIENT} />
      <hemisphereLight ref={hemi} args={[SKY, GROUND, 1.05]} />
      {/* Cool rim light from behind the rock. */}
      <pointLight position={[-7, -2, -5]} intensity={55} distance={40} decay={2} color="#4a6cff" />
    </>
  );
}
