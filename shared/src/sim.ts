import { randomUnit, rng, type Vec3 } from './asteroid.js';
import {
  COMBO_HOLD_MS,
  CRIT_MULT,
  DEPLETE_MULT,
  HEAT_MAX,
  LEAP_THRESHOLD,
  MACHINES,
  MACHINE_DEFS,
  OVERCLOCKS,
  OVERHEAT_LOCK_MS,
  POWER_PER_PRESS,
  RIG_STRIKES_PER_SEC,
  RIG_YIELD,
  SEAM_MULT,
  SKILLS,
  SYNC_STEP,
  SYNC_WINDOW_MS,
  UPGRADES,
  critChance,
  droneOrePerSec,
  emptyLevels,
  emptySkills,
  heatPerStrike,
  heatVent,
  hotThreshold,
  machineRate,
  maxCombo,
  powerMax,
  powerRegen,
  pressYield,
  quantumMult,
  quantumPointsFor,
  strikeBase,
  upgradeCost,
  type MachineId,
  type OverclockId,
  type SkillId,
  type SkillLevels,
  type UpgradeId,
  type UpgradeLevels,
} from './economy.js';
import { RESOURCES, emptyWallet, type ResourceId, type Wallet } from './resources.js';

/**
 * The authoritative simulation. Pure functions over plain JSON data: the
 * dedicated server and a hosting player's browser both run them, so there
 * is exactly one implementation of every rule. Randomness is always passed
 * in, so the host owns every roll.
 */

export type Role = 'miner' | 'refiner';
export type Rand = () => number;

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
  /** Hue (0-360) for this player's ship, laser and name tag. */
  hue: number;
  heat: number;
  lockedUntil: number;
  lastStrikeAt: number;
  lastPressAt: number;
  lastActAt: number;
  online: boolean;
  /** Ore this player has mined this run, for the team panel. */
  mined: number;
}

export type BuffId = 'resonance' | 'solar' | 'focusField' | 'hyperdrive' | 'droneSurge' | 'dronesDown';

export interface QuakeNode {
  id: number;
  dir: Vec3;
  /** Epoch ms until which a stabilize press locks this node. */
  primedUntil: number;
  locked: boolean;
}

export type CoopEvent =
  | { kind: 'quake'; startedAt: number; endsAt: number; nodes: QuakeNode[] }
  | { kind: 'flare'; startedAt: number; endsAt: number; shield: number; sunDir: Vec3 };

export interface LeapVote {
  by: string;
  until: number;
  yes: string[];
  no: string[];
}

export interface RoomState {
  v: 2;
  seed: number;
  tick: number;
  now: number;
  wallet: Wallet;
  /** Smoothed net income per second, for the HUD. */
  rates: Wallet;
  levels: UpgradeLevels;
  machinesOn: Record<MachineId, boolean>;
  seams: Seam[];
  nextSeamId: number;
  players: Record<string, PlayerState>;
  power: number;
  combo: number;
  comboUntil: number;
  lastStrikeAt: number;
  lastPressAt: number;
  buffs: Partial<Record<BuffId, number>>;
  event: CoopEvent | null;
  nextEventAt: number;
  eventsWon: number;
  eventsLost: number;
  vote: LeapVote | null;
  quantumPoints: number;
  skills: SkillLevels;
  leaps: number;
  /** Produced this run; `made` drives upgrade unlocks. */
  run: { ore: number; cosmicEnergy: number; startedAt: number; made: Wallet };
  lifetime: { ore: number; strikes: number; cosmicEnergy: number };
  rigAcc: number;
}

export const SEAM_COUNT = 5;
export const SEAM_HP = 8;
export const MIN_STRIKE_INTERVAL_MS = 50;
export const MIN_PRESS_INTERVAL_MS = 80;
export const MIN_SHIELD_INTERVAL_MS = 120;
export const VOTE_MS = 15000;
export const QUAKE_MS = 25000;
export const QUAKE_PRIME_MS = 2500;
export const FLARE_MS = 22000;
export const FLARE_DRAIN = 7;
export const FLARE_SHIELD_PER_PRESS = 8;

const HUES = [32, 190, 280, 120, 340, 60];

