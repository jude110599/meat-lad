import type { ResourceId, Wallet } from './resources.js';

/**
 * Balance data. Every number the host uses to decide an outcome lives here
 * (formulas that need room state are in sim.ts), so the client can show it
 * and the tests and `npm run balance` can pin it. See DESIGN.md §9–§13.
 */

/* ---------------- personal upgrades ---------------- */

export type UpgradeId =
  | 'drill'
  | 'drone'
  | 'lens'
  | 'combo'
  | 'beacon'
  | 'rig'
  | 'chain'
  | 'foreman'
  | 'smelter'
  | 'refinery'
  | 'uplink'
  | 'scanner'
  | 'harvester'
  | 'plating';

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
  /** Lowest Foreman level that auto-buys it (see FOREMAN). */
  auto: 1 | 2 | 3;
}

/**
 * The list order is the order the Upgrades tab shows them in. Producers
 * (Drill, Drone, Harvester) are uncapped and pass milestones (see
 * `MILESTONES`); everything else has a max level.
 */
export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  drill: { id: 'drill', name: 'Drill Laser', icon: '⛏️', desc: '+1 ore per tap. ×2 at levels 10, 25, 50 and 100, then every 50.', currency: 'ore', baseCost: 20, growth: 1.2, auto: 1 },
  drone: { id: 'drone', name: 'Mining Drone', icon: '🛰️', desc: '+5 ore/s. ×2 at levels 10, 25, 50 and 100, then every 50.', currency: 'ore', baseCost: 25, growth: 1.14, auto: 1 },
  lens: { id: 'lens', name: 'Focus Lens', icon: '🔍', desc: '+1% chance for a critical tap.', currency: 'ore', baseCost: 150, growth: 1.42, maxLevel: 35, auto: 2 },
  combo: { id: 'combo', name: 'Combo Coil', icon: '👊', desc: 'Keep tapping to build a streak: a full 30-tap streak pays +10% per level.', currency: 'ore', baseCost: 2_000, growth: 1.7, maxLevel: 10, needs: 'core', auto: 2 },
  beacon: { id: 'beacon', name: 'Night Beacon', icon: '🔦', desc: 'While you’re away: +1 hour of earnings and +2.5% offline rate.', currency: 'ore', baseCost: 2_500, growth: 2.6, maxLevel: 12, auto: 3 },
  rig: { id: 'rig', name: 'Auto-Rig', icon: '⚙️', desc: 'Taps a glowing seam for you once a second.', currency: 'ore', baseCost: 2_000, growth: 1.32, maxLevel: 15, needs: 'autorig', auto: 2 },
  chain: { id: 'chain', name: 'Chain Reactor', icon: '⛓️', desc: 'Crits in a row pay +10% more per level for each crit before them (up to 5).', currency: 'ore', baseCost: 15_000, growth: 1.75, maxLevel: 10, needs: 'optics', auto: 2 },
  foreman: { id: 'foreman', name: 'Foreman', icon: '🤖', desc: 'Auto-buys your upgrades while you play. Each level buys more kinds and spends more.', currency: 'ore', baseCost: 40_000, growth: 15, maxLevel: 3, needs: 'foreman', auto: 3 },
  smelter: { id: 'smelter', name: 'Smelter', icon: '🔥', desc: 'Refines 0.25% of all the ore you mine into alloy.', currency: 'ore', baseCost: 12_000, growth: 1.24, maxLevel: 40, needs: 'smelting', auto: 2 },
  refinery: { id: 'refinery', name: 'Refinery', icon: '🏭', desc: 'Turns 5% of your passive ore into alloy (1 alloy per 4 ore). You can switch it off.', currency: 'ore', baseCost: 60_000, growth: 1.7, maxLevel: 10, needs: 'smelting', auto: 3 },
  uplink: { id: 'uplink', name: 'Crew Uplink', icon: '📶', desc: '+3% to all your income for each crewmate online with you.', currency: 'ore', baseCost: 100_000, growth: 1.9, maxLevel: 10, needs: 'teamlink', auto: 3 },
  scanner: { id: 'scanner', name: 'Seam Scanner', icon: '📡', desc: 'Glowing seams pay +25% more.', currency: 'alloy', baseCost: 600, growth: 1.9, maxLevel: 10, needs: 'deepscan', auto: 3 },
  harvester: { id: 'harvester', name: 'Harvester', icon: '🚀', desc: '+250 ore/s. ×2 at levels 10, 25, 50 and 100, then every 50.', currency: 'alloy', baseCost: 1_500, growth: 1.15, needs: 'harvesters', auto: 1 },
  plating: { id: 'plating', name: 'Alloy Plating', icon: '🛡️', desc: 'Drones and Harvesters +25%.', currency: 'alloy', baseCost: 3_000, growth: 1.7, maxLevel: 20, needs: 'plating', auto: 3 },
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

