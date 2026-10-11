import { emptyLevels } from './economy.js';
import { RESOURCES, emptyWallet } from './resources.js';
import { createRoomState, freshPlayer, settleTree, type PlayerState, type RoomState } from './sim.js';

/**
 * Saving a world: the solo player or the host keeps the room in
 * localStorage. Crewmates' progress is saved with it (keyed by their
 * browser), so a friend who comes back to your world picks up where they
 * left off. Live things (comets, surges) are not saved.
 */
export const SAVE_KEY = 'starforge_save_v3';

export interface SaveFile {
  v: 3;
  savedAt: number;
  room: RoomState;
}

export function toSave(s: RoomState, now = Date.now()): SaveFile {
  const room: RoomState = JSON.parse(JSON.stringify(s));
  room.comet = null;
  room.contract = null;
  room.surgeUntil = 0;
  for (const p of Object.values(room.players)) {
    if (p.online) p.seenAt = now;
    p.online = false;
  }
  return { v: 3, savedAt: now, room };
}

/** Rebuild a room from a save, filling any field a newer version added. */
export function fromSave(f: unknown, now = Date.now()): RoomState | null {
  const file = f as SaveFile;
  if (!file || file.v !== 3 || !file.room || typeof file.room.seed !== 'number') return null;
  const r = file.room as Partial<RoomState>;
  const base = createRoomState(r.seed!, now);
  const players: Record<string, PlayerState> = {};
  for (const [id, p] of Object.entries(r.players ?? {})) {
    if (!p || typeof p.key !== 'string') continue;
    const wallet = { ...emptyWallet(), ...p.wallet };
    for (const k of RESOURCES) if (!Number.isFinite(wallet[k])) wallet[k] = 0;
    // Fields added after a save was written (roles, Foreman, streaks…) take their defaults.
    const fresh = freshPlayer(id, p.key, p.name, p.hue, now);
    players[id] = {
      ...fresh,
      ...p,
      id,
      online: false,
      wallet,
      levels: { ...emptyLevels(), ...p.levels },
      run: { ...{ ore: 0, alloy: 0, startedAt: now }, ...p.run },
      rates: { ore: 0, alloy: 0 },
      stats: { ...fresh.stats, ...p.stats },
      seenAt: Number(p.seenAt) || Number(file.savedAt) || now,
      rigAcc: 0,
      streak: 0,
      chain: 0,
    };
  }
  const room: RoomState = {
    ...base,
    ...r,
    v: 3,
    now,
    players,
    tree: r.tree ?? {},
    seams: r.seams && r.seams.length ? r.seams : base.seams,
    comet: null,
    surgeUntil: 0,
    nextCometAt: now + 45_000,
    contract: null,
    nextContractAt: 0,
    renown: Number(r.renown) || 0,
    contractsDone: Number(r.contractsDone) || 0,
  };
  // Node prices change between versions: finish nodes a save already paid for.
  settleTree(room);
  return room;
}