export function createRoomState(seed: number, now = Date.now()): RoomState {
  const s: RoomState = {
    v: 2,
    seed,
    tick: 0,
    now,
    wallet: emptyWallet(),
    rates: emptyWallet(),
    levels: emptyLevels(),
    machinesOn: { smelter: true, infuser: true, compressor: true, condenser: true },
    seams: [],
    nextSeamId: 1,
    players: {},
    power: 30,
    combo: 1,
    comboUntil: 0,
    lastStrikeAt: 0,
    lastPressAt: 0,
    buffs: {},
    event: null,
    nextEventAt: 0,
    eventsWon: 0,
    eventsLost: 0,
    vote: null,
    quantumPoints: 0,
    skills: emptySkills(),
    leaps: 0,
    run: { ore: 0, cosmicEnergy: 0, startedAt: now, made: emptyWallet() },
    lifetime: { ore: 0, strikes: 0, cosmicEnergy: 0 },
    rigAcc: 0,
  };
  refillSeams(s);
  return s;
}

export const seamTarget = (s: RoomState): number => 5 + s.skills.seamSense;

function spawnSeam(s: RoomState): Seam {
  const r = rng((s.seed ^ (s.nextSeamId * 2654435761)) >>> 0);
  const seam = { id: s.nextSeamId++, dir: randomUnit(r), hp: SEAM_HP, maxHp: SEAM_HP };
  s.seams.push(seam);
  return seam;
}
function refillSeams(s: RoomState): void {
  for (const seam of s.seams) seam.hp = seam.maxHp;
  while (s.seams.length < seamTarget(s)) spawnSeam(s);
}

export function addPlayer(s: RoomState, id: string, name: string, role: Role): PlayerState {
  const existing = s.players[id];
  if (existing) {
    existing.online = true;
    existing.name = name || existing.name;
    return existing;
  }
  const used = new Set(Object.values(s.players).map((p) => p.hue));
  const hue = HUES.find((h) => !used.has(h)) ?? Math.floor(Math.random() * 360);
  const p: PlayerState = {
    id,
    name: (name || 'Prospector').slice(0, 16),
    role,
    hue,
    heat: 0,
    lockedUntil: 0,
    lastStrikeAt: 0,
    lastPressAt: 0,
    lastActAt: 0,
    online: true,
    mined: 0,
  };
  s.players[id] = p;
  return p;
}

export const onlinePlayers = (s: RoomState): PlayerState[] => Object.values(s.players).filter((p) => p.online);

export const buffOn = (s: RoomState, b: BuffId): boolean => (s.buffs[b] ?? 0) > s.now;
export const globalMult = (s: RoomState): number => quantumMult(s.quantumPoints);
export const oreMult = (s: RoomState): number => (buffOn(s, 'resonance') ? 3 : 1);
export const refineMult = (s: RoomState): number => (buffOn(s, 'solar') ? 2 : 1);

function earnOre(s: RoomState, amount: number, p?: PlayerState): void {
  s.wallet.ore += amount;
  s.run.ore += amount;
  s.run.made.ore += amount;
  s.lifetime.ore += amount;
  if (p) p.mined += amount;
}

/* ---------------- sync combo ---------------- */

function touchCombo(s: RoomState, kind: 'strike' | 'press', now: number): boolean {
  if (kind === 'strike') s.lastStrikeAt = now;
  else s.lastPressAt = now;
  const other = kind === 'strike' ? s.lastPressAt : s.lastStrikeAt;
  if (now - other <= SYNC_WINDOW_MS) {
    s.combo = Math.min(maxCombo(s.skills), s.combo + SYNC_STEP);
    s.comboUntil = now + COMBO_HOLD_MS;
    // A pair only counts once.
    if (kind === 'strike') s.lastPressAt = 0;
    else s.lastStrikeAt = 0;
    return true;
  }
  return false;
}

/* ---------------- strikes ---------------- */

export type Reject = 'unknown-player' | 'rate-limited' | 'overheated' | 'no-power' | 'maxed' | 'too-poor' | 'no-event' | 'locked';

export interface StrikeOutcome {
  playerId: string;
  amount: number;
  crit: boolean;
  hot: boolean;
  sync: boolean;
  seamId: number | null;
  seamDepleted: boolean;
  newSeam: Seam | null;
  nodeId: number | null;
  heat: number;
  overheated: boolean;
}

