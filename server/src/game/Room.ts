import { randomInt } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import {
  RoomHost,
  SERVER_TICK_HZ,
  createRoomState,
  onlinePlayers,
  type ClientMsg,
  type Hello,
  type RoomState,
  type ServerMsg,
} from '@starforge/shared';
import type { ProgressStore } from '../persistence/Store.js';

/** Socket.io events: one `hello` to join, then `msg` both ways. */
export interface ClientToServer {
  hello: (h: Hello & { room?: string }) => void;
  msg: (m: ClientMsg) => void;
}
export interface ServerToClient {
  msg: (m: ServerMsg) => void;
}
export type GameServer = Server<ClientToServer, ServerToClient>;
export type GameSocket = Socket<ClientToServer, ServerToClient>;

const SAVE_EVERY_MS = 30_000;

/**
 * One co-op expedition on the dedicated server. The rules and the protocol
 * live in RoomHost (shared with the in-browser PeerJS host); this class only
 * maps Socket.io connections onto it and runs the tick timer.
 */
export class Room {
  readonly host: RoomHost;
  private timer: NodeJS.Timeout | null = null;
  private lastSave = Date.now();

  constructor(
    readonly code: string,
    private readonly io: GameServer,
    private readonly store: ProgressStore,
    state: RoomState = createRoomState(randomInt(1, 2 ** 31 - 1)),
  ) {
    this.host = new RoomHost(state, (to, msg) => this.deliver(to, msg), code);
  }

  get size(): number {
    return onlinePlayers(this.host.state).length;
  }

  start(): void {
    this.timer = setInterval(() => {
      const now = Date.now();
      this.host.tick(now);
      if (now - this.lastSave > SAVE_EVERY_MS) {
        this.lastSave = now;
        void this.store.saveRoom(this.code, this.host.state);
      }
    }, 1000 / SERVER_TICK_HZ);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.store.saveRoom(this.code, this.host.state);
  }

  /** Admit a socket. Returns false if the room refused it. */
  join(socket: GameSocket, hello: Hello): boolean {
    const r = this.host.join(hello);
    if ('error' in r) {
      socket.emit('msg', { t: 'error', error: r.error });
      return false;
    }
    const id = r.playerId;
    void socket.join(this.code);
    void socket.join(`p:${id}`);
    socket.emit('msg', r.welcome);
    socket.on('msg', (m) => this.host.handle(id, m));
    socket.on('disconnect', () => this.host.leave(id));
    return true;
  }

  private deliver(to: string, msg: ServerMsg): void {
    if (to === '*') this.io.to(this.code).emit('msg', msg);
    else this.io.to(`p:${to}`).emit('msg', msg);
  }
}
