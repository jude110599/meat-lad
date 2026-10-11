import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import { io, type Socket } from 'socket.io-client';
import {
  PEER_PREFIX,
  PROTOCOL_VERSION,
  RoomHost,
  SAVE_KEY,
  SERVER_TICK_HZ,
  applyOffline,
  createRoomState,
  fromSave,
  startEvent,
  toSave,
  type ClientMsg,
  type Hello,
  type Role,
  type RoomState,
  type ServerMsg,
} from '@starforge/shared';
import { useGame } from '../state/store';
import { setLink, type Link } from './actions';
import { onServerMsg } from './dispatch';

/**
 * Sessions. Every mode runs the same RoomHost rules somewhere:
 *   solo   the room runs in this tab, saved to localStorage.
 *   host   the same, plus a PeerJS id other browsers connect to by party code.
 *   guest  this tab sends intents to a host's browser over WebRTC.
 *   server (optional) a dedicated Socket.io host, when VITE_SERVER_URL is set.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SERVER_URL = import.meta.env.VITE_SERVER_URL as string | undefined;

export function newCode(): string {
  let c = '';
  for (let i = 0; i < 5; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return c;
}

/** PeerJS signalling: the public PeerJS cloud by default; `?peer=host:port` overrides it for local testing. */
function peerOptions(): PeerOptions {
  const o: PeerOptions = { debug: 0 };
  const q = new URLSearchParams(location.search).get('peer') ?? (import.meta.env.VITE_PEER_HOST as string | undefined);
  if (q) {
    const [host, port] = q.split(':');
    Object.assign(o, { host, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:' && host !== 'localhost' });
  }
  return o;
}

function ls(key: string, value?: string): string | null {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  return null;
}
function ss(key: string, value?: string): string | null {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function loadSave(): { state: RoomState; savedAt: number } | null {
  const raw = ls(SAVE_KEY);
  if (!raw) return null;
  try {
    const f = JSON.parse(raw);
    const state = fromSave(f);
    return state ? { state, savedAt: Number(f.savedAt) || Date.now() } : null;
  } catch {
    return null;
  }
}

function hello(): Hello {
  const st = useGame.getState();
  return { t: 'hello', protocol: PROTOCOL_VERSION, name: st.name || 'Prospector', role: st.role };
}

let current: { close(): void } | null = null;

/* ---------------- this tab hosts the room (solo or party host) ---------------- */

class LocalRoom implements Link {
  readonly host: RoomHost;
  private readonly me: string;
  private peer: Peer | null = null;
  private readonly conns = new Map<string, DataConnection>();
  private readonly timers: number[] = [];
  private simAt = Date.now();
  private closed = false;

  constructor(state: RoomState) {
    this.host = new RoomHost(state, (to, m) => this.deliver(to, m), newCode());
    const r = this.host.join(hello());
    if ('error' in r) throw new Error(r.error);
    this.me = r.playerId;
    onServerMsg(structuredClone(r.welcome));
    this.timers.push(window.setInterval(() => this.tick(), 1000 / SERVER_TICK_HZ));
    // ?sfdebug exposes the room for automated tests (a host can edit its own save anyway).
    if (new URLSearchParams(location.search).has('sfdebug')) {
      Object.assign(window, { __sf: { host: this.host, store: useGame, event: (k: 'quake' | 'flare') => startEvent(this.host.state, k, Date.now(), Math.random) } });
    }
    this.timers.push(window.setInterval(() => this.save(), 10000));
    addEventListener('pagehide', this.save);
    document.addEventListener('visibilitychange', this.onVis);
  }

  send(msg: ClientMsg): void {
    this.host.handle(this.me, msg);
  }

  /** Background tabs throttle timers; catch the simulation up in 1 s steps. */
  private tick(): void {
    const now = Date.now();
    let steps = 0;
    while (now - this.simAt > 1000 && steps++ < 300) {
      this.simAt += 1000;
      this.host.tick(this.simAt);
    }
    this.simAt = now;
    this.host.tick(now);
  }

  private onVis = (): void => {
    if (document.visibilityState === 'hidden') this.save();
  };

  save = (): void => {
    if (!this.closed) ls(SAVE_KEY, JSON.stringify(toSave(this.host.state)));
  };

  private deliver(to: string, m: ServerMsg): void {
    if (to === '*' || to === this.me) {
      // RoomHost hands out live references; the UI needs its own copy.
      onServerMsg(m.t === 'snap' || m.t === 'welcome' || m.t === 'fx' ? structuredClone(m) : m);
    }
    if (to === '*') {
      for (const c of this.conns.values()) if (c.open) c.send(m);
    } else if (to !== this.me) {
      const c = this.conns.get(to);
      if (c?.open) c.send(m);
    }
  }

  /** Become reachable at a party code. */
  openParty(): void {
    if (this.peer) return;
    const st = useGame.getState();
    st.set({ net: 'connecting', netError: null });
    const peer = new Peer(PEER_PREFIX + this.host.code, peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer) return;
      useGame.getState().set({ mode: 'host', code: this.host.code, net: 'open' });
      useGame.getState().toast(`Party open. Code ${this.host.code}`, 'good');
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('disconnected', () => {
      if (this.peer === peer && !peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (e) => {
      if (this.peer !== peer) return;
      if (e.type === 'unavailable-id') {
        // Someone else has this code; take another one.
        peer.destroy();
        this.peer = null;
        this.host.code = newCode();
        this.openParty();
        return;
      }
      if (e.type === 'peer-unavailable') return;
      if (!peer.open) {
        peer.destroy();
        this.peer = null;
        useGame.getState().set({ net: 'idle', netError: 'Could not reach the party service. Check your connection and try again.' });
      }
    });
  }

  private accept(conn: DataConnection): void {
    let pid: string | null = null;
    conn.on('data', (raw) => {
      const m = raw as ClientMsg;
      if (!m || typeof m !== 'object') return;
      if (!pid) {
        if (m.t !== 'hello') return;
        const r = this.host.join(m);
        if ('error' in r) {
          conn.send({ t: 'error', error: r.error } satisfies ServerMsg);
          setTimeout(() => conn.close(), 400);
          return;
        }
        pid = r.playerId;
        // A reconnecting guest replaces its old channel; swap first so the old one's close is ignored.
        const old = this.conns.get(pid);
        this.conns.set(pid, conn);
        if (old && old !== conn) old.close();
        conn.send(r.welcome);
        return;
      }
      this.host.handle(pid, m);
    });
    const gone = () => {
      if (pid && this.conns.get(pid) === conn) {
        this.conns.delete(pid);
        this.host.leave(pid);
      }
    };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  closeParty(): void {
    for (const [pid, c] of this.conns) {
      if (c.open) c.send({ t: 'error', error: 'host-left' } satisfies ServerMsg);
      this.host.leave(pid);
    }
    const conns = [...this.conns.values()];
    this.conns.clear();
    setTimeout(() => conns.forEach((c) => c.close()), 300);
    this.peer?.destroy();
    this.peer = null;
    useGame.getState().set({ mode: 'solo', code: null, net: 'idle' });
  }

  close(): void {
    this.save();
    if (this.peer) this.closeParty();
    this.closed = true;
    this.timers.forEach(clearInterval);
    removeEventListener('pagehide', this.save);
    document.removeEventListener('visibilitychange', this.onVis);
  }
}

/* ---------------- this tab joins someone else's room ---------------- */

const GUEST_TIMEOUT_MS = 15000;

class GuestLink implements Link {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private closed = false;
  private retries = 0;
  private welcomed = false;

  constructor(
    readonly code: string,
    private readonly onFail: (why: string) => void,
  ) {
    useGame.getState().set({ mode: 'guest', code, net: 'connecting', netError: null });
    this.peer = new Peer(peerOptions());
    this.peer.once('open', () => this.dial());
    this.peer.on('error', (e) => {
      if (this.closed) return;
      if (e.type === 'peer-unavailable') this.fail(`No party is open with code ${code}. Check the code with your friend.`);
      else if (!this.welcomed) this.fail('Could not reach the party service. Check your connection and try again.');
    });
    setTimeout(() => {
      if (!this.welcomed && !this.closed) this.fail('The host did not answer. They may have closed the game.');
    }, GUEST_TIMEOUT_MS);
  }

  private dial(): void {
    if (!this.peer || this.closed) return;
    const conn = this.peer.connect(PEER_PREFIX + this.code, { serialization: 'json', reliable: true });
    this.conn = conn;
    conn.on('open', () => {
      const h = hello();
      const resume = ss('starforge_resume:' + this.code);
      conn.send(resume ? { ...h, resume } : h);
    });
    conn.on('data', (raw) => {
      const m = raw as ServerMsg;
      if (!m || typeof m !== 'object') return;
      if (m.t === 'welcome') {
        this.welcomed = true;
        this.retries = 0;
        ss('starforge_resume:' + this.code, m.resume);
        useGame.getState().set({ screen: 'game' });
      }
      if (m.t === 'error') {
        if (m.error === 'host-left') this.fail('The host closed the party.');
        else if (m.error === 'room-full') this.fail('That party is full (4 players).');
        else if (m.error === 'protocol-mismatch') this.fail('That party is on a different version of Starforge. Both of you should reload the page.');
        return;
      }
      onServerMsg(m);
    });
    conn.on('close', () => this.dropped(conn));
    conn.on('error', () => this.dropped(conn));
  }

  private dropped(conn: DataConnection): void {
    if (this.closed || conn !== this.conn) return;
    if (!this.welcomed) return;
    if (this.retries++ < 3) {
      useGame.getState().set({ net: 'reconnecting' });
      setTimeout(() => this.dial(), 1000 * this.retries);
    } else this.fail('Lost the connection to the host.');
  }

  private fail(why: string): void {
    if (this.closed) return;
    this.close();
    this.onFail(why);
  }

  send(msg: ClientMsg): void {
    if (this.conn?.open) this.conn.send(msg);
  }

  close(): void {
    this.closed = true;
    this.conn?.close();
    this.peer?.destroy();
  }
}

/* ---------------- optional dedicated server ---------------- */

class SocketLink implements Link {
  private readonly socket: Socket;
  private resume = '';

  constructor(room: string | null, onFail: (why: string) => void) {
    useGame.getState().set({ mode: 'server', code: room, net: 'connecting', netError: null });
    this.socket = io(SERVER_URL!, { transports: ['websocket'] });
    const join = () => this.socket.emit('hello', { ...hello(), room: useGame.getState().code ?? undefined, resume: this.resume || undefined });
    this.socket.on('connect', join);
    this.socket.on('connect_error', () => useGame.getState().set({ net: 'reconnecting' }));
    this.socket.on('msg', (m: ServerMsg) => {
      if (m.t === 'welcome') {
        this.resume = m.resume;
        useGame.getState().set({ code: m.code, screen: 'game' });
      }
      if (m.t === 'error') {
        this.close();
        onFail(m.error === 'room-not-found' ? 'No room with that code on the server.' : `The server refused: ${m.error}`);
        return;
      }
      onServerMsg(m);
    });
    this.socket.on('disconnect', () => useGame.getState().set({ net: 'reconnecting' }));
  }
  send(msg: ClientMsg): void {
    this.socket.emit('msg', msg);
  }
  close(): void {
    this.socket.close();
  }
}

/* ---------------- public API for the UI ---------------- */

function stopCurrent(): void {
  current?.close();
  current = null;
  setLink(null);
}

function backToLobby(why: string): void {
  stopCurrent();
  useGame.getState().set({ screen: 'lobby', mode: null, code: null, net: 'idle', netError: why, s: null });
}

/** Play in this tab: load the save (with offline gains) or start fresh. Optionally open a party. */
export function startLocal(openParty = false): void {
  stopCurrent();
  const now = Date.now();
  const saved = loadSave();
  let state: RoomState;
  let offline: { seconds: number; gained: RoomState['wallet'] } | null = null;
  if (saved) {
    state = saved.state;
    const r = applyOffline(state, now - saved.savedAt, now);
    if (r.seconds > 60 && Object.values(r.gained).some((v) => v > 0)) offline = r;
  } else {
    state = createRoomState((Math.random() * 2 ** 31) | 0, now);
  }
  const st = useGame.getState();
  st.set({ mode: 'solo', code: null, net: 'idle', netError: null, screen: 'game', offline });
  const room = new LocalRoom(state);
  current = room;
  setLink(room);
  if (openParty) room.openParty();
}

export function openParty(): void {
  if (SERVER_URL) {
    stopCurrent();
    const link = new SocketLink(null, backToLobby);
    current = link;
    setLink(link);
    return;
  }
  if (current instanceof LocalRoom) current.openParty();
  else startLocal(true);
}

export function closeParty(): void {
  if (current instanceof LocalRoom) current.closeParty();
}

export function joinParty(raw: string): void {
  const code = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return;
  if (useGame.getState().code === code) return;
  stopCurrent();
  useGame.getState().set({ s: null, offline: null });
  const link = SERVER_URL ? new SocketLink(code, backToLobby) : new GuestLink(code, backToLobby);
  current = link;
  setLink(link);
}

/** Leave whatever party we're in and keep playing solo. */
export function leaveParty(): void {
  if (current instanceof LocalRoom) current.closeParty();
  else startLocal(false);
}

/** Wipe the local save (Settings → Reset). */
export function resetSave(): void {
  stopCurrent();
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
  startLocal(false);
}

export const usesServer = !!SERVER_URL;
export type { Role };