export function applyStrike(
  s: RoomState,
  playerId: string,
  target: { seamId?: number | null; nodeId?: number | null },
  now: number,
  roll: number,
): StrikeOutcome | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (now < p.lockedUntil) return 'overheated';
  if (now - p.lastStrikeAt < MIN_STRIKE_INTERVAL_MS) return 'rate-limited';
  p.lastStrikeAt = now;
  p.lastActAt = now;
  s.lifetime.strikes++;

  const crit = roll < critChance(s.levels, buffOn(s, 'focusField'));
  const hot = p.heat >= hotThreshold(s.skills);
  const seam = target.seamId == null ? undefined : s.seams.find((x) => x.id === target.seamId);
  const sync = touchCombo(s, 'strike', now);

  let amount = strikeBase(s.levels, s.skills, globalMult(s)) * oreMult(s) * s.combo;
  if (crit) amount *= CRIT_MULT;
  if (hot) amount *= 2;
  if (seam) amount *= SEAM_MULT;
  if (buffOn(s, 'hyperdrive')) amount *= 2;

  let seamDepleted = false;
  let newSeam: Seam | null = null;
  if (seam) {
    seam.hp -= crit ? 2 : 1;
    if (seam.hp <= 0) {
      seamDepleted = true;
      amount *= DEPLETE_MULT;
      s.seams = s.seams.filter((x) => x !== seam);
      newSeam = spawnSeam(s);
    }
  }

  // Resonance nodes during a Seismic Shockwave: a strike primes the node.
  let nodeId: number | null = null;
  if (target.nodeId != null && s.event?.kind === 'quake') {
    const node = s.event.nodes.find((n) => n.id === target.nodeId);
    if (node && !node.locked) {
      node.primedUntil = now + QUAKE_PRIME_MS;
      nodeId = node.id;
    }
  }

  earnOre(s, amount, p);

  const flare = s.event?.kind === 'flare';
  p.heat += heatPerStrike(s.levels) * (flare ? 2 : 1);
  let overheated = false;
  if (p.heat >= HEAT_MAX) {
    p.heat = HEAT_MAX;
    p.lockedUntil = now + OVERHEAT_LOCK_MS;
    overheated = true;
  }

  return { playerId, amount, crit, hot, sync, seamId: seam ? seam.id : null, seamDepleted, newSeam, nodeId, heat: p.heat, overheated };
}

/* ---------------- refinery presses ---------------- */

export interface PressOutcome {
  playerId: string;
  machine: MachineId;
  made: number;
  output: ResourceId;
  sync: boolean;
  power: number;
}

export function applyPress(s: RoomState, playerId: string, machine: MachineId, now: number): PressOutcome | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (!MACHINES.includes(machine)) return 'maxed';
  if (now - p.lastPressAt < MIN_PRESS_INTERVAL_MS) return 'rate-limited';
  p.lastPressAt = now;
  p.lastActAt = now;
  if (s.levels[machine] < 1) return 'locked';
  const def = MACHINE_DEFS[machine];
  const sync = touchCombo(s, 'press', now);
  const want = pressYield(machine, s.levels, s.skills, globalMult(s)) * s.combo * refineMult(s);
  const made = Math.min(want, s.wallet[def.input] / def.ratio);
  if (made > 0) {
    s.wallet[def.input] -= made * def.ratio;
    gain(s, def.output, made);
  }
  s.power = Math.min(powerMax(s.levels), s.power + POWER_PER_PRESS * (1 + 0.25 * s.skills.gridSurplus));
  return { playerId, machine, made, output: def.output, sync, power: s.power };
}

function gain(s: RoomState, r: ResourceId, n: number): void {
  s.wallet[r] += n;
  s.run.made[r] += n;
  if (r === 'cosmicEnergy') {
    s.run.cosmicEnergy += n;
    s.lifetime.cosmicEnergy += n;
  }
  if (r === 'ore') {
    s.run.ore += n;
    s.lifetime.ore += n;
  }
}

/* ---------------- shop, skills, routing, overclocks ---------------- */