/**
 * Producer milestones: Drill Laser, Mining Drone and Harvester double their
 * output at each of these levels, then again every MILESTONE_EVERY levels.
 */
export const MILESTONES = [10, 25, 50, 100] as const;
export const MILESTONE_EVERY = 50;

/** How many milestones `level` has passed. */
export function milestonesAt(level: number): number {
  let n = 0;
  for (const m of MILESTONES) if (level >= m) n++;
  const last = MILESTONES[MILESTONES.length - 1];
  if (level > last) n += Math.floor((level - last) / MILESTONE_EVERY);
  return n;
}

export const milestoneMult = (level: number): number => Math.pow(2, milestonesAt(level));

/** The next level at which a producer doubles. */
export function nextMilestone(level: number): number {
  for (const m of MILESTONES) if (level < m) return m;
  const last = MILESTONES[MILESTONES.length - 1];
  return last + (Math.floor((level - last) / MILESTONE_EVERY) + 1) * MILESTONE_EVERY;
}

/** Combo Coil: a tap within COMBO_WINDOW_MS of your last keeps the streak going. */
export const COMBO_WINDOW_MS = 1_500;
export const COMBO_CAP = 30;
export const COMBO_STEP = 0.1;
/** Chain Reactor: each crit in a row (up to CHAIN_CAP before it) adds CHAIN_STEP × level. */
export const CHAIN_STEP = 0.1;
export const CHAIN_CAP = 5;
/** Refinery: share of passive ore each level diverts, and alloy per diverted ore. */
export const REFINE_PER_LEVEL = 0.05;
export const REFINE_RATIO = 0.25;
/** Crew Uplink: income per level per other online crewmate. */
export const UPLINK_STEP = 0.03;
/** Night Beacon, per level. */
export const BEACON_HOURS = 1;
export const BEACON_EFF = 0.025;

/**
 * Foreman, by level: which upgrades it buys (those whose `auto` is at most
 * the level) and the most of your wallet one level may cost. It runs while
 * you are online and buys the cheapest eligible level first, so it never
 * eats the savings you are building for the Forge Tree.
 */
export const FOREMAN_SHARE = [0, 0.1, 0.2, 0.35] as const;
/** At most this many auto-buys per player per tick. */
export const FOREMAN_PER_TICK = 25;

/* ---------------- crew roles ---------------- */

export type RoleId = 'prospector' | 'engineer' | 'refiner';

export interface RoleDef {
  id: RoleId;
  name: string;
  icon: string;
  /** What the role does for you. */
  desc: string;
  /** What having one on the crew does for everyone else. */
  aura: string;
}

/**
 * Optional specialisations (Crew Charter node). Everyone can still do
 * everything; a role doubles one part of your game and gives every other
 * online crewmate a smaller boost to that part, so a crew of mixed roles
 * multitasks better than four copies of one.
 */
export const ROLES: Record<RoleId, RoleDef> = {
  prospector: {
    id: 'prospector',
    name: 'Prospector',
    icon: '⛏️',
    desc: 'Your taps and Auto-Rigs mine ×2, and your taps chip an extra 1 HP off seams.',
    aura: 'Crewmates’ taps +15%.',
  },
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    icon: '🛰️',
    desc: 'Your drones and harvesters mine ×2, and you earn 25% more while away.',
    aura: 'Crewmates’ drones and harvesters +15%.',
  },
  refiner: {
    id: 'refiner',
    name: 'Refiner',
    icon: '🔥',
    desc: 'Your Smelters and Refinery make ×2 alloy, and ore and alloy you put into the Forge Tree count ×1.25.',
    aura: 'Crewmates make +15% alloy.',
  },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];
export const ROLE_MULT = 2;
export const ROLE_AURA = 0.15;
export const ROLE_OFFLINE_BONUS = 0.25;
export const REFINER_FUND_BONUS = 1.25;
/** After picking a role, you can change it again after this long. */
export const ROLE_SWITCH_MS = 120_000;

/* ---------------- crew contracts and renown ---------------- */

export type ContractKind = 'seams' | 'crits' | 'ore' | 'fund' | 'comets' | 'streak';

