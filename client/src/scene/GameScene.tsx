import { Canvas } from '@react-three/fiber';
import { useGame } from '../state/store';
import { Asteroid } from './Asteroid';
import { CameraRig } from './CameraRig';
import { Comet } from './Comet';
import { Drones } from './Drones';
import { Floaters } from './Floaters';
import { Lasers } from './Lasers';
import { BASE_FOV } from './layout';
import { Lights } from './Lights';
import { Particles } from './Particles';
import { PostFX } from './PostFX';
import { Ships } from './Ships';
import { Shockwaves } from './Shockwaves';
import { Sky } from './Sky';
import { useLite } from './util';
import { Warp } from './Warp';

/** Everything that needs a room. */
function World() {
  return (
    <>
      <Asteroid />
      <Drones />
      <Ships />
      <Comet />
      <Lasers />
      <Particles />
      <Floaters />
      <Shockwaves />
    </>
  );
}

/**
 * The full-screen 3D view. Sky, lights, camera and post-processing are
 * always on; the asteroid and everything game-specific mount once the first
 * room snapshot has arrived. Phones and narrow windows render at a lower
 * pixel ratio.
 */
export function GameScene() {
  const ready = useGame((st) => st.s !== null);
  const lite = useLite();
  return (
    <Canvas
      className="scene"
      style={{ position: 'fixed', inset: 0 }}
      dpr={lite ? [1, 1.5] : [1, 1.75]}
      gl={{ antialias: true, powerPreference: 'high-performance', stencil: false }}
      camera={{ position: [0, 1.6, 7.6], fov: BASE_FOV, near: 0.1, far: 500 }}
    >
      <color attach="background" args={['#03040a']} />
      <Sky />
      <Lights />
      <CameraRig />
      {ready && <World />}
      <Warp />
      <PostFX />
    </Canvas>
  );
}
