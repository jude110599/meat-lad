import { create } from 'zustand';
import {
  emptyLevels,
  emptyWallet,
  type PlayerState,
  type Role,
  type Seam,
  type Snapshot,
  type UpgradeLevels,
  type Wallet,
} from '@starforge/shared';

export type ConnMode = 'connecting' | 'online' | 'offline';

/**
 * Client view of the game. It is a *replica*: every field is written from an
 * authority (the server, or the in-browser LocalAuthority when offline), never
 * mutated directly by UI code.
 */
export interface GameStore {
  mode: ConnMode;
  room: string | null;
  playerId: string;
  role: Role;
  seed: number;
  wallet: Wallet;
  levels: UpgradeLevels;
  seams: Seam[];
  players: PlayerState[];
  orePerSec: number;
  quantumPoints: number;
  /** performance.now() when the last snapshot landed, for smooth counter interpolation. */
  snapshotAt: number;
  ready: boolean;

  setConnection(p: Partial<Pick<GameStore, 'mode' | 'room' | 'playerId' | 'role' | 'seed'>>): void;
  applySnapshot(s: Snapshot): void;
  addOre(amount: number): void;
  setPlayerHeat(id: string, heat: number, lockedUntil?: number): void;
  replaceSeam(oldId: number | null, newSeam: Seam | null, hit?: { id: number; dmg: number }): void;
}

export const useGame = create<GameStore>((set) => ({
  mode: 'connecting',
  room: null,
  playerId: '',
  role: 'miner',
  seed: 1,
  wallet: emptyWallet(),
  levels: emptyLevels(),
  seams: [],
  players: [],
  orePerSec: 0,
  quantumPoints: 0,
  snapshotAt: performance.now(),
  ready: false,

  setConnection: (p) => set(p),
  applySnapshot: (s) =>
    set({
      wallet: { ...s.wallet },
      levels: { ...s.levels },
      seams: s.seams.map((x) => ({ ...x })),
      players: s.players.map((x) => ({ ...x })),
      orePerSec: s.orePerSec,
      quantumPoints: s.quantumPoints,
      snapshotAt: performance.now(),
      ready: true,
    }),
  addOre: (amount) => set((st) => ({ wallet: { ...st.wallet, ore: st.wallet.ore + amount } })),
  setPlayerHeat: (id, heat, lockedUntil) =>
    set((st) => ({
      players: st.players.map((p) => (p.id === id ? { ...p, heat, lockedUntil: lockedUntil ?? p.lockedUntil } : p)),
    })),
  replaceSeam: (oldId, newSeam, hit) =>
    set((st) => {
      let seams = st.seams;
      if (hit) seams = seams.map((x) => (x.id === hit.id ? { ...x, hp: x.hp - hit.dmg } : x));
      if (oldId != null) seams = seams.filter((x) => x.id !== oldId);
      if (newSeam && !seams.some((x) => x.id === newSeam.id)) seams = [...seams, { ...newSeam }];
      return { seams };
    }),
}));

export const selectMe = (st: GameStore): PlayerState | undefined => st.players.find((p) => p.id === st.playerId);