export interface ContractDef {
  kind: ContractKind;
  icon: string;
  /** "Break 20 seams" */
  label: (goal: string) => string;
}

export const CONTRACTS: Record<ContractKind, ContractDef> = {
  seams: { kind: 'seams', icon: '💎', label: (g) => `Break ${g} glowing seams` },
  crits: { kind: 'crits', icon: '✴️', label: (g) => `Land ${g} critical taps` },
  ore: { kind: 'ore', icon: '⛏️', label: (g) => `Mine ${g} ore together` },
  fund: { kind: 'fund', icon: '🌳', label: (g) => `Put ${g} ore into the Forge Tree` },
  comets: { kind: 'comets', icon: '☄️', label: (g) => `Catch ${g} comets` },
  streak: { kind: 'streak', icon: '👊', label: (g) => `Anyone reaches a ${g}-tap streak` },
};

export const CONTRACT_KINDS = Object.keys(CONTRACTS) as ContractKind[];
/** Contracts start once the Forge Core is unlocked. */
export const CONTRACT_FIRST_MS = 60_000;
export const CONTRACT_MS = 8 * 60_000;
export const CONTRACT_GAP_MS = 90_000;
/** Each online crewmate past the first adds this much to a goal (so a crew of four needs ×2.8, not ×4). */
export const CONTRACT_CREW_SCALE = 0.6;
/** Each contract finished makes later ones this much bigger, up to CONTRACT_GROWTH_CAP contracts. */
export const CONTRACT_GROWTH = 0.04;
export const CONTRACT_GROWTH_CAP = 50;
/** Taps per second assumed when sizing ore goals and rewards. */
export const CONTRACT_TAPS = 2;
/** A finished contract pays every online crewmate this many seconds of their income. */
export const CONTRACT_REWARD_S = 120;
/** Each point of renown is +1% income for everyone in the world (+2% with Guild Hall). */
export const RENOWN_BONUS = 0.01;
export const RENOWN_BONUS_GUILD = 0.02;

/** How big a contract is, for `online` crewmates who have finished `done` contracts and earn `income` ore/s each on average. */
export function contractGoal(kind: ContractKind, done: number, online: number, income: number): number {
  const crew = 1 + CONTRACT_CREW_SCALE * Math.max(0, online - 1);
  const grow = 1 + CONTRACT_GROWTH * Math.min(done, CONTRACT_GROWTH_CAP);
  switch (kind) {
    case 'seams':
      return Math.ceil(12 * crew * grow);
    case 'crits':
      return Math.ceil(30 * crew * grow);
    case 'ore':
      return Math.max(1000, Math.ceil(200 * income * crew * grow));
    case 'fund':
      return Math.max(500, Math.ceil(90 * income * crew * grow));
    case 'comets':
      return 2;
    case 'streak':
      return 40 + 2 * Math.min(done, 30);
  }
}

/* ---------------- the Forge Tree ---------------- */

export type NodeId =
  | 'core'
  | 'autorig'
  | 'swarm'
  | 'charter'
  | 'optics'
  | 'smelting'
  | 'foreman'
  | 'teamlink'
  | 'deepscan'
  | 'hotsmelt'
  | 'overclock'
  | 'guild'
  | 'motherlode'
  | 'plating'
  | 'harvesters'
  | 'lure'
  | 'overdrive'
  | 'nightshift'
  | 'leap'
  | 'refit'
  | 'resonance'
  | 'memory'
  | 'starseed'
  | 'hyperdrill'
  | 'dyson'
  | 'echo'
  | 'corelens'
  | 'hivemind'
  | 'singularity'
  | 'mastery';

