import type { ResourceId } from './resources.js';

/**
 * Balance curves. Every number the host uses to decide an outcome lives here
 * so the client can predict it and the tests and the balance script can pin
 * it. See DESIGN.md §11 for the reasoning and `npm run balance` for pacing.
 */

/* ---------------- upgrades ---------------- */

export type UpgradeId =
  | 'drillBit'
  | 'focusLens'
  | 'coolant'
  | 'drone'
  | 'rig'
  | 'seismic'
  | 'smelter'
  | 'infuser'
  | 'compressor'
  | 'condenser'
  | 'press'
  | 'reactor';

export type UpgradeTab = 'mining' | 'refinery';

export interface UpgradeDef {
  id: UpgradeId;
  tab: UpgradeTab;
  name: string;
  desc: string;
  currency: ResourceId;
  baseCost: number;
  /** cost(n) = baseCost * growth^n */
  growth: number;
  maxLevel?: number;
  /** Hidden until the team has produced this much of a resource this run. */
  unlock?: { res: ResourceId; amount: number };
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  drillBit: { id: 'drillBit', tab: 'mining', name: 'Drill Bit', desc: '+1 ore per strike, ×2 every 25 levels', currency: 'ore', baseCost: 10, growth: 1.18 },
  focusLens: { id: 'focusLens', tab: 'mining', name: 'Focus Lens', desc: '+1% critical strike chance', currency: 'ore', baseCost: 50, growth: 1.32, maxLevel: 40 },
  drone: { id: 'drone', tab: 'mining', name: 'Orbital Drone', desc: '+0.6 ore/s, orbits the asteroid', currency: 'ore', baseCost: 25, growth: 1.16 },
  coolant: { id: 'coolant', tab: 'mining', name: 'Coolant Loop', desc: 'Less heat per strike, vents faster', currency: 'alloy', baseCost: 4, growth: 1.7, maxLevel: 12, unlock: { res: 'alloy', amount: 1 } },
  rig: { id: 'rig', tab: 'mining', name: 'Auto Rig', desc: 'A drill rig on a seam: 2 strikes/s', currency: 'alloy', baseCost: 25, growth: 1.4, maxLevel: 16, unlock: { res: 'alloy', amount: 20 } },
  seismic: { id: 'seismic', tab: 'mining', name: 'Seismic Charge', desc: 'Doubles ALL ore income', currency: 'plasma', baseCost: 40, growth: 5, unlock: { res: 'plasma', amount: 20 } },
  smelter: { id: 'smelter', tab: 'refinery', name: 'Smelter', desc: '+1 alloy/s (eats 10 ore each)', currency: 'ore', baseCost: 600, growth: 1.2, unlock: { res: 'ore', amount: 2500 } },
  infuser: { id: 'infuser', tab: 'refinery', name: 'Plasma Infuser', desc: '+0.2 plasma/s (eats 25 alloy each)', currency: 'alloy', baseCost: 1000, growth: 1.25, unlock: { res: 'alloy', amount: 6000 } },
  compressor: { id: 'compressor', tab: 'refinery', name: 'Dark Compressor', desc: '+0.04 dark matter/s (eats 50 plasma each)', currency: 'plasma', baseCost: 400, growth: 1.3, unlock: { res: 'plasma', amount: 1500 } },
  condenser: { id: 'condenser', tab: 'refinery', name: 'Cosmic Condenser', desc: '+0.01 cosmic energy/s (eats 100 dark matter each)', currency: 'darkMatter', baseCost: 30, growth: 1.4, unlock: { res: 'darkMatter', amount: 250 } },
  press: { id: 'press', tab: 'refinery', name: 'Hydraulic Press', desc: '+100% yield from manual presses', currency: 'alloy', baseCost: 15, growth: 1.7, maxLevel: 20, unlock: { res: 'alloy', amount: 10 } },
  reactor: { id: 'reactor', tab: 'refinery', name: 'Fusion Reactor', desc: '+0.6 power/s and +25 max power', currency: 'alloy', baseCost: 30, growth: 1.55, maxLevel: 12, unlock: { res: 'alloy', amount: 60 } },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export type UpgradeLevels = Record<UpgradeId, number>;

export function emptyLevels(): UpgradeLevels {
  const l = {} as UpgradeLevels;
  for (const id of UPGRADE_IDS) l[id] = 0;
  return l;
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

/* ---------------- refinery machines ---------------- */

export type MachineId = 'smelter' | 'infuser' | 'compressor' | 'condenser';
export const MACHINES: MachineId[] = ['smelter', 'infuser', 'compressor', 'condenser'];

export interface MachineDef {
  id: MachineId;
  input: ResourceId;
  output: ResourceId;
  /** Units of input per unit of output. */
  ratio: number;
  /** Output per second per machine level. */
  rate: number;
  /** Output per manual press, before press upgrades. */
  pressBase: number;
}

export const MACHINE_DEFS: Record<MachineId, MachineDef> = {
  smelter: { id: 'smelter', input: 'ore', output: 'alloy', ratio: 10, rate: 1, pressBase: 1 },
  infuser: { id: 'infuser', input: 'alloy', output: 'plasma', ratio: 25, rate: 0.2, pressBase: 0.2 },
  compressor: { id: 'compressor', input: 'plasma', output: 'darkMatter', ratio: 50, rate: 0.04, pressBase: 0.04 },
  condenser: { id: 'condenser', input: 'darkMatter', output: 'cosmicEnergy', ratio: 100, rate: 0.01, pressBase: 0.01 },
};

/* ---------------- skills (Quantum tree) ---------------- */

export type SkillId =
  | 'ancestralBits'
  | 'thermalMastery'
  | 'seamSense'
  | 'furnaceSoul'
  | 'gridSurplus'
  | 'headStart'
  | 'resonantBond'
  | 'eventHorizon'
  | 'sharedWake';

export type SkillBranch = 'excavation' | 'industry' | 'resonance';

export interface SkillDef {
  id: SkillId;
  branch: SkillBranch;
  name: string;
  desc: string;
  cost: number;
  max: number;
}

export const SKILLS: Record<SkillId, SkillDef> = {
  ancestralBits: { id: 'ancestralBits', branch: 'excavation', name: 'Ancestral Bits', desc: '+50% strike and rig ore per level', cost: 1, max: 10 },
  thermalMastery: { id: 'thermalMastery', branch: 'excavation', name: 'Thermal Mastery', desc: 'Hot drilling starts 5 heat earlier per level', cost: 2, max: 4 },
  seamSense: { id: 'seamSense', branch: 'excavation', name: 'Seam Sense', desc: '+1 mineral seam on the asteroid', cost: 3, max: 3 },
  furnaceSoul: { id: 'furnaceSoul', branch: 'industry', name: 'Furnace Soul', desc: '+50% refinery output per level', cost: 1, max: 10 },
  gridSurplus: { id: 'gridSurplus', branch: 'industry', name: 'Grid Surplus', desc: '+25% power from every source', cost: 1, max: 5 },
  headStart: { id: 'headStart', branch: 'industry', name: 'Head Start', desc: 'Begin each run with 500 ore and 50 alloy per level', cost: 1, max: 5 },
  resonantBond: { id: 'resonantBond', branch: 'resonance', name: 'Resonant Bond', desc: '+0.25 to the max sync combo', cost: 2, max: 4 },
  eventHorizon: { id: 'eventHorizon', branch: 'resonance', name: 'Event Horizon', desc: '+50% co-op event rewards', cost: 2, max: 3 },
  sharedWake: { id: 'sharedWake', branch: 'resonance', name: 'Shared Wake', desc: '+10% offline gains per level', cost: 1, max: 5 },
};

export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];
export type SkillLevels = Record<SkillId, number>;

export function emptySkills(): SkillLevels {
  const s = {} as SkillLevels;
  for (const id of SKILL_IDS) s[id] = 0;
  return s;
}

/* ---------------- active mining ---------------- */

export const CRIT_BASE = 0.05;
export const CRIT_PER_LENS = 0.01;
export const CRIT_MULT = 5;
export const SEAM_MULT = 3;
/** Depletion jackpot on the hit that finishes a seam. */
export const DEPLETE_MULT = 4;

export const critChance = (lv: UpgradeLevels, focusBuff: boolean): number =>
  Math.min(0.6, CRIT_BASE + CRIT_PER_LENS * lv.focusLens + (focusBuff ? 0.2 : 0));

/** Ore from one manual strike before crit / seam / heat / combo multipliers. */
export function strikeBase(lv: UpgradeLevels, sk: SkillLevels, globalMult: number): number {
  return (1 + lv.drillBit) * milestoneMult(lv.drillBit) * (1 + 0.5 * sk.ancestralBits) * Math.pow(2, lv.seismic) * globalMult;
}

export const DRONE_RATE = 0.6;
export function droneOrePerSec(lv: UpgradeLevels, globalMult: number): number {
  return lv.drone * DRONE_RATE * milestoneMult(lv.drone) * Math.pow(2, lv.seismic) * globalMult;
}

export const RIG_STRIKES_PER_SEC = 2;
export const RIG_YIELD = 0.5;

/* ---------------- heat (Mining Specialist) ---------------- */

export const HEAT_MAX = 100;
export const HEAT_PER_STRIKE = 7;
export const HEAT_VENT_PER_SEC = 18;
export const HEAT_BONUS_THRESHOLD = 70;
export const OVERHEAT_LOCK_MS = 2000;

export const heatPerStrike = (lv: UpgradeLevels): number => HEAT_PER_STRIKE * Math.pow(0.93, lv.coolant);
export const heatVent = (lv: UpgradeLevels): number => HEAT_VENT_PER_SEC * (1 + 0.1 * lv.coolant);
export const hotThreshold = (sk: SkillLevels): number => HEAT_BONUS_THRESHOLD - 5 * sk.thermalMastery;

/* ---------------- power and overclocks (Refinery Operator) ---------------- */

export const POWER_BASE_MAX = 100;
export const POWER_BASE_REGEN = 0.4;
export const POWER_PER_PRESS = 1;
export const powerMax = (lv: UpgradeLevels): number => POWER_BASE_MAX + 25 * lv.reactor;
export const powerRegen = (lv: UpgradeLevels, sk: SkillLevels): number =>
  (POWER_BASE_REGEN + 0.6 * lv.reactor) * (1 + 0.25 * sk.gridSurplus);

export type OverclockId = 'thermalDump' | 'focusField' | 'hyperdrive' | 'droneSurge';
export interface OverclockDef {
  id: OverclockId;
  name: string;
  desc: string;
  cost: number;
  /** Buff duration in ms (0 = instant). */
  ms: number;
}
export const OVERCLOCKS: Record<OverclockId, OverclockDef> = {
  thermalDump: { id: 'thermalDump', name: 'Thermal Dump', desc: 'Vents every miner to 0 heat and unlocks overheated drills', cost: 25, ms: 0 },
  focusField: { id: 'focusField', name: 'Focus Field', desc: '+20% crit chance for the team', cost: 40, ms: 15000 },
  droneSurge: { id: 'droneSurge', name: 'Drone Surge', desc: 'Drones mine ×3', cost: 50, ms: 15000 },
  hyperdrive: { id: 'hyperdrive', name: 'Hyperdrive', desc: 'Every strike yields ×2', cost: 70, ms: 10000 },
};
export const OVERCLOCK_IDS = Object.keys(OVERCLOCKS) as OverclockId[];

/** Manual press output for a machine, before combo and buffs. */
export function pressYield(m: MachineId, lv: UpgradeLevels, sk: SkillLevels, globalMult: number): number {
  return MACHINE_DEFS[m].pressBase * (1 + lv.press) * (1 + 0.5 * sk.furnaceSoul) * globalMult;
}
/** Automatic machine output per second at full input. */
export function machineRate(m: MachineId, lv: UpgradeLevels, sk: SkillLevels, globalMult: number): number {
  return MACHINE_DEFS[m].rate * lv[m] * milestoneMult(lv[m]) * (1 + 0.5 * sk.furnaceSoul) * globalMult;
}

/* ---------------- sync combo ---------------- */

/** A strike and a press within this window count as a sync. */
export const SYNC_WINDOW_MS = 600;
export const SYNC_STEP = 0.1;
export const COMBO_HOLD_MS = 3000;
export const maxCombo = (sk: SkillLevels): number => 2 + 0.25 * sk.resonantBond;

/* ---------------- prestige: Galactic Quantum Leap ---------------- */

export const LEAP_THRESHOLD = 10; // cosmic energy produced this run
/** Quantum Points for a leap: floor(sqrt(E / threshold) × (1 + 0.1 × (players − 1))). */
export function quantumPointsFor(runCosmicEnergy: number, participants = 1): number {
  if (runCosmicEnergy < LEAP_THRESHOLD) return 0;
  return Math.floor(Math.sqrt(runCosmicEnergy / LEAP_THRESHOLD) * (1 + 0.1 * (participants - 1)));
}
/** Every unspent Quantum Point is +5% to all production. */
export const quantumMult = (unspentQP: number): number => 1 + 0.05 * unspentQP;

/* ---------------- offline gains ---------------- */

export const OFFLINE_CAP_S = 8 * 3600;
export const offlineEfficiency = (sk: SkillLevels): number => 0.5 + 0.1 * sk.sharedWake;
export function offlineGain(passivePerSec: number, elapsedS: number, efficiency = 0.5): number {
  return passivePerSec * Math.min(Math.max(0, elapsedS), OFFLINE_CAP_S) * efficiency;
}
