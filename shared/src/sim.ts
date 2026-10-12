import { randomUnit, rng, type Vec3 } from './asteroid.js';
import {
  BASE_CRIT,
  BEACON_EFF,
  BEACON_HOURS,
  BREAK_MULT,
  BREAK_MULT_MOTHERLODE,
  CHAIN_CAP,
  CHAIN_STEP,
  COMBO_CAP,
  COMBO_STEP,
  COMBO_WINDOW_MS,
  COMET_GAP_MAX_MS,
  COMET_GAP_MIN_MS,
  COMET_MS,
  COMET_SECONDS,
  COMET_TAPS,
  CONTRACTS,
  CONTRACT_FIRST_MS,
  CONTRACT_GAP_MS,
  CONTRACT_KINDS,
  CONTRACT_MS,
  CONTRACT_REWARD_S,
  CONTRACT_TAPS,
  CORE_BONUS,
  CORE_BONUS_STARSEED,
  CORE_LENS_MULT,
  CRIT_MULT,
  CRIT_MULT_OPTICS,
  DRONE_RATE,
  FOREMAN_PER_TICK,
  FOREMAN_SHARE,
  HARVESTER_RATE,
  MEMORY_LEVELS,
  NODES,
  NODE_IDS,
  OFFLINE_CAP_NIGHT_S,
  OFFLINE_CAP_S,
  OFFLINE_EFF,
  OFFLINE_EFF_NIGHT,
  REFINER_FUND_BONUS,
  REFINE_PER_LEVEL,
  REFINE_RATIO,
  RENOWN_BONUS,
  RENOWN_BONUS_GUILD,
  RIG_RATE,
  RIG_SHARE,
  ROLES,
  ROLE_AURA,
  ROLE_MULT,
  ROLE_OFFLINE_BONUS,
  ROLE_SWITCH_MS,
  SEAM_MULT,
  SEAM_MULT_DEEP,
  SMELT_PER_LEVEL,
  SURGE_CAP_MS,
  SURGE_MS,
  UPGRADES,
  UPGRADE_IDS,
  UPLINK_STEP,
  contractGoal,
  coresFor,
  emptyLevels,
  milestoneMult,
  nodeCost,
  upgradeCost,
  type ContractKind,
  type NodeId,
  type RoleId,
  type UpgradeId,
  type UpgradeLevels,
} from './economy.js';
import { RESOURCES, emptyWallet, type ResourceId, type Wallet } from './resources.js';

/**
 * The authoritative simulation. Pure functions over plain JSON data: a
 * hosting player's browser and the optional dedicated server both run them,
 * so there is exactly one implementation of every rule. Randomness is passed
 * in, so the host owns every roll.
 *
 * Everyone plays the same game: tap the asteroid, buy your own upgrades, and
 * pour ore, alloy and Star Cores into the Forge Tree the whole crew shares.
 * Optional roles let a crew split the work; contracts give it shared goals.
 */

export type Rand = () => number;

export interface Seam {
  id: number;
  dir: Vec3;
  hp: number;
  maxHp: number;
}

export interface PlayerState {
  id: string;
  /** Stable per browser, so a player gets their own progress back when they return. */
  key: string;
  name: string;
  /** Hue (0-360) for this player's ship, laser and name tag. */
  hue: number;
  online: boolean;
  wallet: Wallet;
  levels: UpgradeLevels;
  /** Mined since this player's last Quantum Leap. */
  run: { ore: number; alloy: number; startedAt: number };
  /** Smoothed income per second, for the HUD. */
  rates: { ore: number; alloy: number };
  stats: { ore: number; taps: number; leaps: number; cores: number; funded: number; contracts: number; bestStreak: number };
  lastStrikeAt: number;
  /** Last time this player was online, for offline earnings. */
  seenAt: number;
  rigAcc: number;
  /** Crew role (needs Crew Charter), or null. */
  role: RoleId | null;
  /** When the role last changed (0: never), for the switch cooldown. */
  roleAt: number;
  /** Foreman auto-buy on (it does nothing until you own a Foreman). */
  auto: boolean;
  /** Refinery on (it does nothing until you own one). */
  refine: boolean;
  /** Taps in a row, each within COMBO_WINDOW_MS of the last. */
  streak: number;
  /** Crits in a row. */
  chain: number;
}

export interface NodeState {
  level: number;
  /** Paid so far toward the next level. */
  funded: Partial<Wallet>;
  /** Share of the node's price each player paid, 0..1, for the credits. */
  by: Record<string, number>;
}

/** A comet streaking past. Clients choose where to draw it; catching it pays the whole crew. */
export interface Comet {
  id: number;
  at: number;
  until: number;
  seed: number;
}

