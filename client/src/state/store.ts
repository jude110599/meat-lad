import { create } from 'zustand';
import type { NodeId, OfflineGain, PlayerState, RoomState } from '@starforge/shared';

export type SessionMode = 'solo' | 'host' | 'guest' | 'server';
export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export type Tab = 'upgrades' | 'tree' | 'crew' | 'menu';
/** Local save slots (session.ts keeps one world per slot). */
export type Slot = 1 | 2 | 3;
export type BuyMode = 1 | 10 | 'max';
export type Tone = 'info' | 'good' | 'bad' | 'event';

export interface Toast {
  id: number;
  text: string;
  tone: Tone;
}

/** Layout the 3D camera keeps clear of: the side panel on wide screens, the sheet on phones. */
export const WIDE_MIN_PX = 900;
export const PANEL_PX = 380;
export const SHEET_FRAC = 0.52;

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
  s: RoomState | null;
  /** performance.now() when `s` last arrived, for smooth counters. */
  snapAt: number;
  /** Host clock minus local clock, so timers line up for guests. */
  skew: number;
  tab: Tab;
  /** Phones: is the bottom sheet open? (Wide screens always show the panel.) */
  sheet: boolean;
  /** Forge Tree node whose details are open. */
  node: NodeId | null;
  buyMode: BuyMode;
  toasts: Toast[];
  /** Earnings while away, shown once on return. */
  offline: OfflineGain | null;
  /** Set when my Quantum Leap lands, drives the warp animation. */
  leap: { cores: number; at: number } | null;
  /** Latest emote per player id. */
  emotes: Record<string, { id: string; at: number }>;
  /** The save slot solo play and hosting use. */
  slot: Slot;

  set(p: Partial<GameStore>): void;
  toast(text: string, tone?: Tone): void;
  /** Tap a tab: opens the sheet on it, or closes the sheet if it is already showing. */
  openTab(t: Tab): void;
}

let toastId = 0;

function initialSlot(): Slot {
  try {
    const n = Number(localStorage.getItem('starforge_slot'));
    if (n === 1 || n === 2 || n === 3) return n;
  } catch {
    /* storage unavailable */
  }
  return 1;
}

export const useGame = create<GameStore>((set, get) => ({
  screen: 'lobby',
  mode: null,
  code: null,
  net: 'idle',
  netError: null,
  me: '',
  name: '',
  s: null,
  snapAt: 0,
  skew: 0,
  tab: 'upgrades',
  sheet: false,
  node: null,
  buyMode: 1,
  toasts: [],
  offline: null,
  leap: null,
  emotes: {},
  slot: initialSlot(),

  set: (p) => set(p),
  toast: (text, tone = 'info') => {
    const t = { id: ++toastId, text, tone };
    set({ toasts: [...get().toasts.slice(-2), t] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), 3800);
  },
  openTab: (t) => {
    const st = get();
    if (st.sheet && st.tab === t) set({ sheet: false });
    else set({ tab: t, sheet: true, ...(st.tab !== t ? { node: null } : {}) });
  },
}));

/** The host's clock, for comparing against surge and comet deadlines. */
export const hostNow = (): number => Date.now() + useGame.getState().skew;

export const selectMe = (st: GameStore): PlayerState | undefined => (st.s ? st.s.players[st.me] : undefined);
export const selectOnline = (st: GameStore): PlayerState[] => (st.s ? Object.values(st.s.players).filter((p) => p.online) : []);
