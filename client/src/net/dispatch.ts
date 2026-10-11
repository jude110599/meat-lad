import { NODES, RESOURCE_DEFS, fmt, randomUnit, type Fx, type RoomState, type ServerMsg, type TickNote } from '@starforge/shared';
import { emitFx } from '../state/fx';
import { hueColor, rockPoint } from '../state/refs';
import { useGame, type Tone } from '../state/store';
import { predicted } from './actions';

const REJECT_TEXT: Record<string, string> = {
  'too-poor': 'Not enough to afford that yet',
  locked: 'Unlock that in the Forge Tree first',
  maxed: 'Already maxed out',
  gone: 'The comet got away',
  'not-ready': 'Mine more this run before leaping',
};

/** Throttle repeated toasts of the same kind so spam clicks don't flood the screen. */
const lastToast = new Map<string, number>();
function toastOnce(key: string, text: string, tone: Tone, gap = 1500): void {
  const now = Date.now();
  if (now - (lastToast.get(key) ?? 0) < gap) return;
  lastToast.set(key, now);
  useGame.getState().toast(text, tone);
}

function nameOf(s: RoomState | null, id: string): string {
  return s?.players[id]?.name || 'A crewmate';
}

/** Apply one message from the host to the local replica and fire its effects. */
export function onServerMsg(msg: ServerMsg): void {
  const st = useGame.getState();
  switch (msg.t) {
    case 'welcome':
      st.set({ me: msg.playerId, s: msg.state, snapAt: performance.now(), skew: msg.state.now - Date.now(), net: 'open', netError: null });
      break;
    case 'snap': {
      const skew = st.skew * 0.8 + (msg.state.now - Date.now()) * 0.2;
      st.set({ s: msg.state, snapAt: performance.now(), skew });
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

function hitPoint(s: RoomState, seamId: number | null) {
  const dir = (seamId != null ? s.seams.find((x) => x.id === seamId)?.dir : undefined) ?? randomUnit(Math.random);
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
      const hit = pred ?? hitPoint(s, f.seamId);
      const p = s.players[f.playerId];
      if (!mine && p) emitFx({ kind: 'laser', from: f.playerId, to: hit.point.clone(), color: hueColor(p.hue, 70), crit: f.crit });
      const color = f.crit ? '#ffe28a' : f.seamId != null ? RESOURCE_DEFS.ore.color : '#c9a27a';
      emitFx({
        kind: 'burst',
        at: hit.point,
        normal: hit.normal,
        color,
        count: f.broke ? 160 : f.crit ? 70 : f.seamId != null ? 36 : 18,
        speed: f.broke ? 6.5 : f.crit ? 4.8 : 3.2,
      });
      if (f.broke) emitFx({ kind: 'burst', at: hit.point, normal: hit.normal, color: '#fff3c4', count: 60, speed: 9 });
      emitFx({ kind: 'scorch', at: hit.point, normal: hit.normal, hot: f.crit || f.broke });
      emitFx({ kind: 'impact', at: hit.point, normal: hit.normal, by: f.playerId, crit: f.crit, broke: f.broke, seam: f.seamId != null });
      // Other players' numbers stay small so your own read clearly.
      if (mine || f.crit || f.broke)
        emitFx({
          kind: 'float',
          at: hit.point.clone().addScaledVector(hit.normal, 0.3),
          text: (f.crit ? 'CRIT +' : '+') + fmt(f.amount),
          color: f.crit ? '#ffe28a' : mine ? '#ffffff' : hueColor(p?.hue ?? 200, 80),
          big: mine && (f.crit || f.broke),
        });
      if (mine && (f.crit || f.broke)) emitFx({ kind: 'shake', strength: f.broke ? 0.22 : 0.1 });
      if (f.surge) {
        emitFx({ kind: 'shockwave', color: '#4de8ff' });
        emitFx({ kind: 'flash', color: '#4de8ff' });
        toastOnce('surge', `Resonance surge! Everyone mines ×2`, 'event', 4000);
      }
      // Predict the counter and the seam so the HUD reacts before the next snapshot.
      const players = p ? { ...s.players, [f.playerId]: { ...p, wallet: { ...p.wallet, ore: p.wallet.ore + f.amount } } } : s.players;
      let seams = s.seams;
      if (f.seamId != null) {
        seams = seams.map((x) => (x.id === f.seamId ? { ...x, hp: x.hp - (f.crit ? 2 : 1) } : x)).filter((x) => x.hp > 0);
        if (f.newSeam && !seams.some((x) => x.id === f.newSeam!.id)) seams = [...seams, f.newSeam];
      }
      st.set({ s: { ...s, players, seams } });
      break;
    }
    case 'buy': {
      const by = s.players[f.playerId];
      if (by) emitFx({ kind: 'upgrade', by: f.playerId, id: f.id, color: hueColor(by.hue, 70), mine });
      break;
    }
    case 'fund': {
      const node = NODES[f.node];
      if (f.done) {
        emitFx({ kind: 'shockwave', color: '#ffe28a' });
        emitFx({ kind: 'flash', color: '#ffe28a' });
        emitFx({ kind: 'shake', strength: 0.15 });
        const lv = node.repeat ? ` ${f.level}` : '';
        st.toast(`${node.icon} ${node.name}${lv} unlocked for the crew!`, 'good');
      } else if (!mine) {
        toastOnce('fund:' + f.playerId, `${nameOf(s, f.playerId)} put ${fmt(f.amount)} ${RESOURCE_DEFS[f.res].name.toLowerCase()} into ${node.name}`, 'info', 4000);
      }
      break;
    }
    case 'leap':
      if (mine) {
        st.set({ leap: { cores: f.cores, at: Date.now() }, sheet: false });
        emitFx({ kind: 'leap' });
        st.toast(`Quantum Leap! +${f.cores} Star Core${f.cores === 1 ? '' : 's'}`, 'good');
      } else st.toast(`${nameOf(s, f.playerId)} leaped for +${f.cores} Star Cores`, 'info');
      break;
    case 'comet': {
      const by = s.players[f.playerId];
      emitFx({ kind: 'cometCaught', id: f.id, color: hueColor(by?.hue ?? 50, 70) });
      emitFx({ kind: 'flash', color: '#bfefff' });
      const got = f.rewards[st.me] ?? 0;
      st.toast(`${mine ? 'You' : nameOf(s, f.playerId)} caught the comet! +${fmt(got)} ore`, 'good');
      break;
    }
    case 'offline':
      if (mine && Object.values(f.gained).some((v) => v > 0)) st.set({ offline: { seconds: f.seconds, gained: f.gained } });
      break;
    case 'reject':
      if (mine && REJECT_TEXT[f.reason]) toastOnce('rej:' + f.reason, REJECT_TEXT[f.reason], 'bad', 2500);
      break;
    case 'joined':
      if (f.playerId !== st.me) st.toast(`${f.name} joined the crew`, 'good');
      break;
    case 'left':
      st.toast(`${f.name} left`, 'info');
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
  if (n.k === 'comet') toastOnce('comet', '☄️ A comet! Tap it before it flies off', 'event', 5000);
}
