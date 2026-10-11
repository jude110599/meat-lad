import { Vector3, type Object3D } from 'three';
import { surfacePoint, type Vec3 } from '@starforge/shared';

/**
 * Plain mutable handles shared between the 3D scene and the network layer,
 * so results that arrive from the host can be placed in world space.
 */
export const refs = {
  /** The spinning asteroid group; seam directions are in its local space. */
  rock: null as Object3D | null,
  /** World position of each other player's ship, updated every frame by the scene. */
  ships: new Map<string, Vector3>(),
};

/** World-space point and outward normal on the rock surface along a local direction. */
export function rockPoint(dir: Vec3, seed: number, lift = 0): { point: Vector3; normal: Vector3 } {
  const local = new Vector3(...surfacePoint(dir, seed));
  const normal = new Vector3(...dir).normalize();
  local.addScaledVector(normal, lift);
  const rock = refs.rock;
  if (rock) {
    rock.updateWorldMatrix(true, false);
    local.applyMatrix4(rock.matrixWorld);
    normal.transformDirection(rock.matrixWorld);
  }
  return { point: local, normal };
}

/** CSS colour for a player hue. */
export const hueColor = (hue: number, l = 62): string => `hsl(${hue} 95% ${l}%)`;
