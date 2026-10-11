import type { ResourceId } from './resources.js';

/**
 * Balance curves. Every number the server uses to decide an outcome lives
 * here so the client can predict it and the tests can pin it.
 * See DESIGN.md §6 for the reasoning behind each constant.
 */

export type UpgradeId = 'drillBit' | 'focusLens' | 'coolant' | 'drone';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  desc: string;
  currency: ResourceId;
  baseCost: number;
  /** Cost growth per level: cost(n) = baseCost * growth^n. */
  growth: number;
  maxLevel?: number;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  drillBit: { id: 'drillBit', name: 'Drill Bit', desc: '+1 ore per strike, x2 every 25 levels', currency: 'ore', baseCost: 10, growth: 1.15 },
  focusLens: { id: 'focusLens', name: 'Focus Lens', desc: '+1% critical strike chance', currency: 'ore', baseCost: 50, growth: 1.35, maxLevel: 45 },
  coolant: { id: 'coolant', name: 'Coolant Loop', desc: '-6% heat per strike, faster venting', currency: 'ore', baseCost: 75, growth: 1.6, maxLevel: 12 },
  drone: { id: 'drone', name: 'Orbital Drone', desc: '+0.5 ore/s, orbits the asteroid', currency: 'ore', baseCost: 25, growth: 1.12 },
};

export type UpgradeLevels = Record<UpgradeId, number>;

export function emptyLevels(): UpgradeLevels {
  return { drillBit: 0, focusLens: 0, coolant: 0, drone: 0 };
}

export function upgradeCost(id: UpgradeId, level: number): number {
  const def = UPGRADES[id];
  return Math.ceil(def.baseCost * Math.pow(def.growth, level));
}

/** Cost of buying `count` levels at once starting from `level` (closed-form geometric sum). */
export function bulkCost(id: UpgradeId, level: number, count: number): number {
  const { baseCost, growth } = UPGRADES[id];
  return Math.ceil((baseCost * Math.pow(growth, level) * (Math.pow(growth, count) - 1)) / (growth - 1));
}

/** Milestone doubling: every 25 levels of a producer doubles its output. */
export const milestoneMult = (level: number): number => Math.pow(2, Math.floor(level / 25));

export const CRIT_BASE = 0.05;
export const CRIT_PER_LENS = 0.01;
export const CRIT_MULT = 5;
export const SEAM_MULT = 3;

export const critChance = (lv: UpgradeLevels): number => Math.min(0.5, CRIT_BASE + CRIT_PER_LENS * lv.focusLens);

/** Ore granted by one manual strike before crit / seam / heat multipliers. */
export function strikeBase(lv: UpgradeLevels, globalMult: number): number {
  return (1 + lv.drillBit) * milestoneMult(lv.drillBit) * globalMult;
}

export const DRONE_RATE = 0.5;
export function passiveOrePerSec(lv: UpgradeLevels, globalMult: number): number {
  return lv.drone * DRONE_RATE * milestoneMult(lv.drone) * globalMult;
}

/* ---------- heat (Mining Specialist resource) ---------- */
export const HEAT_MAX = 100;
export const HEAT_PER_STRIKE = 7;
export const HEAT_VENT_PER_SEC = 18;
/** Running above this threshold pays double ore ("hot drilling"). */
export const HEAT_BONUS_THRESHOLD = 70;
export const OVERHEAT_LOCK_MS = 2000;

export const heatPerStrike = (lv: UpgradeLevels): number => HEAT_PER_STRIKE * Math.pow(0.94, lv.coolant);
export const heatVent = (lv: UpgradeLevels): number => HEAT_VENT_PER_SEC * (1 + 0.08 * lv.coolant);

/* ---------- prestige: Galactic Quantum Leap ---------- */
export const LEAP_THRESHOLD = 1e3; // cosmic energy earned this run
/** Quantum Points for a leap: floor(sqrt(E / 1000)) * (1 + 0.1 * participants-1). */
export function quantumPointsFor(runCosmicEnergy: number, participants = 1): number {
  if (runCosmicEnergy < LEAP_THRESHOLD) return 0;
  return Math.floor(Math.sqrt(runCosmicEnergy / LEAP_THRESHOLD) * (1 + 0.1 * (participants - 1)));
}
/** Every unspent Quantum Point is +2% to all production. */
export const quantumMult = (unspentQP: number): number => 1 + 0.02 * unspentQP;

/* ---------- offline gains ---------- */
export const OFFLINE_CAP_S = 8 * 3600;
export const OFFLINE_EFFICIENCY = 0.5;
export function offlineGain(passivePerSec: number, elapsedS: number): number {
  return passivePerSec * Math.min(Math.max(0, elapsedS), OFFLINE_CAP_S) * OFFLINE_EFFICIENCY;
}
