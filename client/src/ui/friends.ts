import { useSyncExternalStore } from 'react';
import { joinParty } from '../net/session';
import { useGame } from '../state/store';

/** One friend as js/friends.js reports it (MLFriends.state()). */
export interface FriendRow {
  entry: string;
  name: string;
  /** "in a Starforge party", "online · on the menu", "offline · seen 5m ago"… */
  status: string;
  online: boolean;
  avatar: string;
  /** Has an account on the site we could find. */
  known: boolean;
  /** Their open party, if they are online in one. */
  party: { game: string; code: string } | null;
  /** In the party I have open. */
  here: boolean;
  /** I invited them in the last 20 s. */
  invited: boolean;
  /** My pending request to join them. */
  requested: boolean;
}

export interface FriendsState {
  status: 'loading' | 'in' | 'out' | 'error';
  error: string;
  me: { name: string; email: string } | null;
  friends: FriendRow[];
  /** Friends asking to join the party I have open. */
  asks: { id: string; name: string; ts: number }[];
  /** My own request to join a friend's party, while it waits for an answer. */
  pending: { name: string; entry: string; ts: number } | null;
  party: string | null;
}

interface FriendsApi {
  attach(opts: {
    game: string;
    dock?: 'bottom-left' | 'none';
    party: () => { code: string } | null;
    join: (code: string) => boolean;
    visible?: () => boolean;
  }): void;
  me(): { name: string; email: string } | null;
  state?(): FriendsState;
  onChange?(fn: () => void): () => void;
  invite?(entry: string): Promise<boolean>;
  requestJoin?(entry: string): Promise<string>;
  cancelJoin?(): void;
  answerJoin?(id: string, yes: boolean): void;
}

declare global {
  interface Window {
    MLFriends?: FriendsApi;
  }
}

const api = (): FriendsApi | undefined => window.MLFriends;

/**
 * The site-wide friends list (js/friends.js, loaded by index.html from the
 * site root). Starforge draws the list itself (Crew tab and the lobby's Join
 * page), so the script's own floating mini list is turned off; its invite
 * pop-ups still appear, and a friend who accepts lands on starforge/?join=CODE.
 */
export function attachFriends(): void {
  api()?.attach({
    game: 'starforge',
    dock: 'none',
    party: () => {
      const st = useGame.getState();
      return st.code && st.mode !== 'solo' && st.net === 'open' ? { code: st.code } : null;
    },
    join: (code) => {
      joinParty(code);
      return true;
    },
  });
}

/** The signed-in player's name from the main site, if any. */
export const friendsName = (): string | null => api()?.me()?.name ?? null;

/* ---------- a React view of MLFriends.state() ---------- */

const EMPTY: FriendsState = { status: 'loading', error: '', me: null, friends: [], asks: [], pending: null, party: null };
let snap: FriendsState = EMPTY;
let snapKey = '';
const subs = new Set<() => void>();
let unhook: (() => void) | null = null;

function refresh(): void {
  const next = api()?.state?.() ?? EMPTY;
  const key = JSON.stringify(next);
  if (key === snapKey) return;
  snapKey = key;
  snap = next;
  subs.forEach((f) => f());
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  if (!unhook) {
    const off = api()?.onChange?.(refresh);
    // A slow friends.js load, and the "seen 5m ago" / "Sent" timers, still show up.
    const t = setInterval(refresh, 2000);
    unhook = () => {
      off?.();
      clearInterval(t);
    };
    refresh();
  }
  return () => {
    subs.delete(fn);
    if (!subs.size && unhook) {
      unhook();
      unhook = null;
    }
  };
}

export function useFriends(): FriendsState {
  return useSyncExternalStore(subscribe, () => snap);
}

export const friendsApi = {
  invite: (entry: string): Promise<boolean> => api()?.invite?.(entry) ?? Promise.resolve(false),
  requestJoin: (entry: string): Promise<string> => api()?.requestJoin?.(entry) ?? Promise.resolve('Friends are unavailable right now.'),
  cancelJoin: (): void => api()?.cancelJoin?.(),
  answerJoin: (id: string, yes: boolean): void => api()?.answerJoin?.(id, yes),
};
