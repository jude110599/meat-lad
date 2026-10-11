import { randomBytes, randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  SERVER_TICK_HZ,
  SNAPSHOT_HZ,
  addPlayer,
  applyStrike,
  buyUpgrade,
  createRoomState,
  globalMult,
  passiveOrePerSec,
  tickRoom,
  type ClientToServerEvents,
  type RoomState,
  type Role,
  type ServerToClientEvents,
  type Snapshot,
} from '@starforge/shared';
import type { ProgressStore } from '../persistence/Store.js';

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const SAVE_EVERY_TICKS = SERVER_TICK_HZ * 30;

/**
 * One co-op expedition. Owns the authoritative RoomState, runs the fixed
 * 20 Hz simulation tick and fans out 10 Hz snapshots to its Socket.io room.
 */
export class Room {
  readonly state: RoomState;
  /** resumeToken -> playerId, so a dropped client can reclaim its slot. */
  private readonly tokens = new Map<string, string>();
  private readonly online = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private lastTickAt = Date.now();

  constructor(
    readonly code: string,
    private readonly io: GameServer,
    private readonly store: ProgressStore,
    seed = randomInt(1, 2 ** 31 - 1),
  ) {
    this.state = createRoomState(seed);
  }

  get size(): number {
    return this.online.size;
  }

  start(): void {
    const ticksPerSnapshot = SERVER_TICK_HZ / SNAPSHOT_HZ;
    this.timer = setInterval(() => {
      const now = Date.now();
      const dt = (now - this.lastTickAt) / 1000;
      this.lastTickAt = now;
      tickRoom(this.state, dt, now);
      if (this.state.tick % ticksPerSnapshot === 0) this.io.to(this.code).emit('snapshot', this.snapshot());
      if (this.state.tick % SAVE_EVERY_TICKS === 0) void this.store.saveRoom(this.code, this.state);
    }, 1000 / SERVER_TICK_HZ);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.store.saveRoom(this.code, this.state);
  }

  join(socket: GameSocket, name: string, role: Role, resumeToken?: string) {
    let playerId = resumeToken ? this.tokens.get(resumeToken) : undefined;
    let token = resumeToken;
    if (!playerId || !this.state.players[playerId]) {
      playerId = randomBytes(6).toString('hex');
      token = randomBytes(16).toString('hex');
      this.tokens.set(token, playerId);
      addPlayer(this.state, playerId, name.slice(0, 24) || 'Prospector', role);
    }
    this.online.add(playerId);
    void socket.join(this.code);
    socket.to(this.code).emit('player:joined', this.state.players[playerId]);

    const id = playerId;
    socket.on('mine:strike', (p) => {
      if (!p || typeof p.seq !== 'number') return;
      const seamId = typeof p.seamId === 'number' ? p.seamId : null;
      const out = applyStrike(this.state, id, seamId, Date.now(), Math.random());
      if (typeof out === 'string') socket.emit('mine:reject', { seq: p.seq, reason: out });
      else this.io.to(this.code).emit('mine:result', { ...out, seq: p.seq });
    });
    socket.on('shop:buy', (p) => {
      if (p && buyUpgrade(this.state, p.id)) this.io.to(this.code).emit('snapshot', this.snapshot());
    });
    socket.on('disconnect', () => {
      this.online.delete(id);
      this.io.to(this.code).emit('player:left', { id });
    });

    return { playerId: id, resumeToken: token!, seed: this.state.seed, snapshot: this.snapshot() };
  }

  snapshot(): Snapshot {
    const s = this.state;
    return {
      tick: s.tick,
      serverTime: Date.now(),
      wallet: s.wallet,
      levels: s.levels,
      seams: s.seams,
      players: Object.values(s.players).filter((p) => this.online.has(p.id)),
      quantumPoints: s.quantumPoints,
      orePerSec: passiveOrePerSec(s.levels, globalMult(s)),
    };
  }
}
