import type { Vector3 } from 'three';
import type { ClientMsg, MachineId, OverclockId, Role, SkillId, UpgradeId } from '@starforge/shared';
import { emitFx } from '../state/fx';
import { hueColor } from '../state/refs';
import { selectMe, useGame } from '../state/store';

/** Whatever carries intents to the host: the in-page RoomHost, a PeerJS link, or Socket.io. */
export interface Link {
  send(msg: ClientMsg): void;
}

let link: Link | null = null;
export function setLink(l: Link | null): void {
  link = l;
}

/** Strikes we fired, so the host's answer can burst at the exact spot we clicked. */
export const predicted = new Map<number, { point: Vector3; normal: Vector3 }>();
let seq = 0;

/**
 * Every player action. Scene and HUD call these; nothing here decides an
 * outcome. The laser fires instantly for feel, the result comes from the host.
 */
export const act = {
  strike(target: { seamId?: number | null; nodeId?: number | null }, point: Vector3, normal: Vector3): void {
    const st = useGame.getState();
    const me = selectMe(st);
    if (!link || !me) return;
    if (Date.now() < me.lockedUntil) {
      emitFx({ kind: 'shake', strength: 0.05 });
      return;
    }
    const n = ++seq;
    predicted.set(n, { point: point.clone(), normal: normal.clone() });
    if (predicted.size > 64) predicted.delete(predicted.keys().next().value!);
    emitFx({ kind: 'laser', from: st.me, to: point.clone(), color: hueColor(me.hue, 70), crit: false });
    link.send({ t: 'strike', seq: n, seamId: target.seamId ?? null, nodeId: target.nodeId ?? null });
  },
  press(machine: MachineId): void {
    link?.send({ t: 'press', seq: ++seq, machine });
    useGame.getState().set({ lastPress: { machine, at: performance.now() } });
  },
  buy: (id: UpgradeId, count = 1) => link?.send({ t: 'buy', id, count }),
  skill: (id: SkillId) => link?.send({ t: 'skill', id }),
  toggle: (machine: MachineId, on: boolean) => link?.send({ t: 'toggle', machine, on }),
  overclock: (id: OverclockId) => link?.send({ t: 'overclock', id }),
  role(role: Role): void {
    link?.send({ t: 'role', role });
    useGame.getState().set({ role, view: role === 'refiner' ? 'station' : 'rock', tab: role === 'refiner' ? 'refinery' : 'mining' });
    try {
      localStorage.setItem('starforge_role', role);
    } catch {
      /* storage unavailable */
    }
  },
  stabilize: () => link?.send({ t: 'stabilize' }),
  shield: () => link?.send({ t: 'shield' }),
  leap: () => link?.send({ t: 'leap' }),
  vote: (yes: boolean) => link?.send({ t: 'vote', yes }),
  emote: (id: string) => link?.send({ t: 'emote', id }),
};
