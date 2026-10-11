import type { ResourceId, Wallet } from './resources.js';

/**
 * Balance data. Every number the host uses to decide an outcome lives here
 * (formulas that need room state are in sim.ts), so the client can show it
 * and the tests and `npm run balance` can pin it. See DESIGN.md §9–§13.
 */

/* ---------------- personal upgrades ---------------- */

export type UpgradeId = 'drill' | 'drone' | 'lens' | 'rig' | 'smelter' | 'scanner' | 'harvester' | 'plating';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  icon: string;
  desc: string;
  currency: ResourceId;
  baseCost: number;
  /** cost(n) = baseCost * growth^n */
  growth: number;
  maxLevel?: number;
  /** Hidden until the team unlocks this Forge Tree node. */
  needs?: NodeId;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  drill: { id: 'drill', name: 'Drill Laser', icon: '⛏️', desc: '+1 ore per tap. Doubles every 25 levels.', currency: 'ore', baseCost: 12, growth: 1.18 },
  drone: { id: 'drone', name: 'Mining Drone', icon: '🛰️', desc: '+0.5 ore/s. Doubles every 25 levels.', currency: 'ore', baseCost: 15, growth: 1.17 },
  lens: { id: 'lens', name: 'Focus Lens', icon: '🔍', desc: '+1% chance for a critical tap.', currency: 'ore', baseCost: 120, growth: 1.45, maxLevel: 35 },
  rig: { id: 'rig', name: 'Auto-Rig', icon: '⚙️', desc: 'Taps a glowing seam for you once a second.', currency: 'ore', baseCost: 5000, growth: 1.4, maxLevel: 10, needs: 'autorig' },
  smelter: { id: 'smelter', name: 'Smelter', icon: '🔥', desc: 'Refines 0.25% of all the ore you mine into alloy.', currency: 'ore', baseCost: 30000, growth: 1.3, maxLevel: 40, needs: 'smelting' },
  scanner: { id: 'scanner', name: 'Seam Scanner', icon: '📡', desc: 'Glowing seams pay +25% more.', currency: 'alloy', baseCost: 2000, growth: 2, maxLevel: 10, needs: 'deepscan' },
  harvester: { id: 'harvester', name: 'Harvester', icon: '🚀', desc: '+40 ore/s. Doubles every 25 levels.', currency: 'alloy', baseCost: 20000, growth: 1.22, needs: 'harvesters' },
  plating: { id: 'plating', name: 'Alloy Plating', icon: '🛡️', desc: 'Drones and Harvesters +25%.', currency: 'alloy', baseCost: 10000, growth: 1.9, maxLevel: 15, needs: 'plating' },
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

/** Cost of `count` levels starting at `level`, exactly as buying them one by one. */
export function bulkCost(id: UpgradeId, level: number, count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) sum += upgradeCost(id, level + i);
  return sum;
}

/** How many levels `budget` buys from `level`, respecting the max. */
export function affordable(id: UpgradeId, level: number, budget: number): number {
  const { baseCost, growth, maxLevel } = UPGRADES[id];
  const first = baseCost * Math.pow(growth, level);
  let n = budget < first ? 0 : Math.floor(Math.log((budget * (growth - 1)) / first + 1) / Math.log(growth));
  n = Math.min(n, 1000);
  if (maxLevel !== undefined) n = Math.min(n, maxLevel - level);
  while (n > 0 && bulkCost(id, level, n) > budget) n--;
  return Math.max(0, n);
}

/** Every 25 levels of a producer doubles its output. */
export const milestoneMult = (level: number): number => Math.pow(2, Math.floor(level / 25));

/* ---------------- the Forge Tree ---------------- */

export type NodeId =
  | 'core'
  | 'autorig'
  | 'swarm'
  | 'optics'
  | 'smelting'
  | 'teamlink'
  | 'deepscan'
  | 'hotsmelt'
  | 'plating'
  | 'harvesters'
  | 'overdrive'
  | 'nightshift'
  | 'leap'
  | 'resonance'
  | 'memory'
  | 'starseed'
  | 'hyperdrill'
  | 'dyson'
  | 'singularity'
  | 'mastery';

