import { randomUnit, rng, type Vec3 } from './asteroid.js';
import {
  CRIT_MULT,
  HEAT_BONUS_THRESHOLD,
  HEAT_MAX,
  OVERHEAT_LOCK_MS,
  SEAM_MULT,
  UPGRADES,
  critChance,
  emptyLevels,
  heatPerStrike,
  heatVent,
  passiveOrePerSec,
  quantumMult,
  strikeBase,
  upgradeCost,
  type UpgradeId,
  type UpgradeLevels,
} from './economy.js';
import { emptyWallet, type Wallet } from './resources.js';

/**
 * The authoritative simulation. Pure functions over plain data: the server
 * runs them for every room, and the client runs the same code in offline
 * mode, so there is exactly one implementation of the rules.
 */

export type Role = 'miner' | 'refiner';

export interface Seam {
  id: number;
  dir: Vec3;
  hp: number;
  maxHp: number;
}

export interface PlayerState {
  id: string;
  name: string;
  role: Role;
  heat: number;
  /** Epoch ms until which this player's drill is locked by overheat. */
  lockedUntil: number;
  lastStrikeAt: number;
}

export interface RoomState {
  seed: number;
  tick: number;
  wallet: Wallet;
  levels: UpgradeLevels;
  seams: Seam[];
  nextSeamId: number;
  players: Record<string, PlayerState>;
  quantumPoints: number;
  lifetimeOre: number;
}

export const SEAM_COUNT = 5;
export const SEAM_HP = 8;
/** Server-side strike rate limit per player (20 strikes/s). */
export const MIN_STRIKE_INTERVAL_MS = 50;

export function createRoomState(seed: number): RoomState {
  const s: RoomState = {
    seed,
    tick: 0,
    wallet: emptyWallet(),
    levels: emptyLevels(),
    seams: [],
    nextSeamId: 1,
    players: {},
    quantumPoints: 0,
    lifetimeOre: 0,
  };
  const r = rng(seed ^ 0x5eed);
  for (let i = 0; i < SEAM_COUNT; i++) spawnSeam(s, r);
  return s;
}

function spawnSeam(s: RoomState, r: () => number): Seam {
  const seam = { id: s.nextSeamId++, dir: randomUnit(r), hp: SEAM_HP, maxHp: SEAM_HP };
  s.seams.push(seam);
  return seam;
}

export function addPlayer(s: RoomState, id: string, name: string, role: Role): PlayerState {
  const p: PlayerState = { id, name, role, heat: 0, lockedUntil: 0, lastStrikeAt: 0 };
  s.players[id] = p;
  return p;
}

export const globalMult = (s: RoomState): number => quantumMult(s.quantumPoints);

export type StrikeReject = 'unknown-player' | 'rate-limited' | 'overheated' | 'wrong-role';

export interface StrikeOutcome {
  playerId: string;
  amount: number;
  crit: boolean;
  hot: boolean;
  seamId: number | null;
  seamDepleted: boolean;
  /** The seam spawned to replace a depleted one. */
  newSeam: Seam | null;
  heat: number;
  overheated: boolean;
}

/**
 * Resolve one strike. `roll` is a [0,1) random draw for the crit; the server
 * passes its own RNG so clients cannot choose their crits.
 */
export function applyStrike(
  s: RoomState,
  playerId: string,
  seamId: number | null,
  nowMs: number,
  roll: number,
): StrikeOutcome | StrikeReject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (p.role !== 'miner') return 'wrong-role';
  if (nowMs < p.lockedUntil) return 'overheated';
  if (nowMs - p.lastStrikeAt < MIN_STRIKE_INTERVAL_MS) return 'rate-limited';
  p.lastStrikeAt = nowMs;

  const crit = roll < critChance(s.levels);
  const hot = p.heat >= HEAT_BONUS_THRESHOLD;
  const seam = seamId == null ? undefined : s.seams.find((x) => x.id === seamId);

  let amount = strikeBase(s.levels, globalMult(s));
  if (crit) amount *= CRIT_MULT;
  if (hot) amount *= 2;
  if (seam) amount *= SEAM_MULT;

  let seamDepleted = false;
  let newSeam: Seam | null = null;
  if (seam) {
    seam.hp -= crit ? 2 : 1;
    if (seam.hp <= 0) {
      seamDepleted = true;
      amount *= 4; // depletion jackpot
      s.seams = s.seams.filter((x) => x !== seam);
      newSeam = spawnSeam(s, rng(s.seed ^ (s.nextSeamId * 2654435761)));
    }
  }

  s.wallet.ore += amount;
  s.lifetimeOre += amount;

  p.heat += heatPerStrike(s.levels);
  let overheated = false;
  if (p.heat >= HEAT_MAX) {
    p.heat = HEAT_MAX;
    p.lockedUntil = nowMs + OVERHEAT_LOCK_MS;
    overheated = true;
  }

  return { playerId, amount, crit, hot, seamId: seam ? seam.id : null, seamDepleted, newSeam, heat: p.heat, overheated };
}

/** Advance passive systems (drones, heat venting) by `dt` seconds. */
export function tickRoom(s: RoomState, dt: number, nowMs: number): void {
  s.tick++;
  const ore = passiveOrePerSec(s.levels, globalMult(s)) * dt;
  s.wallet.ore += ore;
  s.lifetimeOre += ore;
  const vent = heatVent(s.levels) * dt;
  for (const p of Object.values(s.players)) {
    if (nowMs >= p.lockedUntil) p.heat = Math.max(0, p.heat - vent);
  }
}

export function buyUpgrade(s: RoomState, id: UpgradeId): boolean {
  if (!Object.hasOwn(UPGRADES, id)) return false; // ids arrive from the network
  const def = UPGRADES[id];
  const lv = s.levels[id];
  if (def.maxLevel !== undefined && lv >= def.maxLevel) return false;
  const cost = upgradeCost(id, lv);
  if (s.wallet[def.currency] < cost) return false;
  s.wallet[def.currency] -= cost;
  s.levels[id] = lv + 1;
  return true;
}
