import type { NodeId, UpgradeId } from './economy.js';
import type { ResourceId } from './resources.js';
import type { CometOutcome, FundOutcome, LeapOutcome, OfflineGain, Prefs, Reject, RoomState, StrikeOutcome, TickNote } from './sim.js';

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
  /** Change your crew role (needs Crew Charter, 2 min cooldown), Foreman auto-buy or Refinery switch. */
  | { t: 'prefs'; prefs: Prefs }
  | { t: 'comet'; id: number }
  | { t: 'ping'; id: string }
  /** Where this player's camera is (see CamMsg below). */
  | CamMsg
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
  /** Every online crewmate's camera (see CamsMsg below). */
  | CamsMsg
  | { t: 'error'; error: 'protocol-mismatch' | 'room-full' | 'room-not-found' | 'host-left' };

/* ---------- Crew cameras ---------- */

/**
 * Each client reports where its camera is at most CAM_HZ times a second (and
 * only when it moved), and the host relays the crew's latest cameras at the
 * same rate, so a crewmate's ship can hover where that player is looking from.
 * Both are optional: an older client never sends one and simply ignores
 * `cams`. About 40 bytes up per change and ~50 bytes per crewmate down.
 */
export const CAM_HZ = 4;
/** Quantisation: position in 1/CAM_POS_Q world units, view direction in 1/CAM_DIR_Q. */
export const CAM_POS_Q = 100;
export const CAM_DIR_Q = 1000;
/** Furthest a reported camera may sit from the planet's centre, in world units. */
export const CAM_MAX_DIST = 60;

/** Quantised camera: [px, py, pz, dx, dy, dz] as integers (see packCam). */
export type CamQ = [number, number, number, number, number, number];
export interface CamMsg {
  t: 'cam';
  c: CamQ;
}
export interface CamsMsg {
  t: 'cams';
  /** Player id to that player's latest camera. */
  cams: Record<string, CamQ>;
}

/** Quantise a camera position and view direction for the wire. Returns null for a non-finite camera. */
export function packCam(px: number, py: number, pz: number, dx: number, dy: number, dz: number): CamQ | null {
  const dl = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(px + py + pz) || !(dl > 1e-9) || !Number.isFinite(dl)) return null;
  const pl = Math.hypot(px, py, pz);
  const k = pl > CAM_MAX_DIST ? CAM_MAX_DIST / pl : 1;
  return [
    Math.round(px * k * CAM_POS_Q),
    Math.round(py * k * CAM_POS_Q),
    Math.round(pz * k * CAM_POS_Q),
    Math.round((dx / dl) * CAM_DIR_Q),
    Math.round((dy / dl) * CAM_DIR_Q),
    Math.round((dz / dl) * CAM_DIR_Q),
  ];
}

/**
 * Check a quantised camera from the wire: six finite numbers, position
 * within CAM_MAX_DIST, a usable direction. Returns a clean integer copy or null.
 */
export function cleanCam(c: unknown): CamQ | null {
  if (!Array.isArray(c) || c.length !== 6) return null;
  const v = c.map((x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : NaN));
  if (v.some((x) => Number.isNaN(x))) return null;
  return packCam(v[0] / CAM_POS_Q, v[1] / CAM_POS_Q, v[2] / CAM_POS_Q, v[3], v[4], v[5]);
}

/** Decode a quantised camera into a world position and a unit view direction (written into `pos` and `dir`). */
export function unpackCam(c: CamQ, pos: [number, number, number], dir: [number, number, number]): boolean {
  const ok = cleanCam(c);
  if (!ok) return false;
  pos[0] = ok[0] / CAM_POS_Q;
  pos[1] = ok[1] / CAM_POS_Q;
  pos[2] = ok[2] / CAM_POS_Q;
  const l = Math.hypot(ok[3], ok[4], ok[5]);
  if (!(l > 0)) return false;
  dir[0] = ok[3] / l;
  dir[1] = ok[4] / l;
  dir[2] = ok[5] / l;
  return true;
}