export interface NodeDef {
  id: NodeId;
  name: string;
  icon: string;
  desc: string;
  /** Row from the top (0 is the root) and horizontal slot (-2..2) for drawing. */
  tier: number;
  x: number;
  cost: Partial<Wallet>;
  /** Every one of these must be unlocked first. */
  needs: NodeId[];
  /** Repeatable: each level multiplies the cost by this. */
  repeat?: number;
}

/**
 * Shared by the whole crew: anyone can put their own ore, alloy or cores into
 * a node, and when it is fully funded it unlocks for everyone, forever
 * (Quantum Leaps keep it). Prices are steep on purpose: every contribution
 * is ore that didn't go into your own upgrades.
 */
export const NODES: Record<NodeId, NodeDef> = {
  core: { id: 'core', name: 'Forge Core', icon: '✦', desc: 'Everyone mines ×1.5 ore.', tier: 0, x: 0, cost: { ore: 3_000 }, needs: [] },

  autorig: { id: 'autorig', name: 'Auto-Rigs', icon: '⚙️', desc: 'Unlocks Auto-Rigs: they tap seams for you.', tier: 1, x: -1, cost: { ore: 60_000 }, needs: ['core'] },
  swarm: { id: 'swarm', name: 'Swarm Logic', icon: '🛰️', desc: 'Everyone’s drones produce ×2.', tier: 1, x: 0, cost: { ore: 120_000 }, needs: ['core'] },
  optics: { id: 'optics', name: 'Fine Optics', icon: '🔍', desc: 'Critical taps pay ×10 instead of ×5.', tier: 1, x: 1, cost: { ore: 250_000 }, needs: ['core'] },

  smelting: { id: 'smelting', name: 'Smelting', icon: '🔥', desc: 'Unlocks Smelters, which turn part of your ore into alloy.', tier: 2, x: -1, cost: { ore: 2.5e6 }, needs: ['autorig'] },
  teamlink: { id: 'teamlink', name: 'Crew Link', icon: '🤝', desc: 'All income +25%, and another +25% for each crewmate past the second.', tier: 2, x: 0, cost: { ore: 6e6 }, needs: ['swarm'] },
  deepscan: { id: 'deepscan', name: 'Deep Scan', icon: '📡', desc: 'Seams pay ×6 instead of ×3, two more seams appear, and Seam Scanners unlock.', tier: 2, x: 1, cost: { ore: 15e6 }, needs: ['optics'] },

  hotsmelt: { id: 'hotsmelt', name: 'Hot Smelting', icon: '♨️', desc: 'Smelters refine twice as much.', tier: 3, x: -1.5, cost: { ore: 120e6, alloy: 300_000 }, needs: ['smelting'] },
  plating: { id: 'plating', name: 'Alloy Plating', icon: '🛡️', desc: 'Unlocks Alloy Plating for drones and harvesters.', tier: 3, x: -0.5, cost: { ore: 60e6, alloy: 150_000 }, needs: ['smelting'] },
  harvesters: { id: 'harvesters', name: 'Harvester Fleet', icon: '🚀', desc: 'Unlocks Harvesters: big ships that mine 40 ore/s each.', tier: 3, x: 0.5, cost: { ore: 120e6, alloy: 400_000 }, needs: ['smelting', 'teamlink'] },
  overdrive: { id: 'overdrive', name: 'Overdrive', icon: '⚡', desc: 'Taps and Auto-Rigs mine ×4.', tier: 3, x: 1.5, cost: { ore: 400e6, alloy: 1e6 }, needs: ['deepscan'] },

  nightshift: { id: 'nightshift', name: 'Night Shift', icon: '🌙', desc: 'Earn 75% instead of 25% while away, for up to 12 hours.', tier: 4, x: -1, cost: { ore: 4e9, alloy: 15e6 }, needs: ['harvesters'] },
  leap: { id: 'leap', name: 'Quantum Leap', icon: '🌀', desc: 'Lets each of you leap: restart your own run for Star Cores.', tier: 4, x: 0, cost: { ore: 2e9, alloy: 8e6 }, needs: ['harvesters', 'hotsmelt'] },
  resonance: { id: 'resonance', name: 'Resonance', icon: '〰️', desc: 'Breaking a seam gives the whole crew ×2 ore for 15 s.', tier: 4, x: 1, cost: { ore: 6e9, alloy: 25e6 }, needs: ['overdrive', 'plating'] },

  memory: { id: 'memory', name: 'Stellar Memory', icon: '🧠', desc: 'Start every run with 10 Drill and 10 Drone levels.', tier: 5, x: -1.5, cost: { cores: 4 }, needs: ['leap'] },
  starseed: { id: 'starseed', name: 'Starseed', icon: '🌱', desc: 'Each Star Core you hold gives +20% instead of +10%.', tier: 5, x: -0.5, cost: { cores: 12 }, needs: ['leap'] },
  hyperdrill: { id: 'hyperdrill', name: 'Hyperdrill', icon: '💥', desc: 'Taps and Auto-Rigs mine ×10.', tier: 5, x: 0.5, cost: { cores: 25 }, needs: ['leap'] },
  dyson: { id: 'dyson', name: 'Dyson Swarm', icon: '☀️', desc: 'Drones and Harvesters mine ×10.', tier: 5, x: 1.5, cost: { cores: 40 }, needs: ['leap'] },

  singularity: { id: 'singularity', name: 'Singularity Forge', icon: '🕳️', desc: 'All income ×3.', tier: 6, x: 0, cost: { cores: 100, ore: 5e13 }, needs: ['starseed', 'hyperdrill', 'dyson'] },
  mastery: { id: 'mastery', name: 'Forge Mastery', icon: '👑', desc: 'All income ×1.5 per level. Each level costs ×10.', tier: 7, x: 0, cost: { cores: 60, ore: 5e14 }, needs: ['singularity'], repeat: 10 },
};

