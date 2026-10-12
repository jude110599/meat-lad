import { Vector3 } from 'three';
import { unpackCam, type CamQ } from '@starforge/shared';

/**
 * Where each crewmate's camera is, from the host's `cams` relay (world
 * space; the planet's spin follows the host clock, so it lines up with
 * ours). Ships read this every frame and ease toward it.
 */
export interface CrewCam {
  pos: Vector3;
  /** Unit view direction. */
  dir: Vector3;
  /** performance.now() of the last update. */
  at: number;
}

export const crewCams = new Map<string, CrewCam>();

const p: [number, number, number] = [0, 0, 0];
const d: [number, number, number] = [0, 0, 0];

/** Apply a `cams` relay: every online crewmate with a camera is in it, so anyone missing is dropped. */
export function setCrewCams(cams: Record<string, CamQ>, me: string): void {
  if (!cams || typeof cams !== 'object') return;
  const now = performance.now();
  for (const id of [...crewCams.keys()]) if (!(id in cams)) crewCams.delete(id);
  for (const [id, c] of Object.entries(cams)) {
    if (id === me || !unpackCam(c, p, d)) continue;
    const cur = crewCams.get(id);
    if (cur) {
      cur.pos.set(p[0], p[1], p[2]);
      cur.dir.set(d[0], d[1], d[2]);
      cur.at = now;
    } else crewCams.set(id, { pos: new Vector3(p[0], p[1], p[2]), dir: new Vector3(d[0], d[1], d[2]), at: now });
  }
}
