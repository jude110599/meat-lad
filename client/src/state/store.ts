import { create } from 'zustand';
import type { MachineId, PlayerState, Role, RoomState, Wallet } from '@starforge/shared';

export type SessionMode = 'solo' | 'host' | 'guest' | 'server';
export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export type Tab = 'mining' | 'refinery' | 'power' | 'quantum';
export type View = 'rock' | 'station';
export type Tone = 'info' | 'good' | 'bad' | 'event';

export interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

export interface Banner {
  title: string;
  text: string;
  tone: Tone;
  until: number;
}

/**
 * Client view of the game. `s` is a replica of the host's RoomState, replaced
 * on every snapshot; UI code never mutates it except for small predictions
 * (ore from a strike) that the next snapshot overwrites.
 */
export interface GameStore {
  screen: 'lobby' | 'game';
  mode: SessionMode | null;
  /** Party code while hosting or joined; null when solo. */
  code: string | null;
  net: NetStatus;
  netError: string | null;
  /** My player id inside the room. */
  me: string;
  name: string;
  role: Role;
  s: RoomState | null;
  /** performance.now() when `s` last arrived, for smooth counters. */
  snapAt: number;
  /** Host clock minus local clock, so timers line up for guests. */
  skew: number;
  tab: Tab;
  view: View;
  toasts: Toast[];
  banner: Banner | null;
  offline: { seconds: number; gained: Wallet } | null;
  /** Set when a Quantum Leap lands, drives the warp animation. */
  leap: { qp: number; at: number } | null;
  /** Latest emote per player id. */
  emotes: Record<string, { id: string; at: number }>;
  /** Machine most recently pressed, for button flashes. */
  lastPress: { machine: MachineId; at: number } | null;

  set(p: Partial<GameStore>): void;
  toast(text: string, tone?: Tone): void;
  showBanner(title: string, text: string, tone: Tone, ms?: number): void;
}

let toastId = 0;

export const useGame = create<GameStore>((set, get) => ({
  screen: 'lobby',
  mode: null,
  code: null,
  net: 'idle',
  netError: null,
  me: '',
  name: '',
  role: 'miner',
  s: null,
  snapAt: 0,
  skew: 0,
  tab: 'mining',
  view: 'rock',
  toasts: [],
  banner: null,
  offline: null,
  leap: null,
  emotes: {},
  lastPress: null,

  set: (p) => set(p),
  toast: (text, tone = 'info') => {
    const t = { id: ++toastId, text, tone };
    set({ toasts: [...get().toasts.slice(-4), t] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), 4200);
  },
  showBanner: (title, text, tone, ms = 6000) => set({ banner: { title, text, tone, until: Date.now() + ms } }),
}));

/** The host's clock, for comparing against event, buff and vote deadlines. */
export const hostNow = (): number => Date.now() + useGame.getState().skew;

export const selectMe = (st: GameStore): PlayerState | undefined => (st.s ? st.s.players[st.me] : undefined);
export const selectOnline = (st: GameStore): PlayerState[] => (st.s ? Object.values(st.s.players).filter((p) => p.online) : []);
