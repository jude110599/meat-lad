import { io, type Socket } from 'socket.io-client';
import { Vector3, type Object3D } from 'three';
import {
  DEFAULT_PORT,
  PROTOCOL_VERSION,
  RESOURCE_DEFS,
  SNAPSHOT_HZ,
  addPlayer,
  applyStrike,
  buyUpgrade,
  createRoomState,
  fmt,
  globalMult,
  passiveOrePerSec,
  surfacePoint,
  tickRoom,
  type ClientToServerEvents,
  type RoomState,
  type Role,
  type ServerToClientEvents,
  type Snapshot,
  type StrikeOutcome,
  type UpgradeId,
} from '@starforge/shared';
import { emitFx } from '../state/fx';
import { useGame } from '../state/store';

/**
 * The client never decides outcomes. It forwards intents to an Authority and
 * renders whatever comes back. Online that is the Socket.io server; offline it
 * is LocalAuthority running the exact same shared rules in the browser.
 */
export interface Authority {
  strike(seamId: number | null, point: Vector3, normal: Vector3): void;
  buy(id: UpgradeId): void;
}

/** Set by the Rock component so strike results can be placed in world space. */
export const rockRef: { current: Object3D | null } = { current: null };

interface PendingHit {
  point: Vector3;
  normal: Vector3;
}

const pending = new Map<number, PendingHit>();
let seq = 0;

function predict(point: Vector3, normal: Vector3): number {
  const s = ++seq;
  pending.set(s, { point: point.clone(), normal: normal.clone() });
  if (pending.size > 64) pending.delete(pending.keys().next().value!);
  emitFx({ kind: 'laser', to: point.clone() });
  return s;
}

/** Where to draw a strike we did not predict (another player's, or a lost prediction). */
function fallbackHit(seamId: number | null): PendingHit {
  const { seams, seed } = useGame.getState();
  const seam = seams.find((x) => x.id === seamId) ?? seams[Math.floor(Math.random() * seams.length)];
  const local = new Vector3(...(seam ? surfacePoint(seam.dir, seed) : [0, 2.2, 0]));
  const normal = local.clone().normalize();
  const rock = rockRef.current;
  if (rock) {
    rock.localToWorld(local);
    normal.transformDirection(rock.matrixWorld);
  }
  return { point: local, normal };
}

function onResult(r: StrikeOutcome & { seq: number }): void {
  const st = useGame.getState();
  const mine = r.playerId === st.playerId;
  const hit = (mine && pending.get(r.seq)) || fallbackHit(r.seamId);
  if (mine) pending.delete(r.seq);

  st.addOre(r.amount);
  st.setPlayerHeat(r.playerId, r.heat, r.overheated ? Date.now() + 2000 : undefined);
  if (r.seamId != null) st.replaceSeam(r.seamDepleted ? r.seamId : null, r.newSeam, { id: r.seamId, dmg: r.crit ? 2 : 1 });

  const gem = RESOURCE_DEFS.ore.color;
  const color = r.crit ? '#ffe28a' : r.seamId != null ? gem : '#c9a27a';
  emitFx({
    kind: 'burst',
    at: hit.point,
    normal: hit.normal,
    color,
    count: r.seamDepleted ? 160 : r.crit ? 70 : r.seamId != null ? 36 : 18,
    speed: r.seamDepleted ? 6 : r.crit ? 4.5 : 3,
  });
  if (r.seamDepleted) emitFx({ kind: 'burst', at: hit.point, normal: hit.normal, color: '#fff3c4', count: 60, speed: 9 });
  emitFx({
    kind: 'float',
    at: hit.point.clone().addScaledVector(hit.normal, 0.3),
    text: (r.crit ? 'CRIT +' : '+') + fmt(r.amount),
    color: r.crit ? '#ffe28a' : '#ffffff',
    big: r.crit || r.seamDepleted,
  });
  if (r.crit || r.seamDepleted) emitFx({ kind: 'shake', strength: r.seamDepleted ? 0.25 : 0.12 });
}

/* ---------------- offline ---------------- */

export class LocalAuthority implements Authority {
  private readonly state: RoomState;
  private readonly id = 'local';

