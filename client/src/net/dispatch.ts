import {
  MACHINE_DEFS,
  OVERCLOCKS,
  RESOURCE_DEFS,
  SKILLS,
  UPGRADES,
  fmt,
  randomUnit,
  type Fx,
  type RoomState,
  type ServerMsg,
  type TickNote,
  type Vec3,
} from '@starforge/shared';
import { emitFx } from '../state/fx';
import { hueColor, rockPoint } from '../state/refs';
import { useGame } from '../state/store';
import { predicted } from './actions';

/** Colour of each overclock's tint pulse. */
export const OVERCLOCK_COLORS: Record<string, string> = {
  thermalDump: '#4de8ff',
  focusField: '#ffe28a',
  droneSurge: '#7cf0ff',
  hyperdrive: '#ff7eb6',
};

const REJECT_TEXT: Record<string, string> = {
  overheated: 'Drill overheated, let it vent',
  'no-power': 'Not enough power',
  locked: 'Build that machine first',
};

/** Throttle repeated toasts of the same kind so spam clicks don't flood the screen. */
const lastToast = new Map<string, number>();
function toastOnce(key: string, text: string, tone: 'info' | 'good' | 'bad' | 'event', gap = 1500): void {
  const now = Date.now();
  if (now - (lastToast.get(key) ?? 0) < gap) return;
  lastToast.set(key, now);
  useGame.getState().toast(text, tone);
}

function nameOf(s: RoomState | null, id: string): string {
  return s?.players[id]?.name || 'A teammate';
}

/** Apply one message from the host to the local replica and fire its effects. */
export function onServerMsg(msg: ServerMsg): void {
  const st = useGame.getState();
  switch (msg.t) {
    case 'welcome':
      st.set({ me: msg.playerId, s: msg.state, snapAt: performance.now(), skew: msg.state.now - Date.now(), net: 'open', netError: null });
      break;
    case 'snap': {
      const me = msg.state.players[st.me];
      const skew = st.skew * 0.8 + (msg.state.now - Date.now()) * 0.2;
      st.set({ s: msg.state, snapAt: performance.now(), skew, ...(me && me.role !== st.role ? { role: me.role } : {}) });
      break;
    }
    case 'fx':
      for (const f of msg.fx) handleFx(f);
      break;
    case 'error':
      st.set({ netError: msg.error });
      break;
  }
}

function hitPoint(s: RoomState, seamId: number | null, nodeId: number | null): { point: import('three').Vector3; normal: import('three').Vector3 } {
  let dir: Vec3 | undefined;
  if (nodeId != null && s.event?.kind === 'quake') dir = s.event.nodes.find((n) => n.id === nodeId)?.dir;
  if (!dir && seamId != null) dir = s.seams.find((x) => x.id === seamId)?.dir;
  if (!dir) dir = randomUnit(Math.random);
  return rockPoint(dir, s.seed);
}

