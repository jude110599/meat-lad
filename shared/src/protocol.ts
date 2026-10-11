import type { UpgradeId, UpgradeLevels } from './economy.js';
import type { Wallet } from './resources.js';
import type { PlayerState, Role, Seam, StrikeOutcome, StrikeReject } from './sim.js';

/**
 * Socket.io wire protocol. Clients only ever send *intents*; the server
 * resolves them against the authoritative RoomState and broadcasts results.
 * Bump PROTOCOL_VERSION on any breaking change to these shapes.
 */
export const PROTOCOL_VERSION = 1;
export const SERVER_TICK_HZ = 20;
export const SNAPSHOT_HZ = 10;
export const DEFAULT_PORT = 3001;
export const MAX_PLAYERS_PER_ROOM = 4;

export interface HelloPayload {
  protocol: number;
  name: string;
  role: Role;
  /** Room code to join; omitted to create a new room. */
  room?: string;
  /** Reconnect token from a previous `welcome`, to reclaim the same player slot. */
  resumeToken?: string;
}

export interface StrikeIntent {
  /** Client sequence number, echoed back so the client can match predictions. */
  seq: number;
  seamId: number | null;
}

/** Full room view sent on join and periodically thereafter. */
export interface Snapshot {
  tick: number;
  serverTime: number;
  wallet: Wallet;
  levels: UpgradeLevels;
  seams: Seam[];
  players: PlayerState[];
  quantumPoints: number;
  orePerSec: number;
}

export interface Welcome {
  room: string;
  playerId: string;
  resumeToken: string;
  seed: number;
  snapshot: Snapshot;
}

export interface ClientToServerEvents {
  hello: (p: HelloPayload, ack: (r: Welcome | { error: string }) => void) => void;
  'mine:strike': (p: StrikeIntent) => void;
  'shop:buy': (p: { id: UpgradeId }) => void;
  ping: (clientTime: number, ack: (serverTime: number) => void) => void;
}

export interface ServerToClientEvents {
  snapshot: (s: Snapshot) => void;
  'mine:result': (r: StrikeOutcome & { seq: number }) => void;
  'mine:reject': (r: { seq: number; reason: StrikeReject }) => void;
  'player:joined': (p: PlayerState) => void;
  'player:left': (p: { id: string }) => void;
}
