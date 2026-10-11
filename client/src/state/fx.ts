import type { Vector3 } from 'three';

/**
 * Fire-and-forget visual events. Kept outside React state so a burst of
 * strikes never triggers re-renders; scene components subscribe with `onFx`
 * and animate imperatively inside useFrame.
 */
export type FxEvent =
  /** Drill laser. `from` is a player id: mine fires from the camera rig, others from their ship. */
  | { kind: 'laser'; from: string; to: Vector3; color: string; crit: boolean }
  | { kind: 'burst'; at: Vector3; normal: Vector3; color: string; count: number; speed: number }
  | { kind: 'float'; at: Vector3; text: string; color: string; big: boolean }
  | { kind: 'shake'; strength: number }
  /** Glowing scorch mark left on the rock where a strike landed. */
  | { kind: 'scorch'; at: Vector3; normal: Vector3; hot: boolean }
  /** A big ring of light across the scene (a Forge Tree node unlocked, a surge began). */
  | { kind: 'shockwave'; color: string }
  /** Brief full-scene tint. */
  | { kind: 'flash'; color: string }
  /** Someone caught the comet: it bursts where it is. */
  | { kind: 'cometCaught'; id: number; color: string }
  /** My Quantum Leap: warp-speed transition. */
  | { kind: 'leap' }
  /**
   * A strike's result landed on the rock (after 'burst'): rock chunks, ore
   * motes flying to the striker (`by`), and a coloured flare on crits.
   */
  | { kind: 'impact'; at: Vector3; normal: Vector3; by: string; crit: boolean; broke: boolean; seam: boolean }
  /** Someone bought upgrade levels: a small celebration in their colour. */
  | { kind: 'upgrade'; by: string; id: string; color: string; mine: boolean };

type Listener = (e: FxEvent) => void;
const listeners = new Set<Listener>();

export function emitFx(e: FxEvent): void {
  for (const l of listeners) l(e);
}

export function onFx(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
