import { useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import type { Authority } from '../net/authority';
import { Asteroid } from './Asteroid';
import { Drones } from './Drones';
import { CameraShake, Floaters, Laser, Particles } from './Effects';

/** Pull the camera back on portrait screens so the whole asteroid stays in frame. */
function FitCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const aspect = size.width / size.height;
    const dist = aspect >= 1 ? 7.5 : Math.min(14, 7.5 / Math.max(aspect, 0.45) * 0.8);
    camera.position.setLength(dist);
  }, [camera, size.width, size.height]);
  return null;
}

export function GameScene({ auth }: { auth: Authority }) {
  return (
    <Canvas
      camera={{ position: [0, 1.2, 7.5], fov: 50, near: 0.1, far: 200 }}
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#05060c']} />
      <fog attach="fog" args={['#05060c', 14, 40]} />
      <Stars radius={80} depth={40} count={4000} factor={3} saturation={0} fade speed={0.4} />

      <ambientLight intensity={0.15} />
      {/* Key light: a distant star. Rim light: the refinery station glow. */}
      <directionalLight position={[6, 4, 5]} intensity={1.6} color="#fff1dc" />
      <pointLight position={[-6, -2, -4]} intensity={30} color="#5a7cff" />

      <Asteroid auth={auth} />
      <Drones />
      <Particles />
      <Laser />
      <Floaters />
      <CameraShake />
      <FitCamera />

      <OrbitControls enablePan={false} minDistance={4.5} maxDistance={14} enableDamping dampingFactor={0.08} rotateSpeed={0.6} />
      <EffectComposer>
        <Bloom intensity={1.1} luminanceThreshold={0.6} luminanceSmoothing={0.2} mipmapBlur />
        <Vignette offset={0.25} darkness={0.75} />
      </EffectComposer>
    </Canvas>
  );
}