export const NODE_IDS = Object.keys(NODES) as NodeId[];

/** What the next level of a node costs (repeatable nodes grow). */
export function nodeCost(id: NodeId, level: number): Partial<Wallet> {
  const def = NODES[id];
  const k = def.repeat ? Math.pow(def.repeat, level) : 1;
  const out: Partial<Wallet> = {};
  for (const [r, v] of Object.entries(def.cost) as [ResourceId, number][]) out[r] = Math.ceil(v * k);
  return out;
}

/* ---------------- tapping ---------------- */

export const BASE_CRIT = 0.05;
export const CRIT_MULT = 5;
export const CRIT_MULT_OPTICS = 10;
export const SEAM_MULT = 3;
export const SEAM_MULT_DEEP = 6;
/** Breaking a seam (its last hit) pays this much extra. */
export const BREAK_MULT = 5;
export const DRONE_RATE = 0.5;
export const HARVESTER_RATE = 40;
/** Auto-Rig strikes per second per level, each worth this share of a tap on a seam. */
export const RIG_RATE = 1;
export const RIG_SHARE = 0.25;
export const SMELT_PER_LEVEL = 0.0025;

/* ---------------- comets ---------------- */

export const COMET_MS = 12_000;
export const COMET_GAP_MIN_MS = 100_000;
export const COMET_GAP_MAX_MS = 200_000;
/** A caught comet pays every online crewmate this many seconds of their passive income (at least `COMET_TAPS` taps); the catcher gets double. */
export const COMET_SECONDS = 40;
export const COMET_TAPS = 60;

/* ---------------- surge (Resonance) ---------------- */

export const SURGE_MS = 15_000;
export const SURGE_CAP_MS = 60_000;

/* ---------------- Star Cores and leaps ---------------- */

export const CORE_BONUS = 0.1;
export const CORE_BONUS_STARSEED = 0.2;
/** Ore you must mine in a run before a leap pays anything. */
export const LEAP_MIN_ORE = 1e9;

/**
 * Star Cores for leaping after mining `ore` this run. Grows with the cube
 * root, so ten times the ore pays a bit over twice the cores.
 */
export function coresFor(ore: number): number {
  return ore < LEAP_MIN_ORE ? 0 : Math.floor(3 * Math.cbrt(ore / LEAP_MIN_ORE) + 1e-9);
}

/** Ore a run needs for its leap to pay `cores` Star Cores. */
export function oreForCores(cores: number): number {
  return Math.max(LEAP_MIN_ORE, LEAP_MIN_ORE * Math.pow(cores / 3, 3));
}

/* ---------------- offline ---------------- */

export const OFFLINE_EFF = 0.25;
export const OFFLINE_EFF_NIGHT = 0.75;
export const OFFLINE_CAP_S = 8 * 3600;
export const OFFLINE_CAP_NIGHT_S = 12 * 3600;