/** A shared crew goal. Finishing it pays everyone online and adds a point of renown. */
export interface Contract {
  id: number;
  kind: ContractKind;
  goal: number;
  progress: number;
  at: number;
  until: number;
  /** What each player added, for the credits. */
  by: Record<string, number>;
}

export interface RoomState {
  v: 3;
  seed: number;
  tick: number;
  now: number;
  createdAt: number;
  players: Record<string, PlayerState>;
  tree: Partial<Record<NodeId, NodeState>>;
  seams: Seam[];
  nextSeamId: number;
  surgeUntil: number;
  comet: Comet | null;
  nextCometAt: number;
  nextCometId: number;
  contract: Contract | null;
  nextContractAt: number;
  nextContractId: number;
  contractsDone: number;
  /** World-wide prestige from contracts: every point is +1% income for everyone here (+2% with Guild Hall). Leaps keep it. */
  renown: number;
}

export const SEAM_HP = 8;
export const MIN_STRIKE_INTERVAL_MS = 50;
/** Saved crewmates beyond this many are forgotten, longest-absent first. */
export const MAX_SAVED_PLAYERS = 16;

const HUES = [32, 190, 280, 120, 340, 60];

export function createRoomState(seed: number, now = Date.now()): RoomState {
  const s: RoomState = {
    v: 3,
    seed,
    tick: 0,
    now,
    createdAt: now,
    players: {},
    tree: {},
    seams: [],
    nextSeamId: 1,
    surgeUntil: 0,
    comet: null,
    nextCometAt: now + 45_000,
    nextCometId: 1,
    contract: null,
    nextContractAt: 0,
    nextContractId: 1,
    contractsDone: 0,
    renown: 0,
  };
  refillSeams(s);
  return s;
}

/* ---------------- tree queries ---------------- */

export const nodeLevel = (s: RoomState, id: NodeId): number => s.tree[id]?.level ?? 0;
export const has = (s: RoomState, id: NodeId): boolean => nodeLevel(s, id) > 0;

/** Every prerequisite is unlocked. */
export const nodeOpen = (s: RoomState, id: NodeId): boolean => NODES[id].needs.every((n) => has(s, n));

/** Open and not already bought (repeatable nodes never finish). */
export const nodeFundable = (s: RoomState, id: NodeId): boolean => nodeOpen(s, id) && (!!NODES[id].repeat || !has(s, id));

export const upgradeUnlocked = (s: RoomState, id: UpgradeId): boolean => {
  const n = UPGRADES[id].needs;
  return !n || has(s, n);
};

/* ---------------- formulas ---------------- */

export const onlinePlayers = (s: RoomState): PlayerState[] => Object.values(s.players).filter((p) => p.online);
const onlineCount = (s: RoomState): number => Math.max(1, onlinePlayers(s).length);

/**
 * Crew bonus on all income. Without Crew Link: +5% per crewmate online with
 * you. Crew Link: +20%, plus +20% per crewmate (+35% with Hive Mind), so a
 * full crew of four mines ×1.8 (×2.25).
 */
export function crewMult(s: RoomState, online = onlineCount(s)): number {
  const mates = Math.max(0, online - 1);
  if (!has(s, 'teamlink')) return 1 + 0.05 * mates;
  return 1.2 + (has(s, 'hivemind') ? 0.35 : 0.2) * mates;
}

/** The role a player has active (roles need Crew Charter). */
export const roleOf = (s: RoomState, p: PlayerState): RoleId | null => (p.role && has(s, 'charter') && ROLES[p.role] ? p.role : null);

/**
 * A role's multiplier for `p`: ×2 if it is theirs, and +15% (+30% with Hive
 * Mind) for each other online crewmate who has it. `online` = 1 means "as if
 * alone" (offline earnings).
 */
export function roleMult(s: RoomState, p: PlayerState, role: RoleId, online?: number): number {
  if (!has(s, 'charter')) return 1;
  let m = p.role === role ? ROLE_MULT : 1;
  if (online !== 1) {
    let mates = 0;
    for (const q of Object.values(s.players)) if (q.online && q.id !== p.id && q.role === role) mates++;
    if (mates) m *= 1 + ROLE_AURA * (has(s, 'hivemind') ? 2 : 1) * mates;
  }
  return m;
}

export function coreMult(s: RoomState, p: PlayerState): number {
  return 1 + (has(s, 'starseed') ? CORE_BONUS_STARSEED : CORE_BONUS) * p.wallet.cores;
}

export const renownMult = (s: RoomState): number => 1 + (has(s, 'guild') ? RENOWN_BONUS_GUILD : RENOWN_BONUS) * (s.renown || 0);

export const uplinkMult = (s: RoomState, p: PlayerState, online = onlineCount(s)): number => 1 + UPLINK_STEP * p.levels.uplink * Math.max(0, online - 1);

export const surgeOn = (s: RoomState, now = s.now): boolean => s.surgeUntil > now;