export interface NodeDef {
  id: NodeId;
  name: string;
  icon: string;
  desc: string;
  /** Row from the top (0 is the root) and horizontal slot (-1.5..1.5) for drawing. */
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
 * (Quantum Leaps keep it). Columns run by theme: alloy on the left, drones
 * and automation, crew, then taps and seams on the right.
 */
export const NODES: Record<NodeId, NodeDef> = {
  core: { id: 'core', name: 'Forge Core', icon: '✦', desc: 'Everyone mines ×1.5 ore, and crew contracts start.', tier: 0, x: 0, cost: { ore: 5_000 }, needs: [] },

  autorig: { id: 'autorig', name: 'Auto-Rigs', icon: '⚙️', desc: 'Unlocks Auto-Rigs: they tap seams for you.', tier: 1, x: -1.5, cost: { ore: 300_000 }, needs: ['core'] },
  swarm: { id: 'swarm', name: 'Swarm Logic', icon: '🛰️', desc: 'Everyone’s drones produce ×3.', tier: 1, x: -0.5, cost: { ore: 500_000 }, needs: ['core'] },
  charter: { id: 'charter', name: 'Crew Charter', icon: '📜', desc: 'Unlocks crew roles: Prospector, Engineer or Refiner. Each doubles one part of your game and boosts your crewmates’.', tier: 1, x: 0.5, cost: { ore: 800_000 }, needs: ['core'] },
  optics: { id: 'optics', name: 'Fine Optics', icon: '🔍', desc: 'Critical taps pay ×10 instead of ×5, and Chain Reactors unlock.', tier: 1, x: 1.5, cost: { ore: 1.2e6 }, needs: ['core'] },

  smelting: { id: 'smelting', name: 'Smelting', icon: '🔥', desc: 'Unlocks Smelters and the Refinery, which make alloy.', tier: 2, x: -1.5, cost: { ore: 15e6 }, needs: ['autorig'] },
  foreman: { id: 'foreman', name: 'Foreman Protocol', icon: '🤖', desc: 'Unlocks the Foreman, who auto-buys your upgrades.', tier: 2, x: -0.5, cost: { ore: 25e6 }, needs: ['autorig', 'swarm'] },
  teamlink: { id: 'teamlink', name: 'Crew Link', icon: '🤝', desc: 'All income +20%, plus +20% for each crewmate online with you. Unlocks Crew Uplink.', tier: 2, x: 0.5, cost: { ore: 40e6 }, needs: ['swarm', 'charter'] },
  deepscan: { id: 'deepscan', name: 'Deep Scan', icon: '📡', desc: 'Seams pay ×6 instead of ×3, two more seams appear, and Seam Scanners unlock.', tier: 2, x: 1.5, cost: { ore: 60e6 }, needs: ['optics'] },

  hotsmelt: { id: 'hotsmelt', name: 'Hot Smelting', icon: '♨️', desc: 'Smelters and Refineries make twice as much alloy.', tier: 3, x: -1.5, cost: { ore: 450e6, alloy: 60e6 }, needs: ['smelting'] },
  overclock: { id: 'overclock', name: 'Drone Overclock', icon: '🔋', desc: 'Everyone’s drones and harvesters mine ×3.', tier: 3, x: -0.5, cost: { ore: 700e6, alloy: 90e6 }, needs: ['foreman', 'smelting'] },
  guild: { id: 'guild', name: 'Guild Hall', icon: '🏛️', desc: 'Contracts pay twice as much, and each point of renown is worth +2% instead of +1%.', tier: 3, x: 0.5, cost: { ore: 900e6, alloy: 120e6 }, needs: ['teamlink'] },
  motherlode: { id: 'motherlode', name: 'Motherlode', icon: '💎', desc: 'Breaking a seam pays ×10 instead of ×5.', tier: 3, x: 1.5, cost: { ore: 1.2e9, alloy: 150e6 }, needs: ['deepscan'] },

  plating: { id: 'plating', name: 'Alloy Plating', icon: '🛡️', desc: 'Unlocks Alloy Plating for drones and harvesters.', tier: 4, x: -1.5, cost: { ore: 4e9, alloy: 600e6 }, needs: ['hotsmelt'] },
  harvesters: { id: 'harvesters', name: 'Harvester Fleet', icon: '🚀', desc: 'Unlocks Harvesters: big ships that mine 250 ore/s each.', tier: 4, x: -0.5, cost: { ore: 6e9, alloy: 900e6 }, needs: ['overclock'] },
  lure: { id: 'lure', name: 'Comet Lure', icon: '🧲', desc: 'Comets come twice as often and pay twice as much.', tier: 4, x: 0.5, cost: { ore: 8e9, alloy: 1.2e9 }, needs: ['guild'] },
  overdrive: { id: 'overdrive', name: 'Overdrive', icon: '⚡', desc: 'Taps and Auto-Rigs mine ×4.', tier: 4, x: 1.5, cost: { ore: 12e9, alloy: 1.8e9 }, needs: ['motherlode'] },

  nightshift: { id: 'nightshift', name: 'Night Shift', icon: '🌙', desc: 'Earn 75% instead of 25% while away, for up to 12 hours.', tier: 5, x: -1.5, cost: { ore: 150e9, alloy: 25e9 }, needs: ['plating'] },
  leap: { id: 'leap', name: 'Quantum Leap', icon: '🌀', desc: 'Lets each of you leap: restart your own run for Star Cores.', tier: 5, x: -0.5, cost: { ore: 100e9, alloy: 15e9 }, needs: ['harvesters', 'hotsmelt'] },
  refit: { id: 'refit', name: 'Deep Refit', icon: '🔧', desc: 'All income ×1.25 per level. Each level costs ×8.', tier: 5, x: 0.5, cost: { ore: 250e9, alloy: 40e9 }, needs: ['harvesters', 'lure'], repeat: 8 },
  resonance: { id: 'resonance', name: 'Resonance', icon: '〰️', desc: 'Breaking a seam gives the whole crew ×2 ore for 15 s.', tier: 5, x: 1.5, cost: { ore: 400e9, alloy: 60e9 }, needs: ['overdrive', 'lure'] },

  memory: { id: 'memory', name: 'Stellar Memory', icon: '🧠', desc: 'Start every run with 25 Drill and 25 Drone levels.', tier: 6, x: -1.5, cost: { cores: 3 }, needs: ['leap'] },
  starseed: { id: 'starseed', name: 'Starseed', icon: '🌱', desc: 'Each Star Core you hold gives +20% instead of +10%.', tier: 6, x: -0.5, cost: { cores: 8 }, needs: ['leap'] },
  hyperdrill: { id: 'hyperdrill', name: 'Hyperdrill', icon: '💥', desc: 'Taps and Auto-Rigs mine ×10.', tier: 6, x: 0.5, cost: { cores: 15 }, needs: ['leap'] },
  dyson: { id: 'dyson', name: 'Dyson Swarm', icon: '☀️', desc: 'Drones and Harvesters mine ×10.', tier: 6, x: 1.5, cost: { cores: 25 }, needs: ['leap'] },

  echo: { id: 'echo', name: 'Quantum Echo', icon: '🔁', desc: 'Leaps keep every upgrade that has a max level (Lens, Rigs, Smelters, Foreman…).', tier: 7, x: -1, cost: { cores: 40 }, needs: ['memory', 'starseed'] },
  corelens: { id: 'corelens', name: 'Core Lens', icon: '🔆', desc: 'Leaps pay ×1.5 Star Cores.', tier: 7, x: 0, cost: { cores: 60 }, needs: ['starseed', 'hyperdrill'] },
  hivemind: { id: 'hivemind', name: 'Hive Mind', icon: '🐝', desc: 'Crew Link pays +35% per crewmate instead of +20%, and role boosts to crewmates double.', tier: 7, x: 1, cost: { cores: 80 }, needs: ['hyperdrill', 'dyson'] },

  singularity: { id: 'singularity', name: 'Singularity Forge', icon: '🕳️', desc: 'All income ×3.', tier: 8, x: 0, cost: { cores: 150, ore: 5e16 }, needs: ['echo', 'corelens', 'hivemind'] },
  mastery: { id: 'mastery', name: 'Forge Mastery', icon: '👑', desc: 'All income ×1.5 per level. Each level costs ×10.', tier: 9, x: 0, cost: { cores: 100, ore: 5e17 }, needs: ['singularity'], repeat: 10 },
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
export const BREAK_MULT_MOTHERLODE = 10;
export const DRONE_RATE = 5;
export const HARVESTER_RATE = 250;
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
export const LEAP_MIN_ORE = 1e11;
/** Core Lens multiplies leap rewards by this. */
export const CORE_LENS_MULT = 1.5;
/** Stellar Memory starts every run with this many Drill and Drone levels. */
export const MEMORY_LEVELS = 25;

/**
 * Star Cores for leaping after mining `ore` this run. Grows with the cube
 * root, so ten times the ore pays a bit over twice the cores. `mult` is
 * Core Lens.
 */
export function coresFor(ore: number, mult = 1): number {
  return ore < LEAP_MIN_ORE ? 0 : Math.floor(3 * mult * Math.cbrt(ore / LEAP_MIN_ORE) + 1e-9);
}

/** Ore a run needs for its leap to pay `cores` Star Cores. */
export function oreForCores(cores: number, mult = 1): number {
  return Math.max(LEAP_MIN_ORE, LEAP_MIN_ORE * Math.pow(cores / (3 * mult), 3));
}

/* ---------------- offline ---------------- */

export const OFFLINE_EFF = 0.25;
export const OFFLINE_EFF_NIGHT = 0.75;
export const OFFLINE_CAP_S = 8 * 3600;
export const OFFLINE_CAP_NIGHT_S = 12 * 3600;
