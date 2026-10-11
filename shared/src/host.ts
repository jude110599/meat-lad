import { MACHINES, type MachineId } from './economy.js';
import { MAX_PLAYERS_PER_ROOM, PROTOCOL_VERSION, SNAPSHOT_HZ, type ClientMsg, type Fx, type Hello, type ServerMsg } from './protocol.js';
import {
  addPlayer,
  applyPress,
  applyStrike,
  buySkill,
  buyUpgrade,
  castVote,
  onlinePlayers,
  overclock,
  proposeLeap,
  setRole,
  shieldPress,
  stabilize,
  tickRoom,
  toggleMachine,
  type Rand,
  type RoomState,
} from './sim.js';

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
  private readonly tokens = new Map<string, string>();
  private pending: Fx[] = [];
  private lastTick = 0;
  private lastSnap = 0;

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
    let id = hello.resume ? this.tokens.get(hello.resume) : undefined;
    let resume = hello.resume ?? '';
    if (!id || !this.state.players[id]) {
      if (onlinePlayers(this.state).length >= MAX_PLAYERS_PER_ROOM) return { error: 'room-full' };
      id = randomId();
      resume = randomId(24);
      this.tokens.set(resume, id);
    }
    const role = hello.role === 'refiner' ? 'refiner' : 'miner';
    const p = addPlayer(this.state, id, String(hello.name ?? '').slice(0, 16), role);
    p.lastActAt = now;
    this.emit({ k: 'joined', playerId: id, name: p.name });
    return { playerId: id, welcome: { t: 'welcome', playerId: id, resume, code: this.code, state: this.state } };
  }

  /** Register the host's own player without a handshake. */
  joinLocal(id: string, name: string, role: 'miner' | 'refiner'): void {
    addPlayer(this.state, id, name, role);
  }

  leave(playerId: string): void {
    const p = this.state.players[playerId];
    if (!p || !p.online) return;
    p.online = false;
    this.emit({ k: 'left', playerId, name: p.name });
    if (this.state.vote) {
      this.state.vote.yes = this.state.vote.yes.filter((x) => x !== playerId);
      this.state.vote.no = this.state.vote.no.filter((x) => x !== playerId);
    }
  }

  handle(playerId: string, msg: ClientMsg, now = Date.now()): void {
    const s = this.state;
    if (!msg || typeof msg !== 'object' || !s.players[playerId]) return;
    switch (msg.t) {
      case 'strike': {
        const seq = Number(msg.seq) || 0;
        const out = applyStrike(s, playerId, { seamId: num(msg.seamId), nodeId: num(msg.nodeId) }, now, this.rand());
        if (typeof out === 'string') this.emit({ k: 'reject', playerId, seq, reason: out });
        else this.emit({ k: 'strike', seq, ...out });
        break;
      }
      case 'press': {
        const seq = Number(msg.seq) || 0;
        if (!MACHINES.includes(msg.machine)) return;
        const out = applyPress(s, playerId, msg.machine as MachineId, now);
        if (typeof out === 'string') this.emit({ k: 'reject', playerId, seq, reason: out });
        else this.emit({ k: 'press', seq, ...out });
        break;
      }
      case 'buy': {
        const want = Math.min(100, Math.max(1, Math.floor(Number(msg.count) || 1)));
        let n = 0;
        while (n < want && buyUpgrade(s, msg.id)) n++;
        if (n) {
          this.emit({ k: 'buy', playerId, id: msg.id, level: s.levels[msg.id] });
          this.snapNow(now);
        }
        break;
      }
      case 'skill':
        if (buySkill(s, msg.id)) {
          this.emit({ k: 'skill', playerId, id: msg.id });
          this.snapNow(now);
        }
        break;
      case 'toggle':
        if (toggleMachine(s, msg.machine, msg.on)) this.snapNow(now);
        break;
      case 'role':
        if (setRole(s, playerId, msg.role)) this.snapNow(now);
        break;
      case 'overclock': {
        const r = overclock(s, playerId, msg.id, now);
        if (r === true) {
          this.emit({ k: 'overclock', playerId, id: msg.id });
          this.snapNow(now);
        } else this.emit({ k: 'reject', playerId, seq: 0, reason: r });
        break;
      }
      case 'stabilize': {
        const r = stabilize(s, playerId, now);
        if (typeof r !== 'string') this.emit({ k: 'stabilize', ...r });
        break;
      }
      case 'shield': {
        const r = shieldPress(s, playerId, now);
        if (typeof r === 'number') this.emit({ k: 'shield', playerId, shield: r });
        break;
      }
      case 'leap':
        if (proposeLeap(s, playerId, now)) {
          this.emit({ k: 'vote', playerId });
          this.snapNow(now);
        }
        break;
      case 'vote':
        if (castVote(s, playerId, !!msg.yes)) this.snapNow(now);
        break;
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
    this.flush();
  }

  private snapNow(now = Date.now()): void {
    this.lastSnap = now;
    this.send('*', { t: 'snap', state: this.state });
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

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
