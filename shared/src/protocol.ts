import type { MachineId, OverclockId, SkillId, UpgradeId } from './economy.js';
import type { PressOutcome, Reject, Role, RoomState, StabilizeOutcome, StrikeOutcome, TickNote } from './sim.js';

/**
 * Wire protocol, shared by both transports:
 *   - PeerJS (WebRTC data channels): a player's browser hosts the room. This
 *     is what the live site uses, since GitHub Pages can't run a server.
 *   - Socket.io: the optional dedicated server in /server, one `msg` event.
 * Clients only ever send intents; the host resolves them and broadcasts.
 * Bump PROTOCOL_VERSION on any breaking change to these shapes.
 */
export const PROTOCOL_VERSION = 2;
export const SERVER_TICK_HZ = 20;
export const SNAPSHOT_HZ = 10;
export const DEFAULT_PORT = 3001;
export const MAX_PLAYERS_PER_ROOM = 4;
export const PEER_PREFIX = 'starforge-v2-';

export interface Hello {
  t: 'hello';
  protocol: number;
  name: string;
  role: Role;
  /** Reconnect token from a previous welcome, to reclaim the same player slot. */
  resume?: string;
}

export type ClientMsg =
  | Hello
  | { t: 'strike'; seq: number; seamId: number | null; nodeId: number | null }
  | { t: 'press'; seq: number; machine: MachineId }
  /** Buy up to `count` levels (default 1, at most 100) as far as the wallet allows. */
  | { t: 'buy'; id: UpgradeId; count?: number }
  | { t: 'skill'; id: SkillId }
  | { t: 'toggle'; machine: MachineId; on: boolean }
  | { t: 'overclock'; id: OverclockId }
  | { t: 'role'; role: Role }
  | { t: 'stabilize' }
  | { t: 'shield' }
  | { t: 'leap' }
  | { t: 'vote'; yes: boolean }
  | { t: 'ping'; id: string }
  | { t: 'emote'; id: string };

/** Short-lived things that happened, for effects and toasts. */
export type Fx =
  | ({ k: 'strike'; seq: number } & StrikeOutcome)
  | ({ k: 'press'; seq: number } & PressOutcome)
  | ({ k: 'stabilize' } & StabilizeOutcome)
  | { k: 'shield'; playerId: string; shield: number }
  | { k: 'overclock'; playerId: string; id: OverclockId }
  | { k: 'buy'; playerId: string; id: UpgradeId; level: number }
  | { k: 'skill'; playerId: string; id: SkillId }
  | { k: 'reject'; playerId: string; seq: number; reason: Reject }
  | { k: 'joined'; playerId: string; name: string }
  | { k: 'left'; playerId: string; name: string }
  | { k: 'vote'; playerId: string }
  | { k: 'emote'; playerId: string; id: string }
  | { k: 'note'; note: TickNote };

export type ServerMsg =
  | { t: 'welcome'; playerId: string; resume: string; code: string; state: RoomState }
  | { t: 'snap'; state: RoomState }
  | { t: 'fx'; fx: Fx[] }
  | { t: 'error'; error: 'protocol-mismatch' | 'room-full' | 'room-not-found' | 'host-left' };