/** Multiplier on every bit of ore a player earns. */
export function allMult(s: RoomState, p: PlayerState, online = onlineCount(s), surge = surgeOn(s)): number {
  return (
    (has(s, 'core') ? 1.5 : 1) *
    crewMult(s, online) *
    uplinkMult(s, p, online) *
    coreMult(s, p) *
    renownMult(s) *
    (has(s, 'singularity') ? 3 : 1) *
    Math.pow(1.25, nodeLevel(s, 'refit')) *
    Math.pow(1.5, nodeLevel(s, 'mastery')) *
    (surge ? 2 : 1)
  );
}

/** Ore for one plain tap (before streak, crit and seam bonuses). */
export function tapValue(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  const d = p.levels.drill;
  return (
    (1 + d) *
    milestoneMult(d) *
    (has(s, 'overdrive') ? 4 : 1) *
    (has(s, 'hyperdrill') ? 10 : 1) *
    roleMult(s, p, 'prospector', online) *
    allMult(s, p, online, surge)
  );
}

export const critChance = (p: PlayerState): number => BASE_CRIT + 0.01 * p.levels.lens;
export const critMult = (s: RoomState): number => (has(s, 'optics') ? CRIT_MULT_OPTICS : CRIT_MULT);
/** Chain Reactor bonus on a crit that follows `chain` crits in a row. */
export const chainMult = (p: PlayerState, chain = p.chain): number => 1 + CHAIN_STEP * p.levels.chain * Math.min(chain, CHAIN_CAP);
/** Combo Coil bonus at the given streak. */
export const comboMult = (p: PlayerState, streak = p.streak): number => 1 + COMBO_STEP * p.levels.combo * (Math.min(streak, COMBO_CAP) / COMBO_CAP);
const baseSeamMult = (s: RoomState): number => (has(s, 'deepscan') ? SEAM_MULT_DEEP : SEAM_MULT);
export const seamMult = (s: RoomState, p: PlayerState): number => baseSeamMult(s) * (1 + 0.25 * p.levels.scanner);
export const breakMult = (s: RoomState): number => (has(s, 'motherlode') ? BREAK_MULT_MOTHERLODE : BREAK_MULT);
export const seamTarget = (s: RoomState): number => (has(s, 'deepscan') ? 7 : 5);

const fleetMult = (s: RoomState, p: PlayerState, online?: number): number =>
  (1 + 0.25 * p.levels.plating) * (has(s, 'overclock') ? 3 : 1) * (has(s, 'dyson') ? 10 : 1) * roleMult(s, p, 'engineer', online);

export function droneRate(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  const n = p.levels.drone;
  return n * DRONE_RATE * milestoneMult(n) * (has(s, 'swarm') ? 3 : 1) * fleetMult(s, p, online) * allMult(s, p, online, surge);
}

export function harvesterRate(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  const n = p.levels.harvester;
  return n * HARVESTER_RATE * milestoneMult(n) * fleetMult(s, p, online) * allMult(s, p, online, surge);
}

/** Expected ore per second from Auto-Rigs (ignoring crits and breaks). */
export function rigRate(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  return p.levels.rig * RIG_RATE * RIG_SHARE * tapValue(s, p, online, surge) * baseSeamMult(s);
}

/** Gross passive ore per second, before the Refinery takes its share. */
export function passiveOrePerSec(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  return droneRate(s, p, online, surge) + harvesterRate(s, p, online, surge) + rigRate(s, p, online, surge);
}

/** Alloy multiplier for Smelters and the Refinery (Hot Smelting, Refiner role). */
const alloyMult = (s: RoomState, p: PlayerState, online?: number): number => (has(s, 'hotsmelt') ? 2 : 1) * roleMult(s, p, 'refiner', online);

/** Share of mined ore a player's Smelters also turn into alloy. */
export const smeltShare = (s: RoomState, p: PlayerState, online?: number): number => p.levels.smelter * SMELT_PER_LEVEL * alloyMult(s, p, online);

/** Share of passive ore the Refinery takes (0 when off). */
export const refineShare = (p: PlayerState): number => (p.refine ? Math.min(1, p.levels.refinery * REFINE_PER_LEVEL) : 0);

/** Alloy per second the Refinery makes from passive ore. */
export const refineRate = (s: RoomState, p: PlayerState, online?: number): number =>
  passiveOrePerSec(s, p, online) * refineShare(p) * REFINE_RATIO * alloyMult(s, p, online);

/** Ore + taps a player is assumed to make each second, for sizing contracts and their rewards. */
export const contractIncome = (s: RoomState, p: PlayerState): number => passiveOrePerSec(s, p) + CONTRACT_TAPS * tapValue(s, p);

