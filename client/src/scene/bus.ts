import { Color, type Vector3 } from 'three';

/**
 * Scene-internal mutable state shared between components that animate in
 * useFrame. Nothing here is React state: writers poke numbers, readers pick
 * them up on the next frame, so cross-component effects cost no re-renders.
 */

export interface SparkOpts {
  /** 0 = tight jet along `dir`, 1+ = wide spray. */
  spread?: number;
  /** Mean lifetime in seconds. */
  life?: number;
  /** Size multiplier. */
  size?: number;
  /** Velocity damping per second. */
  drag?: number;
  /** Fraction of sparks that burn white-hot. */
  white?: number;
}

type SparkFn = (at: Vector3, dir: Vector3 | null, color: Color, count: number, speed: number, opts?: SparkOpts) => void;
type FloatFn = (at: Vector3, text: string, color: string, big: boolean) => void;
type WaveFn = (color: Color, strength: number) => void;

export const bus = {
  /** Decaying camera shake amplitude (fed by 'shake' fx). */
  shake: 0,
  /** Chromatic aberration spike, decays in PostFX. */
  aberration: 0,
  /** Bloom intensity bump, decays in PostFX. */
  bloom: 0,
  /** 'flash' tint colour and strength (decays in Lights). */
  tint: new Color(1, 1, 1),
  tintAmt: 0,
  /** Eased resonance surge amount 0..1 (written by PostFX), for the cyan wash in Sky and Lights. */
  surge: 0,
  /** Quantum Leap warp envelope 0..1 (written by Warp). */
  warp: 0,
  /** Pixels per world unit at distance 1, for size-attenuated point sprites (written by CameraRig). */
  pointScale: 800,
  /**
   * Eased size (CSS px) of the screen area the HUD leaves visible. CameraRig
   * shifts the projection so the orbit target sits at its centre.
   */
  view: { w: 1, h: 1 },

  sparks: null as SparkFn | null,
  floater: null as FloatFn | null,
  wave: null as WaveFn | null,
};

export function sparks(at: Vector3, dir: Vector3 | null, color: Color, count: number, speed: number, opts?: SparkOpts): void {
  bus.sparks?.(at, dir, color, count, speed, opts);
}

export function floater(at: Vector3, text: string, color: string, big = false): void {
  bus.floater?.(at, text, color, big);
}

export function shockwave(color: Color, strength = 1): void {
  bus.wave?.(color, strength);
}
