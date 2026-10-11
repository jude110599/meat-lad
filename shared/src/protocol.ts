import type { NodeId, UpgradeId } from './economy.js';
import type { ResourceId } from './resources.js';
import type { CometOutcome, FundOutcome, LeapOutcome, OfflineGain, Reject, RoomState, StrikeOutcome, TickNote } from './sim.js';

/**
 * Wire protocol, shared by both transports:
 *   - PeerJS (WebRTC data channels): a player's browser hosts the room. This
 *     is what the live site uses, since GitHub Pages can't run a server.
 *   - Socket.io: the optional dedicated server in /server, one `msg` event.
 * Clients only ever send intents; the host resolves them and broadcasts.
 * Bump PROTOCOL_VERSION (and PEER_PREFIX) on any breaking change.
 */
export const PROTOCOL_VERSION = 3;
export const SERVER_TICK_HZ = 20;
export const SNAPSHOT_HZ = 10;
export const DEFAULT_PORT = 3001;
export const MAX_PLAYERS_PER_ROOM = 4;
export const PEER_PREFIX = 'starforge-v3-';

export interface Hello {
  t: 'hello';
  protocol: number;
  name: string;
  /** Stable per browser: the host gives a returning key its saved progress back. */
  key: string;
  /** Random per tab, so a second tab of the same browser joins as its own crewmate. */
  tab?: string;
}

export type ClientMsg =
  | Hello
  | { t: 'strike'; seq: number; seamId: number | null }
  /** Buy up to `count` levels (default 1, at most 1000) as far as the wallet allows. */
  | { t: 'buy'; id: UpgradeId; count?: number }
  /** Put `amount` of your own `res` into a Forge Tree node. */
  | { t: 'fund'; node: NodeId; res: ResourceId; amount: number }
  | { t: 'leap' }
  | { t: 'comet'; id: number }
  | { t: 'ping'; id: string }
  | { t: 'emote'; id: string };

/** Short-lived things that happened, for effects and toasts. */
export type Fx =
  | ({ k: 'strike'; seq: number } & StrikeOutcome)
  | { k: 'buy'; playerId: string; id: UpgradeId; level: number; count: number }
  | ({ k: 'fund' } & FundOutcome)
  | ({ k: 'leap' } & LeapOutcome)
  | ({ k: 'comet' } & CometOutcome)
  | ({ k: 'offline'; playerId: string } & OfflineGain)
  | { k: 'reject'; playerId: string; seq: number; reason: Reject }
  | { k: 'joined'; playerId: string; name: string }
  | { k: 'left'; playerId: string; name: string }
  | { k: 'emote'; playerId: string; id: string }
  | { k: 'note'; note: TickNote };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; code: string; state: RoomState }
  | { t: 'snap'; state: RoomState }
  | { t: 'fx'; fx: Fx[] }
  | { t: 'error'; error: 'protocol-mismatch' | 'room-full' | 'room-not-found' | 'host-left' };