/** How much a contribution to the Forge Tree counts for (Refiners: ×1.25 for ore and alloy). */
export const fundBonus = (s: RoomState, p: PlayerState, res: ResourceId): number =>
  res !== 'cores' && roleOf(s, p) === 'refiner' ? REFINER_FUND_BONUS : 1;

export const leapMult = (s: RoomState): number => (has(s, 'corelens') ? CORE_LENS_MULT : 1);
export const leapCores = (p: PlayerState, s?: RoomState): number => coresFor(p.run.ore, s ? leapMult(s) : 1);
export const canLeap = (s: RoomState, p: PlayerState): boolean => has(s, 'leap') && leapCores(p, s) > 0;

export const offlineCapS = (s: RoomState, p: PlayerState): number =>
  (has(s, 'nightshift') ? OFFLINE_CAP_NIGHT_S : OFFLINE_CAP_S) + BEACON_HOURS * 3600 * p.levels.beacon;
export const offlineEff = (s: RoomState, p: PlayerState): number =>
  Math.min(1, (has(s, 'nightshift') ? OFFLINE_EFF_NIGHT : OFFLINE_EFF) + BEACON_EFF * p.levels.beacon) * (roleOf(s, p) === 'engineer' ? 1 + ROLE_OFFLINE_BONUS : 1);

/** Can this player change role now? */
export const roleReadyAt = (p: PlayerState): number => (p.roleAt ? p.roleAt + ROLE_SWITCH_MS : 0);

/* ---------------- players ---------------- */

export function freshPlayer(id: string, key: string, name: string, hue: number, now: number): PlayerState {
  return {
    id,
    key,
    name,
    hue,
    online: true,
    wallet: emptyWallet(),
    levels: emptyLevels(),
    run: { ore: 0, alloy: 0, startedAt: now },
    rates: { ore: 0, alloy: 0 },
    stats: { ore: 0, taps: 0, leaps: 0, cores: 0, funded: 0, contracts: 0, bestStreak: 0 },
    lastStrikeAt: 0,
    seenAt: now,
    rigAcc: 0,
    role: null,
    roleAt: 0,
    auto: true,
    refine: true,
    streak: 0,
    chain: 0,
  };
}

export interface OfflineGain {
  seconds: number;
  gained: Wallet;
}

/** Bring a player in: a returning key gets their progress back plus offline earnings. */
export function addPlayer(
  s: RoomState,
  id: string,
  key: string,
  name: string,
  now: number,
): { player: PlayerState; offline: OfflineGain | null } {
  const clean = (name || 'Prospector').slice(0, 16);
  const back = Object.values(s.players).find((p) => p.key === key);
  if (back) {
    const offline = back.online ? null : applyOffline(s, back, now - back.seenAt);
    back.online = true;
    back.name = clean;
    back.seenAt = now;
    return { player: back, offline: offline && offline.seconds >= 60 ? offline : null };
  }
  const used = new Set(onlinePlayers(s).map((p) => p.hue));
  const hue = HUES.find((h) => !used.has(h)) ?? Math.floor(Math.random() * 360);
  const p = freshPlayer(id, key, clean, hue, now);
  s.players[id] = p;
  // Forget the longest-absent crewmates once the roster is full.
  const saved = Object.values(s.players);
  if (saved.length > MAX_SAVED_PLAYERS) {
    const gone = saved.filter((x) => !x.online).sort((a, b) => a.seenAt - b.seenAt);
    for (const x of gone.slice(0, saved.length - MAX_SAVED_PLAYERS)) delete s.players[x.id];
  }
  return { player: p, offline: null };
}

export function dropPlayer(s: RoomState, id: string, now: number): void {
  const p = s.players[id];
  if (!p) return;
  p.online = false;
  p.seenAt = now;
  p.streak = 0;
  p.chain = 0;
}

/** Offline earnings: drones, harvesters and rigs at the offline rate, capped. */
export function applyOffline(s: RoomState, p: PlayerState, awayMs: number): OfflineGain {
  const seconds = Math.min(Math.max(0, awayMs / 1000), offlineCapS(s, p));
  const ore = passiveOrePerSec(s, p, 1, false) * seconds * offlineEff(s, p);
  const before = { ...p.wallet };
  earn(s, p, ore, { passive: true, live: false, online: 1 });
  const gained = emptyWallet();
  for (const r of RESOURCES) gained[r] = p.wallet[r] - before[r];
  return { seconds, gained };
}

/**
 * Pay a player `ore` they mined. Smelters take their alloy share of all of
 * it; on passive income the Refinery also turns its share into alloy. Live
 * earnings count toward the crew's contract.
 */
