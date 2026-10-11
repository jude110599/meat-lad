import { Canvas } from '@react-three/fiber';
import { useGame } from '../state/store';
import { Asteroid } from './Asteroid';
import { CameraRig } from './CameraRig';
import { Drones } from './Drones';
import { FlareShield } from './FlareShield';
import { Floaters } from './Floaters';
import { Lasers } from './Lasers';
import { BASE_FOV } from './layout';
import { Lights } from './Lights';
import { OreStreams } from './OreStreams';
import { Particles } from './Particles';
import { PostFX } from './PostFX';
import { Ships } from './Ships';
import { Shockwaves } from './Shockwaves';
import { Sky } from './Sky';
import { Station } from './Station';
import { Warp } from './Warp';

export { STATION_POS } from './layout';

/** Everything that needs a room. */
function World() {
  return (
    <>
      <Asteroid />
      <FlareShield />
      <Station />
      <OreStreams />
      <Drones />
      <Ships />
      <Lasers />
      <Particles />
      <Floaters />
      <Shockwaves />
    </>
  );
}

/**
 * The full-screen 3D view. Sky, lights, camera and post-processing are
 * always on; the asteroid, station and everything game-specific mount once
 * the first room snapshot has arrived.
 */
export function GameScene() {
  const ready = useGame((st) => st.s !== null);
  return (
    <Canvas
      className="scene"
      style={{ position: 'fixed', inset: 0 }}
      dpr={[1, 1.75]}
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
