import type { Vector3 } from 'three';
import type { ClientMsg, NodeId, ResourceId, UpgradeId } from '@starforge/shared';
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
  strike(seamId: number | null, point: Vector3, normal: Vector3): void {
    const st = useGame.getState();
    const me = selectMe(st);
    if (!link || !me) return;
    const n = ++seq;
    predicted.set(n, { point: point.clone(), normal: normal.clone() });
    if (predicted.size > 64) predicted.delete(predicted.keys().next().value!);
    emitFx({ kind: 'laser', from: st.me, to: point.clone(), color: hueColor(me.hue, 70), crit: false });
    link.send({ t: 'strike', seq: n, seamId });
  },
  buy: (id: UpgradeId, count = 1) => link?.send({ t: 'buy', id, count }),
  fund: (node: NodeId, res: ResourceId, amount: number) => link?.send({ t: 'fund', node, res, amount }),
  leap: () => link?.send({ t: 'leap' }),
  comet: (id: number) => link?.send({ t: 'comet', id }),
  emote: (id: string) => link?.send({ t: 'emote', id }),
};
