import { randomUnit, rng, type Vec3 } from './asteroid.js';
import {
  BASE_CRIT,
  BREAK_MULT,
  COMET_GAP_MAX_MS,
  COMET_GAP_MIN_MS,
  COMET_MS,
  COMET_SECONDS,
  COMET_TAPS,
  CORE_BONUS,
  CORE_BONUS_STARSEED,
  CRIT_MULT,
  CRIT_MULT_OPTICS,
  DRONE_RATE,
  HARVESTER_RATE,
  NODES,
  OFFLINE_CAP_NIGHT_S,
  OFFLINE_CAP_S,
  OFFLINE_EFF,
  OFFLINE_EFF_NIGHT,
  RIG_RATE,
  RIG_SHARE,
  SEAM_MULT,
  SEAM_MULT_DEEP,
  SMELT_PER_LEVEL,
  SURGE_CAP_MS,
  SURGE_MS,
  UPGRADES,
  coresFor,
  emptyLevels,
  milestoneMult,
  nodeCost,
  upgradeCost,
  type NodeId,
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
  stats: { ore: number; taps: number; leaps: number; cores: number; funded: number };
  lastStrikeAt: number;
  /** Last time this player was online, for offline earnings. */
  seenAt: number;
  rigAcc: number;
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

/** Crew Link: +25%, and +25% more for each crewmate past the second. */
export function crewMult(s: RoomState, online = onlineCount(s)): number {
  return has(s, 'teamlink') ? 1 + 0.25 * Math.max(1, online - 1) : 1;
}

export function coreMult(s: RoomState, p: PlayerState): number {
  return 1 + (has(s, 'starseed') ? CORE_BONUS_STARSEED : CORE_BONUS) * p.wallet.cores;
}

export const surgeOn = (s: RoomState, now = s.now): boolean => s.surgeUntil > now;

/** Multiplier on every bit of ore a player earns. */
export function allMult(s: RoomState, p: PlayerState, online = onlineCount(s), surge = surgeOn(s)): number {
  return (
    (has(s, 'core') ? 1.5 : 1) *
    crewMult(s, online) *
    coreMult(s, p) *
    (has(s, 'singularity') ? 3 : 1) *
    Math.pow(1.5, nodeLevel(s, 'mastery')) *
    (surge ? 2 : 1)
  );
}

/** Ore for one plain tap (before crit and seam bonuses). */
export function tapValue(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  const d = p.levels.drill;
  return (1 + d) * milestoneMult(d) * (has(s, 'overdrive') ? 4 : 1) * (has(s, 'hyperdrill') ? 10 : 1) * allMult(s, p, online, surge);
}

export const critChance = (p: PlayerState): number => BASE_CRIT + 0.01 * p.levels.lens;
export const critMult = (s: RoomState): number => (has(s, 'optics') ? CRIT_MULT_OPTICS : CRIT_MULT);
const baseSeamMult = (s: RoomState): number => (has(s, 'deepscan') ? SEAM_MULT_DEEP : SEAM_MULT);
export const seamMult = (s: RoomState, p: PlayerState): number => baseSeamMult(s) * (1 + 0.25 * p.levels.scanner);
export const seamTarget = (s: RoomState): number => (has(s, 'deepscan') ? 7 : 5);

const fleetMult = (s: RoomState, p: PlayerState): number => (1 + 0.25 * p.levels.plating) * (has(s, 'dyson') ? 10 : 1);

export function droneRate(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  const n = p.levels.drone;
  return n * DRONE_RATE * milestoneMult(n) * (has(s, 'swarm') ? 2 : 1) * fleetMult(s, p) * allMult(s, p, online, surge);
}

export function harvesterRate(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  const n = p.levels.harvester;
  return n * HARVESTER_RATE * milestoneMult(n) * fleetMult(s, p) * allMult(s, p, online, surge);
}

/** Expected ore per second from Auto-Rigs (ignoring crits). */
export function rigRate(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  return p.levels.rig * RIG_RATE * RIG_SHARE * tapValue(s, p, online, surge) * baseSeamMult(s);
}

export function passiveOrePerSec(s: RoomState, p: PlayerState, online?: number, surge?: boolean): number {
  return droneRate(s, p, online, surge) + harvesterRate(s, p, online, surge) + rigRate(s, p, online, surge);
}

/** Share of mined ore a player's Smelters also turn into alloy. */
export const smeltShare = (s: RoomState, p: PlayerState): number => p.levels.smelter * SMELT_PER_LEVEL * (has(s, 'hotsmelt') ? 2 : 1);

export const leapCores = (p: PlayerState): number => coresFor(p.run.ore);
export const canLeap = (s: RoomState, p: PlayerState): boolean => has(s, 'leap') && leapCores(p) > 0;

/* ---------------- players ---------------- */

function freshPlayer(id: string, key: string, name: string, hue: number, now: number): PlayerState {
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
    stats: { ore: 0, taps: 0, leaps: 0, cores: 0, funded: 0 },
    lastStrikeAt: 0,
    seenAt: now,
    rigAcc: 0,
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
}

/** Offline earnings: drones, harvesters and rigs at the offline rate, capped. */
export function applyOffline(s: RoomState, p: PlayerState, awayMs: number): OfflineGain {
  const night = has(s, 'nightshift');
  const seconds = Math.min(Math.max(0, awayMs / 1000), night ? OFFLINE_CAP_NIGHT_S : OFFLINE_CAP_S);
  const ore = passiveOrePerSec(s, p, 1, false) * seconds * (night ? OFFLINE_EFF_NIGHT : OFFLINE_EFF);
  const before = { ...p.wallet };
  earn(s, p, ore);
  const gained = emptyWallet();
  for (const r of RESOURCES) gained[r] = p.wallet[r] - before[r];
  return { seconds, gained };
}

function earn(s: RoomState, p: PlayerState, ore: number): void {
  if (!(ore > 0)) return;
  p.wallet.ore += ore;
  p.run.ore += ore;
  p.stats.ore += ore;
  const alloy = ore * smeltShare(s, p);
  if (alloy > 0) {
    p.wallet.alloy += alloy;
    p.run.alloy += alloy;
  }
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
function hitSeam(s: RoomState, seam: Seam, dmg: number, now: number): Seam | null {
  seam.hp -= dmg;
  if (seam.hp > 0) return null;
  s.seams = s.seams.filter((x) => x !== seam);
  if (has(s, 'resonance')) s.surgeUntil = Math.min(Math.max(s.surgeUntil, now) + SURGE_MS, now + SURGE_CAP_MS);
  return spawnSeam(s);
}

/* ---------------- actions ---------------- */

export type Reject = 'unknown-player' | 'rate-limited' | 'locked' | 'maxed' | 'too-poor' | 'gone' | 'not-ready';

export interface StrikeOutcome {
  playerId: string;
  amount: number;
  crit: boolean;
  seamId: number | null;
  broke: boolean;
  newSeam: Seam | null;
  surge: boolean;
}

export function applyStrike(s: RoomState, playerId: string, seamId: number | null, now: number, roll: number): StrikeOutcome | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (now - p.lastStrikeAt < MIN_STRIKE_INTERVAL_MS) return 'rate-limited';
  p.lastStrikeAt = now;
  p.stats.taps++;
  const crit = roll < critChance(p);
  const seam = seamId == null ? undefined : s.seams.find((x) => x.id === seamId);
  const wasSurge = surgeOn(s, now);
  let amount = tapValue(s, p, undefined, wasSurge);
  if (crit) amount *= critMult(s);
  let newSeam: Seam | null = null;
  if (seam) {
    amount *= seamMult(s, p);
    newSeam = hitSeam(s, seam, crit ? 2 : 1, now);
    if (newSeam) amount *= BREAK_MULT;
  }
  earn(s, p, amount);
  return { playerId, amount, crit, seamId: seam ? seam.id : null, broke: !!newSeam, newSeam, surge: !wasSurge && surgeOn(s, now) };
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

export interface FundOutcome {
  playerId: string;
  node: NodeId;
  res: ResourceId;
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

/** Put some of your own `res` into a Forge Tree node. */
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
  const amount = Math.min(Number.isFinite(want) ? Math.max(0, want) : 0, owed, p.wallet[res]);
  if (!(amount > 0)) return owed > 0 ? 'too-poor' : 'maxed';
  p.wallet[res] -= amount;
  st.funded[res] = (st.funded[res] ?? 0) + amount;
  const parts = Object.keys(nodeCost(id, level)).length;
  const share = amount / cost / parts;
  st.by[playerId] = (st.by[playerId] ?? 0) + share;
  p.stats.funded += share;
  const done = Object.values(nodeRemaining(s, id)).every((v) => (v ?? 0) <= 1e-9);
  if (done) {
    st.level++;
    st.funded = {};
    if (NODES[id].repeat) st.by = {};
    if (id === 'deepscan') refillSeams(s);
  }
  return { playerId, node: id, res, amount, done, level: st.level };
}

export interface LeapOutcome {
  playerId: string;
  cores: number;
}

/** Restart your own run (ore, alloy, upgrades) for Star Cores. The tree stays. */
export function leap(s: RoomState, playerId: string, now: number): LeapOutcome | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (!has(s, 'leap')) return 'locked';
  const cores = leapCores(p);
  if (cores <= 0) return 'not-ready';
  p.wallet = { ore: 0, alloy: 0, cores: p.wallet.cores + cores };
  p.levels = emptyLevels();
  if (has(s, 'memory')) {
    p.levels.drill = 10;
    p.levels.drone = 10;
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
  return Math.max(COMET_SECONDS * passiveOrePerSec(s, p), COMET_TAPS * tapValue(s, p));
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
  return { playerId, id, rewards };
}

/* ---------------- the tick ---------------- */

export type TickNote = { k: 'comet'; comet: Comet } | { k: 'cometGone'; id: number } | { k: 'surgeEnd' };

/** Advance passive income by `dt` seconds. Returns notable things that happened. */
export function tickRoom(s: RoomState, dt: number, now: number, rand: Rand = Math.random): TickNote[] {
  const notes: TickNote[] = [];
  s.tick++;
  const wasSurge = surgeOn(s, s.now);
  s.now = now;
  const online = onlinePlayers(s);

  for (const p of online) {
    const before = { ore: p.wallet.ore, alloy: p.wallet.alloy };
    earn(s, p, (droneRate(s, p) + harvesterRate(s, p)) * dt);
    // Auto-Rigs tap the seams for real, so they wear them down and can break them.
    if (p.levels.rig > 0 && s.seams.length) {
      p.rigAcc += p.levels.rig * RIG_RATE * dt;
      const hits = Math.min(40, Math.floor(p.rigAcc));
      p.rigAcc -= hits;
      for (let i = 0; i < hits && s.seams.length; i++) {
        const seam = s.seams[Math.floor(rand() * s.seams.length)];
        let amount = tapValue(s, p) * RIG_SHARE * baseSeamMult(s);
        if (hitSeam(s, seam, 0.25, now)) amount *= BREAK_MULT;
        earn(s, p, amount);
      }
    }
    p.seenAt = now;
    if (dt > 0) {
      const a = Math.min(1, dt * 1.5);
      p.rates.ore += ((p.wallet.ore - before.ore) / dt - p.rates.ore) * a;
      p.rates.alloy += ((p.wallet.alloy - before.alloy) / dt - p.rates.alloy) * a;
    }
  }

  if (wasSurge && !surgeOn(s, now)) notes.push({ k: 'surgeEnd' });

  // Comets.
  if (s.comet && now > s.comet.until + 500) {
    notes.push({ k: 'cometGone', id: s.comet.id });
    s.comet = null;
  }
  if (!s.comet && online.length && now >= s.nextCometAt) {
    s.comet = { id: s.nextCometId++, at: now, until: now + COMET_MS, seed: Math.floor(rand() * 2 ** 31) };
    s.nextCometAt = now + COMET_GAP_MIN_MS + rand() * (COMET_GAP_MAX_MS - COMET_GAP_MIN_MS);
    notes.push({ k: 'comet', comet: s.comet });
  }
  return notes;
}