export function buyUpgrade(s: RoomState, id: UpgradeId): boolean {
  if (!Object.hasOwn(UPGRADES, id)) return false; // ids arrive from the network
  const def = UPGRADES[id];
  const lv = s.levels[id];
  if (def.maxLevel !== undefined && lv >= def.maxLevel) return false;
  if (!isUnlocked(s, id)) return false;
  const cost = upgradeCost(id, lv);
  if (s.wallet[def.currency] < cost) return false;
  s.wallet[def.currency] -= cost;
  s.levels[id] = lv + 1;
  return true;
}

/** Owned upgrades stay visible; the rest wait for their production milestone. */
export function isUnlocked(s: RoomState, id: UpgradeId): boolean {
  const u = UPGRADES[id].unlock;
  return !u || s.levels[id] > 0 || s.run.made[u.res] >= u.amount;
}

export function buySkill(s: RoomState, id: SkillId): boolean {
  if (!Object.hasOwn(SKILLS, id)) return false;
  const def = SKILLS[id];
  if (s.skills[id] >= def.max || s.quantumPoints < def.cost) return false;
  s.quantumPoints -= def.cost;
  s.skills[id]++;
  if (id === 'seamSense') refillSeams(s);
  return true;
}

export function toggleMachine(s: RoomState, m: MachineId, on: boolean): boolean {
  if (!MACHINES.includes(m)) return false;
  s.machinesOn[m] = !!on;
  return true;
}

export function setRole(s: RoomState, playerId: string, role: Role): boolean {
  const p = s.players[playerId];
  if (!p || (role !== 'miner' && role !== 'refiner')) return false;
  p.role = role;
  return true;
}

export function overclock(s: RoomState, playerId: string, id: OverclockId, now: number): Reject | true {
  if (!Object.hasOwn(OVERCLOCKS, id)) return 'maxed';
  if (!s.players[playerId]) return 'unknown-player';
  const def = OVERCLOCKS[id];
  if (s.power < def.cost) return 'no-power';
  s.power -= def.cost;
  if (id === 'thermalDump') {
    for (const p of Object.values(s.players)) {
      p.heat = 0;
      p.lockedUntil = 0;
    }
  } else {
    s.buffs[id] = Math.max(s.buffs[id] ?? 0, now) + def.ms;
  }
  return true;
}

/* ---------------- co-op events ---------------- */

export const eventRewardMult = (s: RoomState): number => 1 + 0.5 * s.skills.eventHorizon;

/** Events only start once the team has a refinery going, then every 3.5 to 6 minutes. */
function scheduleNextEvent(s: RoomState, now: number, rand: Rand): void {
  s.nextEventAt = now + 210000 + rand() * 150000;
}

export function startEvent(s: RoomState, kind: 'quake' | 'flare', now: number, rand: Rand): CoopEvent {
  if (kind === 'quake') {
    const nodes: QuakeNode[] = [];
    for (let i = 0; i < 3; i++) nodes.push({ id: i + 1, dir: randomUnit(rand), primedUntil: 0, locked: false });
    s.event = { kind, startedAt: now, endsAt: now + QUAKE_MS, nodes };
  } else {
    s.event = { kind, startedAt: now, endsAt: now + FLARE_MS, shield: 60, sunDir: randomUnit(rand) };
  }
  return s.event;
}

export interface StabilizeOutcome {
  playerId: string;
  locked: number[];
}
/** Seismic Shockwave: lock every resonance node that a strike has just primed. */
export function stabilize(s: RoomState, playerId: string, now: number): StabilizeOutcome | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (s.event?.kind !== 'quake') return 'no-event';
  if (now - p.lastPressAt < MIN_PRESS_INTERVAL_MS) return 'rate-limited';
  p.lastPressAt = now;
  const locked: number[] = [];
  for (const n of s.event.nodes) {
    if (!n.locked && n.primedUntil > now) {
      n.locked = true;
      locked.push(n.id);
    }
  }
  return { playerId, locked };
}

/** Solar Flare: every press tops up the team shield. */
export function shieldPress(s: RoomState, playerId: string, now: number): number | Reject {
  const p = s.players[playerId];
  if (!p) return 'unknown-player';
  if (s.event?.kind !== 'flare') return 'no-event';
  if (now - p.lastPressAt < MIN_SHIELD_INTERVAL_MS) return 'rate-limited';
  p.lastPressAt = now;
  s.event.shield = Math.min(100, s.event.shield + FLARE_SHIELD_PER_PRESS);
  return s.event.shield;
}

