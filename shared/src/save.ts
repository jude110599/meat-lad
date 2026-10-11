import { OFFLINE_CAP_S, emptyLevels, emptySkills, offlineEfficiency } from './economy.js';
import { RESOURCES, emptyWallet, type Wallet } from './resources.js';
import { createRoomState, tickRoom, type RoomState } from './sim.js';

/**
 * Saving an expedition: the solo player or the host keeps the room in
 * localStorage (and on their account when signed in). Players, votes and
 * live events are session-only and are not saved.
 */
export const SAVE_KEY = 'starforge_save_v2';

export interface SaveFile {
  v: 2;
  savedAt: number;
  room: Omit<RoomState, 'players' | 'vote' | 'event'>;
}

export function toSave(s: RoomState, now = Date.now()): SaveFile {
  const { players: _p, vote: _v, event: _e, ...room } = s;
  return { v: 2, savedAt: now, room: JSON.parse(JSON.stringify(room)) };
}

/** Rebuild a room from a save, filling any field a newer version added. */
export function fromSave(f: unknown, now = Date.now()): RoomState | null {
  const file = f as SaveFile;
  if (!file || file.v !== 2 || !file.room || typeof file.room.seed !== 'number') return null;
  const base = createRoomState(file.room.seed, now);
  const r = file.room as Partial<RoomState>;
  const s: RoomState = {
    ...base,
    ...r,
    v: 2,
    now,
    players: {},
    vote: null,
    event: null,
    nextEventAt: 0,
    wallet: { ...emptyWallet(), ...r.wallet },
    rates: { ...emptyWallet(), ...r.rates },
    levels: { ...emptyLevels(), ...r.levels },
    skills: { ...emptySkills(), ...r.skills },
    machinesOn: { ...base.machinesOn, ...r.machinesOn },
    run: { ...base.run, ...r.run, made: { ...emptyWallet(), ...r.run?.made } },
    lifetime: { ...base.lifetime, ...r.lifetime },
    buffs: {},
    seams: r.seams && r.seams.length ? r.seams : base.seams,
  };
  for (const k of RESOURCES) if (!Number.isFinite(s.wallet[k])) s.wallet[k] = 0;
  return s;
}

/**
 * Offline progress: run the passive economy (drones, rigs, refinery) for the
 * time away, at the offline efficiency, capped at 8 hours. Returns the gains.
 */
export function applyOffline(s: RoomState, awayMs: number, now = Date.now()): { seconds: number; gained: Wallet } {
  const seconds = Math.min(Math.max(0, awayMs / 1000), OFFLINE_CAP_S) * offlineEfficiency(s.skills);
  const before = { ...s.wallet };
  const players = s.players;
  s.players = {};
  let left = seconds;
  let t = now - seconds * 1000;
  while (left > 0) {
    const dt = Math.min(10, left);
    t += dt * 1000;
    tickRoom(s, dt, t, () => 0.5);
    left -= dt;
  }
  s.players = players;
  s.nextEventAt = 0;
  const gained = emptyWallet();
  for (const k of RESOURCES) gained[k] = Math.max(0, s.wallet[k] - before[k]);
  return { seconds, gained };
}
