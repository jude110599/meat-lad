import { Vector3 } from 'three';
import { MACHINES, type MachineId } from '@starforge/shared';

/** World position of the refinery station hub. */
export const STATION_POS = new Vector3(6, -1.2, -3.5);

/** Distance of each machine module from the hub. */
export const MACHINE_RADIUS = 1.95;

/** Angle (around the hub's Y axis, in the XZ plane) that points at the asteroid. */
const TO_ROCK = Math.atan2(-STATION_POS.z, -STATION_POS.x);

/** Smelter faces the rock so the ore stream lands on it; the chain runs around the hub. */
export const MACHINE_ANGLE: Record<MachineId, number> = {
  smelter: TO_ROCK,
  infuser: TO_ROCK + Math.PI / 2,
  compressor: TO_ROCK + Math.PI,
  condenser: TO_ROCK + (Math.PI * 3) / 2,
};

/** Machine module centre relative to the hub. */
export function machineLocal(m: MachineId, out: Vector3): Vector3 {
  const a = MACHINE_ANGLE[m];
  return out.set(Math.cos(a) * MACHINE_RADIUS, 0, Math.sin(a) * MACHINE_RADIUS);
}

/** Machine module centre in world space. */
export function machineWorld(m: MachineId, out: Vector3): Vector3 {
  return machineLocal(m, out).add(STATION_POS);
}

/** Where streams enter a machine (top of the module). */
export function machineIntake(m: MachineId, out: Vector3): Vector3 {
  return machineWorld(m, out).add(INTAKE_LIFT);
}
const INTAKE_LIFT = new Vector3(0, 0.42, 0);

export { MACHINES };

/** Base vertical field of view; Warp punches it wider. */
export const BASE_FOV = 50;