export interface EventEnd {
  kind: 'quake' | 'flare';
  success: boolean;
  /** Human-readable reward or penalty, for the banner. */
  note: string;
}

function endEvent(s: RoomState, success: boolean, now: number, rand: Rand): EventEnd {
  const ev = s.event!;
  s.event = null;
  scheduleNextEvent(s, now, rand);
  const mult = eventRewardMult(s);
  if (success) s.eventsWon++;
  else s.eventsLost++;
  if (ev.kind === 'quake') {
    if (success) {
      refillSeams(s);
      s.buffs.resonance = now + 30000 * mult;
      return { kind: 'quake', success, note: `Resonance: ore ×3 for ${Math.round(30 * mult)}s and every seam refilled` };
    }
    const lost = Math.floor(s.wallet.ore * 0.1);
    s.wallet.ore -= lost;
    for (const p of Object.values(s.players)) {
      p.heat = HEAT_MAX;
      p.lockedUntil = now + 3000;
    }
    return { kind: 'quake', success, note: `The quake shook loose ${Math.round(lost)} ore and jammed every drill` };
  }
  if (success) {
    const plasma = Math.max(3, s.rates.plasma * 30) * mult;
    gain(s, 'plasma', plasma);
    s.buffs.solar = now + 30000 * mult;
    return { kind: 'flare', success, note: `Solar charge: +${Math.round(plasma)} plasma and the refinery runs ×2 for ${Math.round(30 * mult)}s` };
  }
  s.buffs.dronesDown = now + 20000;
  return { kind: 'flare', success, note: 'The flare fried the drones for 20s' };
}

/* ---------------- prestige ---------------- */

export const canLeap = (s: RoomState): boolean => s.run.cosmicEnergy >= LEAP_THRESHOLD;

export function proposeLeap(s: RoomState, playerId: string, now: number): boolean {
  if (!canLeap(s) || s.vote || !s.players[playerId]) return false;
  s.vote = { by: playerId, until: now + VOTE_MS, yes: [playerId], no: [] };
  return true;
}
export function castVote(s: RoomState, playerId: string, yes: boolean): boolean {
  if (!s.vote || !s.players[playerId]) return false;
  s.vote.yes = s.vote.yes.filter((x) => x !== playerId);
  s.vote.no = s.vote.no.filter((x) => x !== playerId);
  (yes ? s.vote.yes : s.vote.no).push(playerId);
  return true;
}

export interface LeapDone {
  qp: number;
  participants: number;
}

/** Reset the run, keep Quantum Points, skills and lifetime stats. */
export function performLeap(s: RoomState, now: number): LeapDone {
  const participants = Math.max(1, onlinePlayers(s).length);
  const qp = quantumPointsFor(s.run.cosmicEnergy, participants);
  s.quantumPoints += qp;
  s.leaps++;
  s.vote = null;
  s.event = null;
  s.nextEventAt = 0;
  s.buffs = {};
  s.wallet = emptyWallet();
  s.rates = emptyWallet();
  s.levels = emptyLevels();
  s.power = 30;
  s.combo = 1;
  s.run = { ore: 0, cosmicEnergy: 0, startedAt: now, made: emptyWallet() };
  s.seed = (s.seed * 1103515245 + 12345) >>> 0 || 1;
  s.seams = [];
  refillSeams(s);
  s.wallet.ore = 500 * s.skills.headStart;
  s.wallet.alloy = 50 * s.skills.headStart;
  for (const p of Object.values(s.players)) {
    p.heat = 0;
    p.lockedUntil = 0;
    p.mined = 0;
  }
  return { qp, participants };
}

/* ---------------- the tick ---------------- */

export type TickNote =
  | { k: 'eventStart'; event: CoopEvent }
  | { k: 'eventEnd'; end: EventEnd }
  | { k: 'leap'; done: LeapDone }
  | { k: 'voteFailed' };

