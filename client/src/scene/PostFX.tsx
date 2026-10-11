import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Bloom, ChromaticAberration, EffectComposer, Noise, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode, type BloomEffect, type ChromaticAberrationEffect } from 'postprocessing';
import { Vector2 } from 'three';
import { onFx } from '../state/fx';
import { useGame } from '../state/store';
import { bus } from './bus';
import { damp, setCss } from './util';

const BLOOM = 1.05;

/**
 * Bloom (mipmap blur), chromatic aberration that spikes on shockwaves,
 * overclocks, leaps and big shakes, ACES tone mapping, vignette and a whisper
 * of film grain. Also routes 'overclock' into the shared tint pulse.
 */
export function PostFX() {
  const bloom = useRef<BloomEffect>(null);
  const chroma = useRef<ChromaticAberrationEffect>(null);
  const offset = useMemo(() => new Vector2(0.0003, 0.0002), []);
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true, []);

  useEffect(
    () =>
      onFx((e) => {
        switch (e.kind) {
          case 'shockwave':
            bus.aberration = Math.max(bus.aberration, 0.011);
            bus.bloom = Math.max(bus.bloom, 0.9);
            break;
          case 'overclock':
            bus.aberration = Math.max(bus.aberration, 0.008);
            bus.bloom = Math.max(bus.bloom, 1.1);
            setCss(bus.tint, e.color);
            bus.tintAmt = 1;
            break;
          case 'leap':
            bus.aberration = Math.max(bus.aberration, 0.016);
            bus.bloom = Math.max(bus.bloom, 1.4);
            break;
          case 'shake':
            if (e.strength >= 0.25) bus.aberration = Math.max(bus.aberration, 0.003 + e.strength * 0.009);
            break;
          default:
            break;
        }
      }),
    [],
  );

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    bus.aberration = damp(bus.aberration, 0, 3, dt);
    bus.bloom = damp(bus.bloom, 0, 2.6, dt);
    const eventOn = !!useGame.getState().s?.event;
    const a = (eventOn ? 0.0009 : 0.0002) + bus.aberration + bus.warp * 0.01;
    const c = chroma.current;
    if (c) c.offset.set(a, a * 0.75);
    const b = bloom.current;
    if (b) b.intensity = BLOOM + bus.bloom + bus.warp * 1.3 + bus.flare * 0.3;
  });

  return (
    <EffectComposer multisampling={coarse ? 2 : 4}>
      <Bloom ref={bloom} mipmapBlur intensity={BLOOM} luminanceThreshold={0.78} luminanceSmoothing={0.25} radius={0.72} />
      <ChromaticAberration ref={chroma} offset={offset} radialModulation modulationOffset={0.12} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.26} darkness={0.72} />
      <Noise opacity={0.045} premultiply />
    </EffectComposer>
  );
}
