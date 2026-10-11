import type { Vector3 } from 'three';

/**
 * Fire-and-forget visual events. Kept outside React state so a burst of
 * strikes never triggers re-renders; scene components subscribe and animate
 * imperatively inside useFrame.
 */
export type FxEvent =
  | { kind: 'laser'; to: Vector3 }
  | { kind: 'burst'; at: Vector3; normal: Vector3; color: string; count: number; speed: number }
  | { kind: 'float'; at: Vector3; text: string; color: string; big: boolean }
  | { kind: 'shake'; strength: number };

type Listener = (e: FxEvent) => void;
const listeners = new Set<Listener>();

export function emitFx(e: FxEvent): void {
  for (const l of listeners) l(e);
}

export function onFx(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