function handleFx(f: Fx): void {
  const st = useGame.getState();
  const s = st.s;
  if (!s) return;
  const mine = 'playerId' in f && f.playerId === st.me;
  switch (f.k) {
    case 'strike': {
      const pred = mine ? predicted.get(f.seq) : undefined;
      if (mine) predicted.delete(f.seq);
      const hit = pred ?? hitPoint(s, f.seamId, f.nodeId);
      const p = s.players[f.playerId];
      if (!mine && p) emitFx({ kind: 'laser', from: f.playerId, to: hit.point.clone(), color: hueColor(p.hue, 70), crit: f.crit });
      const color = f.crit ? '#ffe28a' : f.seamId != null ? RESOURCE_DEFS.ore.color : f.nodeId != null ? '#7cf0ff' : '#c9a27a';
      emitFx({
        kind: 'burst',
        at: hit.point,
        normal: hit.normal,
        color,
        count: f.seamDepleted ? 180 : f.crit ? 80 : f.seamId != null ? 40 : 20,
        speed: f.seamDepleted ? 6.5 : f.crit ? 4.8 : 3.2,
      });
      if (f.seamDepleted) emitFx({ kind: 'burst', at: hit.point, normal: hit.normal, color: '#fff3c4', count: 70, speed: 9 });
      emitFx({ kind: 'scorch', at: hit.point, normal: hit.normal, hot: f.hot || f.crit });
      emitFx({
        kind: 'float',
        at: hit.point.clone().addScaledVector(hit.normal, 0.3),
        text: (f.crit ? 'CRIT +' : '+') + fmt(f.amount) + (f.sync ? ' ⚡' : ''),
        color: f.crit ? '#ffe28a' : mine ? '#ffffff' : hueColor(p?.hue ?? 200, 80),
        big: f.crit || f.seamDepleted,
      });
      if (mine && (f.crit || f.seamDepleted)) emitFx({ kind: 'shake', strength: f.seamDepleted ? 0.25 : 0.12 });
      if (mine && f.overheated) {
        emitFx({ kind: 'shake', strength: 0.2 });
        toastOnce('overheat', 'Overheated! The drill locks for 2 seconds.', 'bad');
      }
      if (f.seamDepleted && mine) toastOnce('seam', 'Seam cracked open: jackpot ×4', 'good', 4000);
      // Predict the counter and heat so the HUD reacts before the next snapshot.
      const players = p ? { ...s.players, [f.playerId]: { ...p, heat: f.heat } } : s.players;
      let seams = s.seams;
      if (f.seamId != null) {
        seams = seams.map((x) => (x.id === f.seamId ? { ...x, hp: x.hp - (f.crit ? 2 : 1) } : x)).filter((x) => x.hp > 0);
        if (f.newSeam && !seams.some((x) => x.id === f.newSeam!.id)) seams = [...seams, f.newSeam];
      }
      st.set({ s: { ...s, wallet: { ...s.wallet, ore: s.wallet.ore + f.amount }, players, seams } });
      break;
    }
    case 'press': {
      emitFx({ kind: 'press', machine: f.machine, made: f.made, output: f.output, playerId: f.playerId, sync: f.sync });
      if (mine && f.made <= 0) toastOnce('noinput', `Not enough ${RESOURCE_DEFS[MACHINE_DEFS[f.machine].input].name.toLowerCase()} to press`, 'bad', 2500);
      if (f.made > 0) st.set({ s: { ...s, wallet: { ...s.wallet, [f.output]: s.wallet[f.output] + f.made }, power: f.power } });
      break;
    }
    case 'stabilize':
      for (const id of f.locked) emitFx({ kind: 'nodeLock', nodeId: id });
      if (f.locked.length) toastOnce('lock', `${mine ? 'You' : nameOf(s, f.playerId)} locked a resonance node!`, 'good', 300);
      else if (mine) toastOnce('nolock', 'Nothing primed: a miner must strike a node first', 'info', 2500);
      break;
    case 'shield':
      emitFx({ kind: 'shieldHit', shield: f.shield });
      break;
    case 'overclock':
      emitFx({ kind: 'overclock', color: OVERCLOCK_COLORS[f.id] ?? '#ffffff' });
      st.toast(`${mine ? 'You' : nameOf(s, f.playerId)} fired ${OVERCLOCKS[f.id].name}`, 'event');
      break;
    case 'buy':
      if (!mine) toastOnce('buy:' + f.playerId, `${nameOf(s, f.playerId)} bought ${UPGRADES[f.id].name} (Lv ${f.level})`, 'info', 2500);
      break;
    case 'skill':
      st.toast(`${mine ? 'You' : nameOf(s, f.playerId)} learned ${SKILLS[f.id].name}`, 'good');
      break;
    case 'reject':
      if (mine && REJECT_TEXT[f.reason]) toastOnce('rej:' + f.reason, REJECT_TEXT[f.reason], 'bad', 2500);
      break;
    case 'joined':
      if (f.playerId !== st.me) st.toast(`${f.name} joined the expedition`, 'good');
      break;
    case 'left':
      st.toast(`${f.name} left`, 'info');
      break;
    case 'vote':
      if (!mine) st.toast(`${nameOf(s, f.playerId)} wants to Quantum Leap. Vote now!`, 'event');
      break;
    case 'emote':
      st.set({ emotes: { ...st.emotes, [f.playerId]: { id: f.id, at: Date.now() } } });
      break;
    case 'note':
      handleNote(f.note);
      break;
  }
}

function handleNote(n: TickNote): void {
  const st = useGame.getState();
  switch (n.k) {
    case 'eventStart':
      if (n.event.kind === 'quake') {
        st.showBanner('Seismic Shockwave!', 'Miners: strike the glowing nodes. Refiners: hit Stabilize right after each strike to lock it.', 'event', 7000);
        emitFx({ kind: 'shockwave', color: '#ff6a3a' });
      } else {
        st.showBanner('Solar Flare!', 'Everyone: tap Shield to keep the bubble up until the flare passes.', 'event', 7000);
        emitFx({ kind: 'shockwave', color: '#ffb03a' });
      }
      emitFx({ kind: 'shake', strength: 0.3 });
      break;
    case 'eventEnd':
      st.showBanner(n.end.success ? 'Event cleared!' : 'Event failed', n.end.note, n.end.success ? 'good' : 'bad', 6000);
      emitFx({ kind: 'shockwave', color: n.end.success ? '#7dffb0' : '#ff5a4a' });
      break;
    case 'leap':
      st.set({ leap: { qp: n.done.qp, at: Date.now() } });
      st.showBanner('Quantum Leap!', `+${n.done.qp} Quantum Points. A fresh asteroid awaits, and your skills carry over.`, 'good', 7000);
      emitFx({ kind: 'leap' });
      break;
    case 'voteFailed':
      st.toast('The leap vote did not pass', 'info');
      break;
  }
}