function earn(s: RoomState, p: PlayerState, ore: number, o: { passive?: boolean; live?: boolean; online?: number } = {}): void {
  if (!(ore > 0)) return;
  let alloy = ore * smeltShare(s, p, o.online);
  let kept = ore;
  if (o.passive) {
    const share = refineShare(p);
    if (share > 0) {
      kept = ore * (1 - share);
      alloy += ore * share * REFINE_RATIO * alloyMult(s, p, o.online);
    }
  }
  p.wallet.ore += kept;
  p.run.ore += ore;
  p.stats.ore += ore;
  if (alloy > 0) {
    p.wallet.alloy += alloy;
    p.run.alloy += alloy;
  }
  if (o.live !== false) contractAdd(s, p.id, 'ore', ore);
}

/* ---------------- seams ---------------- */

function spawnSeam(s: RoomState): Seam {
  const r = rng((s.seed ^ (s.nextSeamId * 2654435761)) >>> 0);
  const seam = { id: s.nextSeamId++, dir: randomUnit(r), hp: SEAM_HP, maxHp: SEAM_HP };
  s.seams.push(seam);
  return seam;
}
function refillSeams(s: RoomState): void {
  while (s.seams.length < seamTarget(s)) spawnSeam(s);
}

/** Damage a seam; returns the replacement when it breaks. */
function hitSeam(s: RoomState, seam: Seam, dmg: number, now: number, by: string): Seam | null {
  seam.hp -= dmg;
  if (seam.hp > 0) return null;
  s.seams = s.seams.filter((x) => x !== seam);
  if (has(s, 'resonance')) s.surgeUntil = Math.min(Math.max(s.surgeUntil, now) + SURGE_MS, now + SURGE_CAP_MS);
  contractAdd(s, by, 'seams', 1);
  return spawnSeam(s);
}

/* ---------------- contracts ---------------- */

/** Add to the running contract if it is of this kind ('streak' keeps the best). */
function contractAdd(s: RoomState, playerId: string, kind: ContractKind, n: number): void {
  const c = s.contract;
  if (!c || c.kind !== kind || !(n > 0) || c.progress >= c.goal) return;
  if (kind === 'streak') {
    if (n > c.progress) c.progress = n;
    c.by[playerId] = Math.max(c.by[playerId] ?? 0, n);
  } else {
    c.progress += n;
    c.by[playerId] = (c.by[playerId] ?? 0) + n;
  }
}

/** Start a new contract sized for the crew online now. */
export function startContract(s: RoomState, now: number, roll: number): Contract {
  const online = onlinePlayers(s);
  const kinds = CONTRACT_KINDS.filter((k) => k !== 'fund' || openOreNode(s));
  const kind = kinds[Math.min(kinds.length - 1, Math.floor(roll * kinds.length))];
  const income = online.length ? online.reduce((a, q) => a + contractIncome(s, q), 0) / online.length : 1;
  s.contract = {
    id: s.nextContractId++,
    kind,
    goal: contractGoal(kind, s.contractsDone, online.length, income),
    progress: 0,
    at: now,
    until: now + CONTRACT_MS,
    by: {},
  };
  return s.contract;
}

const openOreNode = (s: RoomState): boolean => NODE_IDS.some((id) => nodeFundable(s, id) && !!NODES[id].cost.ore);

/** What a finished contract pays each online crewmate. */
export function contractReward(s: RoomState, p: PlayerState): number {
  return CONTRACT_REWARD_S * contractIncome(s, p) * (has(s, 'guild') ? 2 : 1);
}

export interface ContractOutcome {
  id: number;
  kind: ContractKind;
  /** Ore each online crewmate received. */
  rewards: Record<string, number>;
  renown: number;
}

function finishContract(s: RoomState, now: number): ContractOutcome {
  const c = s.contract!;
  const rewards: Record<string, number> = {};
  for (const q of onlinePlayers(s)) {
    const r = contractReward(s, q);
    earn(s, q, r, { live: false });
    rewards[q.id] = r;
    q.stats.contracts = (q.stats.contracts ?? 0) + 1;
  }
  s.renown = (s.renown || 0) + 1;
  s.contractsDone++;
  s.contract = null;
  s.nextContractAt = now + CONTRACT_GAP_MS;
  return { id: c.id, kind: c.kind, rewards, renown: s.renown };
}

/* ---------------- actions ---------------- */

export type Reject = 'unknown-player' | 'rate-limited' | 'locked' | 'maxed' | 'too-poor' | 'gone' | 'not-ready' | 'cooldown';

export interface StrikeOutcome {
  playerId: string;
  amount: number;
  crit: boolean;
  seamId: number | null;
  broke: boolean;
  newSeam: Seam | null;
  surge: boolean;
  /** Taps in a row, and crits in a row, after this one. */
  streak: number;
  chain: number;
}

