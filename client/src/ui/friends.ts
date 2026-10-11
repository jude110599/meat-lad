import { joinParty } from '../net/session';
import { WIDE_MIN_PX, useGame } from '../state/store';

interface FriendsApi {
  attach(opts: {
    game: string;
    dock?: 'bottom-left';
    party: () => { code: string } | null;
    join: (code: string) => boolean;
    visible?: () => boolean;
  }): void;
  me(): { name: string; email: string } | null;
}

declare global {
  interface Window {
    MLFriends?: FriendsApi;
  }
}

/**
 * The site-wide friends list (js/friends.js, loaded by index.html from the
 * site root). While a party is open it shows a mini list with Invite buttons;
 * a friend who accepts lands on starforge/?join=CODE.
 */
export function attachFriends(): void {
  window.MLFriends?.attach({
    game: 'starforge',
    dock: 'bottom-left',
    party: () => {
      const st = useGame.getState();
      return st.code && st.mode !== 'solo' && st.net === 'open' ? { code: st.code } : null;
    },
    join: (code) => {
      joinParty(code);
      return true;
    },
    // On phones the open sheet needs the whole bottom of the screen.
    visible: () => innerWidth >= WIDE_MIN_PX || !useGame.getState().sheet,
  });
}

/** The signed-in player's name from the main site, if any. */
export const friendsName = (): string | null => window.MLFriends?.me()?.name ?? null;
