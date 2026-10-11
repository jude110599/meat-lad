import type { Vector3 } from 'three';
import type { MachineId, ResourceId } from '@starforge/shared';

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
  /** A refinery machine was pressed by a player (or the station should pulse). */
  | { kind: 'press'; machine: MachineId; made: number; output: ResourceId; playerId: string; sync: boolean }
  /** A quake node was locked by a stabilize press. */
  | { kind: 'nodeLock'; nodeId: number }
  /** The flare shield was topped up. */
  | { kind: 'shieldHit'; shield: number }
  /** Event started or ended: a big ring of light across the scene. */
  | { kind: 'shockwave'; color: string }
  /** Overclock fired: brief full-scene tint in the buff colour. */
  | { kind: 'overclock'; color: string }
  /** Quantum Leap: warp-speed transition. */
  | { kind: 'leap' };

type Listener = (e: FxEvent) => void;
const listeners = new Set<Listener>();

export function emitFx(e: FxEvent): void {
  for (const l of listeners) l(e);
}

export function onFx(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