export function applyStrike(s: RoomState, playerId: string, seamId: number | null, now: number, roll: number): StrikeOutcome | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (now - p.lastStrikeAt < MIN_STRIKE_INTERVAL_MS) return 'rate-limited';
  p.streak = now - p.lastStrikeAt <= COMBO_WINDOW_MS ? (p.streak || 0) + 1 : 1;
  p.lastStrikeAt = now;
  p.stats.taps++;
  if (p.streak > (p.stats.bestStreak ?? 0)) p.stats.bestStreak = p.streak;
  contractAdd(s, playerId, 'streak', p.streak);
  const crit = roll < critChance(p);
  const seam = seamId == null ? undefined : s.seams.find((x) => x.id === seamId);
  const wasSurge = surgeOn(s, now);
  let amount = tapValue(s, p, undefined, wasSurge) * comboMult(p);
  if (crit) {
    amount *= critMult(s) * chainMult(p);
    p.chain = (p.chain || 0) + 1;
    contractAdd(s, playerId, 'crits', 1);
  } else p.chain = 0;
  let newSeam: Seam | null = null;
  if (seam) {
    amount *= seamMult(s, p);
    const dmg = (crit ? 2 : 1) + (roleOf(s, p) === 'prospector' ? 1 : 0);
    newSeam = hitSeam(s, seam, dmg, now, playerId);
    if (newSeam) amount *= breakMult(s);
  }
  earn(s, p, amount);
  return {
    playerId,
    amount,
    crit,
    seamId: seam ? seam.id : null,
    broke: !!newSeam,
    newSeam,
    surge: !wasSurge && surgeOn(s, now),
    streak: p.streak,
    chain: p.chain,
  };
}

/** Buy up to `count` levels; returns how many were bought. */
export function buyUpgrade(s: RoomState, playerId: string, id: UpgradeId, count = 1): number | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (!Object.hasOwn(UPGRADES, id)) return 'locked'; // ids arrive from the network
  if (!upgradeUnlocked(s, id)) return 'locked';
  const def = UPGRADES[id];
  let n = 0;
  while (n < count) {
    const lv = p.levels[id];
    if (def.maxLevel !== undefined && lv >= def.maxLevel) break;
    const cost = upgradeCost(id, lv);
    if (p.wallet[def.currency] < cost) break;
    p.wallet[def.currency] -= cost;
    p.levels[id] = lv + 1;
    n++;
  }
  if (n) return n;
  return def.maxLevel !== undefined && p.levels[id] >= def.maxLevel ? 'maxed' : 'too-poor';
}

/**
 * The Foreman: buy the cheapest eligible upgrade level while it costs at
 * most the Foreman's share of what you hold. Returns levels bought by id.
 */
export function autoBuy(s: RoomState, p: PlayerState): Partial<Record<UpgradeId, number>> {
  const lv = p.levels.foreman;
  const bought: Partial<Record<UpgradeId, number>> = {};
  if (!p.auto || lv <= 0 || !upgradeUnlocked(s, 'foreman')) return bought;
  const share = FOREMAN_SHARE[Math.min(lv, FOREMAN_SHARE.length - 1)];
  for (let i = 0; i < FOREMAN_PER_TICK; i++) {
    let best: UpgradeId | null = null;
    let bestRatio = Infinity;
    for (const id of UPGRADE_IDS) {
      const def = UPGRADES[id];
      if (def.auto > lv || id === 'foreman' || !upgradeUnlocked(s, id)) continue;
      if (def.maxLevel !== undefined && p.levels[id] >= def.maxLevel) continue;
      const ratio = upgradeCost(id, p.levels[id]) / Math.max(1e-9, p.wallet[def.currency] * share);
      if (ratio < bestRatio) {
        bestRatio = ratio;
        best = id;
      }
    }
    if (!best || bestRatio > 1) break;
    if (buyUpgrade(s, p.id, best, 1) !== 1) break;
    bought[best] = (bought[best] ?? 0) + 1;
  }
  return bought;
}

export interface Prefs {
  role?: RoleId | null;
  auto?: boolean;
  refine?: boolean;
}

/** Change a player's role, Foreman or Refinery switch. Roles need Crew Charter and have a cooldown. */
export function setPrefs(s: RoomState, playerId: string, prefs: Prefs, now: number): Prefs | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (!prefs || typeof prefs !== 'object') return 'locked';
  const out: Prefs = {};
  if (prefs.role !== undefined && prefs.role !== p.role) {
    const role = prefs.role;
    if (role !== null && !(typeof role === 'string' && Object.hasOwn(ROLES, role))) return 'locked';
    if (!has(s, 'charter')) return 'locked';
    if (now < roleReadyAt(p)) return 'cooldown';
    p.role = role;
    p.roleAt = now;
    out.role = role;
  }
  if (typeof prefs.auto === 'boolean') p.auto = out.auto = prefs.auto;
  if (typeof prefs.refine === 'boolean') p.refine = out.refine = prefs.refine;
  return out;
}

