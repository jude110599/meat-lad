import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, type RootState } from '@react-three/fiber';
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
 * Phones drop the WebGL context under memory pressure or after the page has
 * been in the background, and a lost context leaves the canvas black for
 * good. Returns a key that changes to rebuild the Canvas (a fresh context,
 * everything re-uploaded) when the context is lost and the browser doesn't
 * hand it back quickly, or as soon as it does.
 */
function useContextRecovery(): [number, (st: RootState) => void] {
  const [gen, setGen] = useState(0);
  const live = useRef<RootState['gl'] | null>(null);
  const timer = useRef(0);

  useEffect(() => {
    // Some browsers lose the context without telling us; check whenever the page comes back.
    const check = () => {
      const gl = live.current;
      if (document.visibilityState === 'visible' && gl?.getContext().isContextLost()) {
        live.current = null;
        setGen((g) => g + 1);
      }
    };
    document.addEventListener('visibilitychange', check);
    const iv = window.setInterval(check, 3000);
    return () => {
      window.clearTimeout(timer.current);
      window.clearInterval(iv);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  const onCreated = useCallback((st: RootState) => {
    const gl = st.gl;
    const canvas = gl.domElement;
    live.current = gl;
    const rebuild = () => {
      window.clearTimeout(timer.current);
      if (live.current !== gl) return;
      live.current = null;
      setGen((g) => g + 1);
    };
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (live.current === gl) timer.current = window.setTimeout(rebuild, 1200);
    });
    canvas.addEventListener('webglcontextrestored', rebuild);
    if (new URLSearchParams(location.search).has('sfdebug')) Object.assign(window, { __sf3: st });
  }, []);

  return [gen, onCreated];
}

/**
 * The full-screen 3D view. Sky, lights, camera and post-processing are
 * always on; the asteroid and everything game-specific mount once the first
 * room snapshot has arrived. Phones and narrow windows render at a lower
 * pixel ratio. The canvas itself isn't antialiased: the post-processing
 * composer draws into its own buffers, so that would only cost memory.
 */
export function GameScene() {
  const ready = useGame((st) => st.s !== null);
  const lite = useLite();
  const [gen, onCreated] = useContextRecovery();
  return (
    <Canvas
      key={gen}
      onCreated={onCreated}
      className="scene"
      style={{ position: 'fixed', inset: 0 }}
      dpr={lite ? [1, 1.5] : [1, 1.75]}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }}
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