  constructor(seed = (Math.random() * 2 ** 31) | 0) {
    this.state = createRoomState(seed);
    addPlayer(this.state, this.id, 'You', 'miner');
    useGame.getState().setConnection({ mode: 'offline', room: null, playerId: this.id, role: 'miner', seed });

    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      tickRoom(this.state, (now - last) / 1000, Date.now());
      last = now;
      useGame.getState().applySnapshot(this.snapshot());
    }, 1000 / SNAPSHOT_HZ);
    useGame.getState().applySnapshot(this.snapshot());
  }

  strike(seamId: number | null, point: Vector3, normal: Vector3): void {
    const s = predict(point, normal);
    const out = applyStrike(this.state, this.id, seamId, Date.now(), Math.random());
    if (typeof out === 'string') pending.delete(s);
    else onResult({ ...out, seq: s });
  }

  buy(id: UpgradeId): void {
    if (buyUpgrade(this.state, id)) useGame.getState().applySnapshot(this.snapshot());
  }

  private snapshot(): Snapshot {
    const s = this.state;
    return {
      tick: s.tick,
      serverTime: Date.now(),
      wallet: s.wallet,
      levels: s.levels,
      seams: s.seams,
      players: Object.values(s.players),
      quantumPoints: s.quantumPoints,
      orePerSec: passiveOrePerSec(s.levels, globalMult(s)),
    };
  }
}

/* ---------------- online ---------------- */

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export class RemoteAuthority implements Authority {
  constructor(private readonly socket: ClientSocket) {
    socket.on('snapshot', (s) => useGame.getState().applySnapshot(s));
    socket.on('mine:result', onResult);
    socket.on('mine:reject', (r) => pending.delete(r.seq));
    socket.on('disconnect', () => useGame.getState().setConnection({ mode: 'connecting' }));
  }

  strike(seamId: number | null, point: Vector3, normal: Vector3): void {
    this.socket.emit('mine:strike', { seq: predict(point, normal), seamId });
  }

  buy(id: UpgradeId): void {
    this.socket.emit('shop:buy', { id });
  }
}

const TOKEN_KEY = 'starforge_resume';

/**
 * Try the server first; fall back to offline play if it is unreachable, so
 * the scene always runs (including on static hosting like GitHub Pages).
 */
export async function connect(): Promise<Authority> {
  const q = new URLSearchParams(location.search);
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  // Static hosting (GitHub Pages) with no server configured: play offline straight away.
  if (q.has('offline') || (!configured && !isLocalHost)) return new LocalAuthority();

  const url = configured ?? `${location.protocol}//${location.hostname}:${DEFAULT_PORT}`;
  const role: Role = q.get('role') === 'refiner' ? 'refiner' : 'miner';
  const socket: ClientSocket = io(url, { transports: ['websocket'], timeout: 1500, reconnectionAttempts: 2 });

  return new Promise<Authority>((resolve) => {
    const fail = () => {
      socket.close();
      resolve(new LocalAuthority());
    };
    const timer = setTimeout(fail, 2000);
    socket.once('connect_error', () => {
      clearTimeout(timer);
      fail();
    });
    socket.once('connect', () => {
      clearTimeout(timer);
      let resumeToken: string | undefined;
      try {
        resumeToken = sessionStorage.getItem(TOKEN_KEY) ?? undefined;
      } catch {
        /* storage unavailable */
      }
      socket.emit(
        'hello',
        { protocol: PROTOCOL_VERSION, name: q.get('name') ?? 'Prospector', role, room: q.get('room') ?? undefined, resumeToken },
        (w) => {
          if ('error' in w) {
            console.warn('[starforge] join failed:', w.error);
            return fail();
          }
          try {
            sessionStorage.setItem(TOKEN_KEY, w.resumeToken);
          } catch {
            /* ignore */
          }
          const auth = new RemoteAuthority(socket);
          useGame.getState().setConnection({ mode: 'online', room: w.room, playerId: w.playerId, role, seed: w.seed });
          // After the first join, keep retrying and reclaim the same slot on every reconnect.
          socket.io.reconnectionAttempts(Infinity);
          socket.on('connect', () =>
            socket.emit('hello', { protocol: PROTOCOL_VERSION, name: q.get('name') ?? 'Prospector', role, room: w.room, resumeToken: w.resumeToken }, (r) => {
              if ('error' in r) return console.warn('[starforge] rejoin failed:', r.error);
              useGame.getState().setConnection({ mode: 'online', playerId: r.playerId });
              useGame.getState().applySnapshot(r.snapshot);
            }),
          );
          useGame.getState().applySnapshot(w.snapshot);
          const u = new URL(location.href);
          u.searchParams.set('room', w.room);
          history.replaceState(null, '', u);
          resolve(auth);
        },
      );
    });
  });
}