export interface FundOutcome {
  playerId: string;
  node: NodeId;
  res: ResourceId;
  /** What the node received (a Refiner's contribution counts ×1.25). */
  amount: number;
  /** The node just unlocked (or gained a level). */
  done: boolean;
  level: number;
}

/** What's still owed on a node's next level, per resource. */
export function nodeRemaining(s: RoomState, id: NodeId): Partial<Wallet> {
  const cost = nodeCost(id, nodeLevel(s, id));
  const funded = s.tree[id]?.funded ?? {};
  const out: Partial<Wallet> = {};
  for (const [r, v] of Object.entries(cost) as [ResourceId, number][]) out[r] = Math.max(0, v - (funded[r] ?? 0));
  return out;
}

/** Unlock (or level up) a node whose every part is paid. */
function completeNode(s: RoomState, id: NodeId): boolean {
  const st = s.tree[id];
  if (!st || !Object.values(nodeRemaining(s, id)).every((v) => (v ?? 0) <= 1e-9)) return false;
  st.level++;
  st.funded = {};
  if (NODES[id].repeat) st.by = {};
  if (id === 'deepscan') refillSeams(s);
  return true;
}

/**
 * After loading a save: forget nodes this version doesn't have, cap partial
 * funding at the current price, and unlock any node that is already paid
 * for (prices can drop between versions).
 */
export function settleTree(s: RoomState): void {
  for (const id of Object.keys(s.tree) as NodeId[]) {
    const st = s.tree[id];
    if (!Object.hasOwn(NODES, id) || !st) {
      delete s.tree[id];
      continue;
    }
    st.level = Math.max(0, Math.floor(Number(st.level) || 0));
    st.funded ??= {};
    st.by ??= {};
    const cost = nodeCost(id, st.level);
    for (const r of Object.keys(st.funded) as ResourceId[]) {
      const c = cost[r];
      if (!c) delete st.funded[r];
      else st.funded[r] = Math.min(c, Number(st.funded[r]) || 0);
    }
  }
  // Unlocking one node can open the next, so settle until nothing changes.
  for (let changed = true; changed; ) {
    changed = false;
    for (const id of Object.keys(s.tree) as NodeId[]) {
      if (nodeFundable(s, id) && Object.keys(s.tree[id]!.funded).length && completeNode(s, id)) changed = true;
    }
  }
}

/** Put some of your own `res` into a Forge Tree node. `want` is what leaves your wallet. */
export function fundNode(s: RoomState, playerId: string, id: NodeId, res: ResourceId, want: number): FundOutcome | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (!Object.hasOwn(NODES, id) || !RESOURCES.includes(res)) return 'locked';
  if (!nodeFundable(s, id)) return has(s, id) ? 'maxed' : 'locked';
  const level = nodeLevel(s, id);
  const cost = nodeCost(id, level)[res];
  if (!cost) return 'locked';
  const st = (s.tree[id] ??= { level: 0, funded: {}, by: {} });
  const owed = Math.max(0, cost - (st.funded[res] ?? 0));
  const bonus = fundBonus(s, p, res);
  const paid = Math.min(Number.isFinite(want) ? Math.max(0, want) : 0, owed / bonus, p.wallet[res]);
  if (!(paid > 0)) return owed > 0 ? 'too-poor' : 'maxed';
  const amount = Math.min(owed, paid * bonus);
  p.wallet[res] -= paid;
  st.funded[res] = (st.funded[res] ?? 0) + amount;
  const parts = Object.keys(nodeCost(id, level)).length;
  const share = amount / cost / parts;
  st.by[playerId] = (st.by[playerId] ?? 0) + share;
  p.stats.funded += share;
  if (res === 'ore') contractAdd(s, playerId, 'fund', amount);
  const done = completeNode(s, id);
  return { playerId, node: id, res, amount, done, level: st.level };
}

export interface LeapOutcome {
  playerId: string;
  cores: number;
}

/** Restart your own run (ore, alloy, upgrades) for Star Cores. The tree and renown stay. */
export function leap(s: RoomState, playerId: string, now: number): LeapOutcome | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (!has(s, 'leap')) return 'locked';
  const cores = leapCores(p, s);
  if (cores <= 0) return 'not-ready';
  const kept = p.levels;
  p.wallet = { ore: 0, alloy: 0, cores: p.wallet.cores + cores };
  p.levels = emptyLevels();
  // Quantum Echo keeps every capped upgrade.
  if (has(s, 'echo')) for (const id of UPGRADE_IDS) if (UPGRADES[id].maxLevel !== undefined) p.levels[id] = kept[id];
  if (has(s, 'memory')) {
    p.levels.drill = MEMORY_LEVELS;
    p.levels.drone = MEMORY_LEVELS;
  }
  p.run = { ore: 0, alloy: 0, startedAt: now };
  p.rates = { ore: 0, alloy: 0 };
  p.rigAcc = 0;
  p.stats.leaps++;
  p.stats.cores += cores;
  return { playerId, cores };
}