/** Advance passive systems by `dt` seconds. Returns notable things that happened. */
export function tickRoom(s: RoomState, dt: number, now: number, rand: Rand = Math.random): TickNote[] {
  const notes: TickNote[] = [];
  s.tick++;
  s.now = now;
  const before = { ...s.wallet };
  const g = globalMult(s);

  // Drones and rigs.
  if (!buffOn(s, 'dronesDown')) {
    earnOre(s, droneOrePerSec(s.levels, g) * oreMult(s) * (buffOn(s, 'droneSurge') ? 3 : 1) * dt);
  }
  if (s.levels.rig > 0 && s.seams.length) {
    s.rigAcc += s.levels.rig * RIG_STRIKES_PER_SEC * dt;
    const hits = Math.floor(s.rigAcc);
    s.rigAcc -= hits;
    const per = strikeBase(s.levels, s.skills, g) * RIG_YIELD * SEAM_MULT * oreMult(s);
    for (let i = 0; i < hits; i++) {
      const seam = s.seams[i % s.seams.length];
      let amount = per;
      seam.hp -= 0.25;
      if (seam.hp <= 0) {
        amount *= DEPLETE_MULT;
        s.seams = s.seams.filter((x) => x !== seam);
        spawnSeam(s);
      }
      earnOre(s, amount);
    }
  }

  // Refinery: process top tier first so a unit isn't refined twice in one tick.
  for (let i = MACHINES.length - 1; i >= 0; i--) {
    const m = MACHINES[i];
    if (!s.machinesOn[m] || s.levels[m] === 0) continue;
    const def = MACHINE_DEFS[m];
    const want = machineRate(m, s.levels, s.skills, g) * refineMult(s) * dt;
    const made = Math.min(want, s.wallet[def.input] / def.ratio);
    if (made <= 0) continue;
    s.wallet[def.input] -= made * def.ratio;
    gain(s, def.output, made);
  }

  // Heat venting, power, combo decay.
  const vent = heatVent(s.levels) * dt;
  for (const p of Object.values(s.players)) {
    if (now >= p.lockedUntil) p.heat = Math.max(0, p.heat - vent);
  }
  s.power = Math.min(powerMax(s.levels), s.power + powerRegen(s.levels, s.skills) * dt);
  if (now > s.comboUntil && s.combo > 1) s.combo = Math.max(1, s.combo - 0.5 * dt);

  // Events.
  const ev = s.event;
  if (ev) {
    if (ev.kind === 'quake') {
      if (ev.nodes.every((n) => n.locked)) notes.push({ k: 'eventEnd', end: endEvent(s, true, now, rand) });
      else if (now >= ev.endsAt) notes.push({ k: 'eventEnd', end: endEvent(s, false, now, rand) });
    } else {
      ev.shield = Math.max(0, ev.shield - FLARE_DRAIN * dt);
      if (ev.shield <= 0) notes.push({ k: 'eventEnd', end: endEvent(s, false, now, rand) });
      else if (now >= ev.endsAt) notes.push({ k: 'eventEnd', end: endEvent(s, true, now, rand) });
    }
  } else if (s.levels.smelter > 0 && !s.vote) {
    if (!s.nextEventAt) scheduleNextEvent(s, now, rand);
    else if (now >= s.nextEventAt && onlinePlayers(s).length > 0) {
      notes.push({ k: 'eventStart', event: startEvent(s, rand() < 0.5 ? 'quake' : 'flare', now, rand) });
    }
  }

  // Leap vote: passes when everyone online said yes, or on a majority at the deadline.
  if (s.vote) {
    const online = onlinePlayers(s).map((p) => p.id);
    const yes = s.vote.yes.filter((id) => online.includes(id)).length;
    const no = s.vote.no.filter((id) => online.includes(id)).length;
    if (yes >= online.length || (now >= s.vote.until && yes > no)) notes.push({ k: 'leap', done: performLeap(s, now) });
    else if (now >= s.vote.until || no > online.length / 2) {
      s.vote = null;
      notes.push({ k: 'voteFailed' });
    }
  }

  // Smoothed income per second for the HUD.
  if (dt > 0) {
    const a = Math.min(1, dt * 2);
    for (const r of RESOURCES) s.rates[r] += ((s.wallet[r] - before[r]) / dt - s.rates[r]) * a;
  }
  return notes;
}

/** Passive income per second (drones and rigs), for offline gains and the HUD. */
export function passiveOrePerSec(s: RoomState): number {
  const g = globalMult(s);
  const rig = s.levels.rig * RIG_STRIKES_PER_SEC * strikeBase(s.levels, s.skills, g) * RIG_YIELD * SEAM_MULT;
  return droneOrePerSec(s.levels, g) + rig;
}
