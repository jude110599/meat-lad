import { MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION, SNAPSHOT_HZ, type ClientMsg, type Fx, type Hello, type ServerMsg } from './protocol.js';
import { CAM_HZ, cleanCam, type CamQ } from './protocol.js';
import { addPlayer, applyStrike, buyUpgrade, catchComet, dropPlayer, fundNode, leap, onlinePlayers, setPrefs, tickRoom, type Rand, type RoomState } from './sim.js';

/** Deliver a message to one player id, or '*' for everyone in the room. */
export type Send = (to: string, msg: ServerMsg) => void;

function randomId(n = 12): string {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < n; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/**
 * One authoritative room, independent of transport. The Socket.io server and
 * a hosting player's browser (PeerJS) both wrap this: they hand it intents
 * with `handle`, call `tick` on a timer, and deliver whatever it sends.
 */
export class RoomHost {
  private pending: Fx[] = [];
  /** Tab id each online player joined from. */
  private readonly tabs = new Map<string, string>();
  private lastTick = 0;
  private lastSnap = 0;
  /** Latest camera of each online player (see CamMsg), relayed at CAM_HZ. */
  private readonly cams = new Map<string, CamQ>();
  private camsDirty = false;
  private lastCams = 0;

  constructor(
    readonly state: RoomState,
    private readonly send: Send,
    /** Party code, echoed in the welcome. A browser host may change it before anyone joins. */
    public code: string,
    private readonly rand: Rand = Math.random,
  ) {}

  /** Admit a player. Returns their id, or an error for the transport to report. */
  join(hello: Hello, now = Date.now()): { playerId: string; welcome: ServerMsg } | { error: 'protocol-mismatch' | 'room-full' } {
    if (!hello || hello.protocol !== PROTOCOL_VERSION) return { error: 'protocol-mismatch' };
    let key = String(hello.key ?? '').slice(0, 40) || randomId(16);
    const tab = String(hello.tab ?? '').slice(0, 12);
    const find = () => Object.values(this.state.players).find((p) => p.key === key);
    let back = find();
    // The same browser in a second tab (a reconnecting tab keeps its player).
    if (back?.online && tab && this.tabs.get(back.id) !== tab) {
      key = `${key.slice(0, 27)}~${tab}`;
      back = find();
    }
    if (!back?.online && onlinePlayers(this.state).length >= MAX_PLAYERS_PER_ROOM) return { error: 'room-full' };
    const { player, offline } = addPlayer(this.state, back?.id ?? randomId(), key, String(hello.name ?? ''), now);
    if (tab) this.tabs.set(player.id, tab);
    this.emit({ k: 'joined', playerId: player.id, name: player.name });
    if (offline) this.emit({ k: 'offline', playerId: player.id, ...offline });
    return { playerId: player.id, welcome: { t: 'welcome', playerId: player.id, code: this.code, state: publicState(this.state) } };
  }

  leave(playerId: string, now = Date.now()): void {
    const p = this.state.players[playerId];
    if (!p || !p.online) return;
    dropPlayer(this.state, playerId, now);
    this.emit({ k: 'left', playerId, name: p.name });
    this.flush();
  }

  handle(playerId: string, msg: ClientMsg, now = Date.now()): void {
    const s = this.state;
    if (!msg || typeof msg !== 'object' || !s.players[playerId]?.online) return;
    switch (msg.t) {
      case 'strike': {
        const seq = Number(msg.seq) || 0;
        const out = applyStrike(s, playerId, num(msg.seamId), now, this.rand());
        if (typeof out === 'string') this.emit({ k: 'reject', playerId, seq, reason: out });
        else this.emit({ k: 'strike', seq, ...out });
        break;
      }
      case 'buy': {
        const want = Math.min(1000, Math.max(1, Math.floor(Number(msg.count) || 1)));
        const n = buyUpgrade(s, playerId, msg.id, want);
        if (typeof n === 'number') {
          this.emit({ k: 'buy', playerId, id: msg.id, level: s.players[playerId].levels[msg.id], count: n });
          this.snapNow(now);
        } else this.emit({ k: 'reject', playerId, seq: 0, reason: n });
        break;
      }
      case 'fund': {
        const out = fundNode(s, playerId, msg.node, msg.res, Number(msg.amount));
        if (typeof out === 'string') this.emit({ k: 'reject', playerId, seq: 0, reason: out });
        else {
          this.emit({ k: 'fund', ...out });
          this.snapNow(now);
        }
        break;
      }
      case 'leap': {
        const out = leap(s, playerId, now);
        if (typeof out === 'string') this.emit({ k: 'reject', playerId, seq: 0, reason: out });
        else {
          this.emit({ k: 'leap', ...out });
          this.snapNow(now);
        }
        break;
      }
      case 'prefs': {
        const out = setPrefs(s, playerId, msg.prefs, now);
        if (typeof out === 'string') this.emit({ k: 'reject', playerId, seq: 0, reason: out });
        else this.snapNow(now);
        break;
      }
      case 'comet': {
        const out = catchComet(s, playerId, Number(msg.id), now);
        if (typeof out !== 'string') {
          this.emit({ k: 'comet', ...out });
          this.snapNow(now);
        }
        break;
      }
      case 'cam': {
        const c = cleanCam(msg.c);
        if (c) {
          this.cams.set(playerId, c);
          this.camsDirty = true;
        }
        return;
      }
      case 'emote':
        this.emit({ k: 'emote', playerId, id: String(msg.id).slice(0, 12) });
        break;
      default:
        return;
    }
    this.flush();
  }

  /** Run the simulation; call this at SERVER_TICK_HZ. */
  tick(now = Date.now()): void {
    const dt = this.lastTick ? Math.min(1, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    for (const note of tickRoom(this.state, dt, now, this.rand)) this.emit({ k: 'note', note });
    if (now - this.lastSnap >= 1000 / SNAPSHOT_HZ) this.snapNow(now);
    this.relayCams(now);
    this.flush();
  }

  /**
   * Relay the crew's cameras: at CAM_HZ when one moved, every 2 s anyway (so a
   * late joiner gets them), and only while two or more players are online.
   */
  private relayCams(now: number): void {
    const since = now - this.lastCams;
    if (since < 1000 / CAM_HZ || (!this.camsDirty && since < 2000)) return;
    this.lastCams = now;
    this.camsDirty = false;
    const cams: Record<string, CamQ> = {};
    let n = 0;
    for (const [id, c] of this.cams) {
      if (this.state.players[id]?.online) {
        cams[id] = c;
        n++;
      } else this.cams.delete(id);
    }
    if (n > 0 && onlinePlayers(this.state).length >= 2) this.send('*', { t: 'cams', cams });
  }

  private snapNow(now = Date.now()): void {
    this.lastSnap = now;
    this.send('*', { t: 'snap', state: publicState(this.state) });
  }
  private emit(fx: Fx): void {
    this.pending.push(fx);
  }
  private flush(): void {
    if (!this.pending.length) return;
    const fx = this.pending;
    this.pending = [];
    this.send('*', { t: 'fx', fx });
  }
}

/** The room as crewmates see it: browser keys stay on the host, so nobody can sign in as someone else. */
function publicState(s: RoomState): RoomState {
  const players: RoomState['players'] = {};
  for (const [id, p] of Object.entries(s.players)) players[id] = { ...p, key: '' };
  return { ...s, players };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