export interface CometOutcome {
  playerId: string;
  id: number;
  /** Ore each online crewmate received. */
  rewards: Record<string, number>;
}

export function cometReward(s: RoomState, p: PlayerState): number {
  return Math.max(COMET_SECONDS * passiveOrePerSec(s, p), COMET_TAPS * tapValue(s, p)) * (has(s, 'lure') ? 2 : 1);
}

export function catchComet(s: RoomState, playerId: string, id: number, now: number): CometOutcome | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  const c = s.comet;
  if (!c || c.id !== id || now > c.until + 500) return 'gone';
  s.comet = null;
  const rewards: Record<string, number> = {};
  for (const q of onlinePlayers(s)) {
    const r = cometReward(s, q) * (q.id === playerId ? 2 : 1);
    earn(s, q, r);
    rewards[q.id] = r;
  }
  contractAdd(s, playerId, 'comets', 1);
  return { playerId, id, rewards };
}

/* ---------------- the tick ---------------- */

export type TickNote =
  | { k: 'comet'; comet: Comet }
  | { k: 'cometGone'; id: number }
  | { k: 'surgeEnd' }
  | { k: 'contract'; contract: Contract }
  | ({ k: 'contractDone' } & ContractOutcome)
  | { k: 'contractFailed'; id: number; kind: ContractKind };

/** Advance passive income by `dt` seconds. Returns notable things that happened. */
export function tickRoom(s: RoomState, dt: number, now: number, rand: Rand = Math.random): TickNote[] {
  const notes: TickNote[] = [];
  s.tick++;
  const wasSurge = surgeOn(s, s.now);
  s.now = now;
  const online = onlinePlayers(s);

  for (const p of online) {
    const before = { ore: p.wallet.ore, alloy: p.wallet.alloy };
    earn(s, p, (droneRate(s, p) + harvesterRate(s, p)) * dt, { passive: true });
    // Auto-Rigs tap the seams for real, so they wear them down and can break them.
    if (p.levels.rig > 0 && s.seams.length) {
      p.rigAcc += p.levels.rig * RIG_RATE * dt;
      const hits = Math.min(40, Math.floor(p.rigAcc));
      p.rigAcc -= hits;
      for (let i = 0; i < hits && s.seams.length; i++) {
        const seam = s.seams[Math.floor(rand() * s.seams.length)];
        let amount = tapValue(s, p) * RIG_SHARE * baseSeamMult(s);
        if (hitSeam(s, seam, 0.25, now, p.id)) amount *= breakMult(s);
        earn(s, p, amount, { passive: true });
      }
    }
    p.seenAt = now;
    if (dt > 0) {
      const a = Math.min(1, dt * 1.5);
      p.rates.ore += ((p.wallet.ore - before.ore) / dt - p.rates.ore) * a;
      p.rates.alloy += ((p.wallet.alloy - before.alloy) / dt - p.rates.alloy) * a;
    }
    autoBuy(s, p);
  }

  if (wasSurge && !surgeOn(s, now)) notes.push({ k: 'surgeEnd' });

  // Comets.
  if (s.comet && now > s.comet.until + 500) {
    notes.push({ k: 'cometGone', id: s.comet.id });
    s.comet = null;
  }
  if (!s.comet && online.length && now >= s.nextCometAt) {
    s.comet = { id: s.nextCometId++, at: now, until: now + COMET_MS, seed: Math.floor(rand() * 2 ** 31) };
    const gap = COMET_GAP_MIN_MS + rand() * (COMET_GAP_MAX_MS - COMET_GAP_MIN_MS);
    s.nextCometAt = now + gap / (has(s, 'lure') ? 2 : 1);
    notes.push({ k: 'comet', comet: s.comet });
  }

  // Contracts: they start with the Forge Core and run while someone is online.
  const c = s.contract;
  if (c && c.progress >= c.goal) notes.push({ k: 'contractDone', ...finishContract(s, now) });
  else if (c && now > c.until) {
    s.contract = null;
    s.nextContractAt = now + CONTRACT_GAP_MS;
    notes.push({ k: 'contractFailed', id: c.id, kind: c.kind });
  } else if (!c && online.length && has(s, 'core')) {
    if (!s.nextContractAt) s.nextContractAt = now + CONTRACT_FIRST_MS;
    else if (now >= s.nextContractAt) notes.push({ k: 'contract', contract: startContract(s, now, rand()) });
  }
  return notes;
}

/** Text for a contract: "Break 20 glowing seams". */
export function contractLabel(c: Pick<Contract, 'kind' | 'goal'>, fmtNum: (n: number) => string = String): string {
  return CONTRACTS[c.kind].label(fmtNum(c.goal));
}
