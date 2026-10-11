import { useEffect, useState } from 'react';
import {
  HEAT_MAX,
  LEAP_THRESHOLD,
  MACHINES,
  QUAKE_PRIME_MS,
  RESOURCES,
  RESOURCE_DEFS,
  fmt,
  hotThreshold,
  maxCombo,
  onlinePlayers,
  powerMax,
  quantumPointsFor,
  type BuffId,
  type RoomState,
} from '@starforge/shared';
import { act } from '../net/actions';
import { closeParty, leaveParty, openParty, resetSave, usesServer } from '../net/session';
import { hueColor } from '../state/refs';
import { hostNow, selectMe, useGame, type Tab } from '../state/store';
import { MiningTab, PowerTab, QuantumTab, RES_SHORT, RefineryTab } from './panels';

/** Re-render at a steady rate, for counters and timers between 10 Hz snapshots. */
function useTicker(ms: number): void {
  const [, setT] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

const BUFFS: Record<BuffId, { label: string; color: string; bad?: boolean }> = {
  resonance: { label: 'Resonance · ore ×3', color: '#4de8ff' },
  solar: { label: 'Solar charge · refinery ×2', color: '#ffb03a' },
  focusField: { label: 'Focus Field · +20% crit', color: '#ffe28a' },
  hyperdrive: { label: 'Hyperdrive · strikes ×2', color: '#ff7eb6' },
  droneSurge: { label: 'Drone Surge · drones ×3', color: '#7cf0ff' },
  dronesDown: { label: 'Drones offline', color: '#ff5a4a', bad: true },
};

const fmtTime = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
};

/* ---------------- resources ---------------- */

const fmtRate = (r: number): string => (r < 0 ? '-' : '+') + (Math.abs(r) < 1 ? Math.abs(r).toFixed(2) : fmt(Math.abs(r)));

function Resources({ s }: { s: RoomState }) {
  useTicker(100);
  const snapAt = useGame((st) => st.snapAt);
  const dt = Math.min(1, Math.max(0, (performance.now() - snapAt) / 1000));
  return (
    <div className="resources">
      {RESOURCES.map((id) => {
        const seen = id === 'ore' || s.run.made[id] > 0 || s.wallet[id] > 0;
        if (!seen) return null;
        const rate = s.rates[id];
        const v = Math.max(0, s.wallet[id] + rate * dt);
        return (
          <div key={id} className="res" style={{ ['--c' as string]: RESOURCE_DEFS[id].color }} title={RESOURCE_DEFS[id].name}>
            <i />
            <div>
              <b>{fmt(v)}</b>
              <span>
                {RES_SHORT[id]}
                {Math.abs(rate) >= 0.005 && <em className={rate < 0 ? 'neg' : ''}> {fmtRate(rate)}/s</em>}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- my status: role, heat, power, combo, buffs ---------------- */

function MyStatus({ s }: { s: RoomState }) {
  useTicker(100);
  const st = useGame();
  const me = selectMe(st);
  if (!me) return null;
  const now = hostNow();
  const locked = now < me.lockedUntil;
  const hot = me.heat >= hotThreshold(s.skills);
  const pmax = powerMax(s.levels);
  const cap = maxCombo(s.skills);
  const buffs = (Object.keys(s.buffs) as BuffId[]).filter((b) => (s.buffs[b] ?? 0) > now);
  return (
    <div className="panel status">
      <div className="seg">
        <button className={me.role === 'miner' ? 'on' : ''} onClick={() => act.role('miner')}>
          ⛏ Miner
        </button>
        <button className={me.role === 'refiner' ? 'on' : ''} onClick={() => act.role('refiner')}>
          ⚙ Refiner
        </button>
      </div>
      <div className="meter">
        <span>{locked ? 'OVERHEATED' : hot ? 'HOT DRILL ×2' : 'Drill heat'}</span>
        <div className={'bar heat' + (locked ? ' locked' : hot ? ' hot' : '')}>
          <i style={{ width: `${(me.heat / HEAT_MAX) * 100}%` }} />
          <em style={{ left: `${hotThreshold(s.skills)}%` }} />
        </div>
      </div>
      <div className="meter">
        <span>
          Power {Math.floor(s.power)}/{pmax}
        </span>
        <div className="bar power">
          <i style={{ width: `${(s.power / pmax) * 100}%` }} />
        </div>
      </div>
      <div className="meter">
        <span>
          Sync combo <b className={s.combo > 1.01 ? 'combo on' : 'combo'}>×{s.combo.toFixed(2)}</b>
        </span>
        <div className="bar combo">
          <i style={{ width: `${((s.combo - 1) / (cap - 1)) * 100}%` }} />
        </div>
      </div>
      {buffs.length > 0 && (
        <div className="buffs">
          {buffs.map((b) => (
            <span key={b} className={'chip' + (BUFFS[b].bad ? ' bad' : '')} style={{ ['--c' as string]: BUFFS[b].color }}>
              {BUFFS[b].label} <em>{fmtTime((s.buffs[b] ?? 0) - now)}</em>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- team and party ---------------- */

const EMOTES = ['👋', '🔥', '⛏', '💎', '🎉', '😱'];

function Team({ s }: { s: RoomState }) {
  const { me, mode, code, net, netError, set } = useGame();
  const [copied, setCopied] = useState(false);
  const players = onlinePlayers(s).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
  const link = code ? `${location.origin}${location.pathname}?join=${code}` : '';
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="panel team">
      <div className="head">
        <b>Expedition</b>
        <small>{players.length}/4</small>
      </div>
      {players.map((p) => (
        <div key={p.id} className="mate">
          <i style={{ background: hueColor(p.hue) }} />
          <b>
            {p.name}
            {p.id === me && <small> (you)</small>}
          </b>
          <span>{p.role === 'miner' ? '⛏' : '⚙'}</span>
          <em>{fmt(p.mined)}</em>
        </div>
      ))}
      <div className="party">
        {mode === 'solo' && net !== 'connecting' && (
          <>
            <button className="b1" onClick={openParty}>
              👥 Play with friends
            </button>
            <small>Opens a party with a code. Friends online show up in your friends list to invite.</small>
          </>
        )}
        {net === 'connecting' && mode !== 'guest' && <small>Opening party…</small>}
        {(mode === 'host' || mode === 'server') && code && (
          <>
            <div className="code">
              <span>Party code</span>
              <b>{code}</b>
              <button onClick={copy}>{copied ? 'Copied ✓' : 'Copy link'}</button>
            </div>
            {mode === 'host' && (
              <button className="ghost" onClick={closeParty}>
                Close party
              </button>
            )}
          </>
        )}
        {mode === 'guest' && (
          <>
            <small>
              In party <b>{code}</b>
              {net === 'reconnecting' && ' · reconnecting…'}
            </small>
            <button className="ghost" onClick={leaveParty}>
              Leave and play solo
            </button>
          </>
        )}
        {netError && mode !== 'guest' && (
          <small className="err" onClick={() => set({ netError: null })}>
            {netError} ✕
          </small>
        )}
      </div>
      {mode !== 'solo' && (
        <div className="emotes">
          {EMOTES.map((e) => (
            <button key={e} onClick={() => act.emote(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- tabs ---------------- */

const TABS: { id: Tab; label: string }[] = [
  { id: 'mining', label: '⛏ Mining' },
  { id: 'refinery', label: '⚙ Refinery' },
  { id: 'power', label: '⚡ Power' },
  { id: 'quantum', label: '✦ Quantum' },
];

function Shop({ s }: { s: RoomState }) {
  const tab = useGame((st) => st.tab);
  const set = useGame((st) => st.set);
  const [open, setOpen] = useState(true);
  const leapReady = s.run.cosmicEnergy >= LEAP_THRESHOLD;
  return (
    <div className={'panel shop' + (open ? '' : ' closed')}>
      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={(tab === t.id ? 'on' : '') + (t.id === 'quantum' && (leapReady || s.vote) ? ' ping' : '')}
            onClick={() => {
              set({ tab: t.id });
              setOpen(true);
            }}
          >
            {t.label}
          </button>
        ))}
        <button className="fold" onClick={() => setOpen(!open)} aria-label={open ? 'Hide panel' : 'Show panel'}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className="list">
          {tab === 'mining' && <MiningTab s={s} />}
          {tab === 'refinery' && <RefineryTab s={s} />}
          {tab === 'power' && <PowerTab s={s} />}
          {tab === 'quantum' && <QuantumTab s={s} />}
        </div>
      )}
    </div>
  );
}

/* ---------------- events, votes, banners ---------------- */

function EventPanel({ s }: { s: RoomState }) {
  useTicker(100);
  const ev = s.event;
  if (!ev) return null;
  const now = hostNow();
  const total = ev.endsAt - ev.startedAt;
  const left = ev.endsAt - now;
  if (ev.kind === 'quake') {
    const done = ev.nodes.filter((n) => n.locked).length;
    return (
      <div className="event quake">
        <div className="row">
          <b>Seismic Shockwave</b>
          <em>{fmtTime(left)}</em>
        </div>
        <div className="bar thin">
          <i style={{ width: `${(left / total) * 100}%` }} />
        </div>
        <div className="nodes">
          {ev.nodes.map((n) => (
            <span key={n.id} className={n.locked ? 'locked' : n.primedUntil > now ? 'primed' : ''} />
          ))}
          <small>
            {done}/{ev.nodes.length} locked · strike a glowing node, then Stabilize within {QUAKE_PRIME_MS / 1000}s
          </small>
        </div>
        <button className="big" onPointerDown={() => act.stabilize()}>
          STABILIZE <kbd>Space</kbd>
        </button>
      </div>
    );
  }
  return (
    <div className="event flare">
      <div className="row">
        <b>Solar Flare</b>
        <em>{fmtTime(left)}</em>
      </div>
      <div className={'bar shield' + (ev.shield < 25 ? ' low' : '')}>
        <i style={{ width: `${ev.shield}%` }} />
      </div>
      <small>Keep the shield above zero until the flare passes. Everyone can help.</small>
      <button className="big" onPointerDown={() => act.shield()}>
        SHIELD <kbd>Space</kbd>
      </button>
    </div>
  );
}

function VoteModal({ s }: { s: RoomState }) {
  useTicker(250);
  const me = useGame((st) => st.me);
  const v = s.vote;
  if (!v) return null;
  const online = onlinePlayers(s);
  const by = s.players[v.by]?.name ?? 'Someone';
  const mine = v.yes.includes(me) || v.no.includes(me);
  return (
    <div className="vote">
      <b>✦ {v.by === me ? 'You proposed' : `${by} proposes`} a Quantum Leap</b>
      <span>
        Everyone gets +{quantumPointsFor(s.run.cosmicEnergy, online.length)} QP and starts a new asteroid. {fmtTime(v.until - hostNow())} left.
      </span>
      <div className="tally">
        {online.map((p) => (
          <i key={p.id} title={p.name} className={v.yes.includes(p.id) ? 'yes' : v.no.includes(p.id) ? 'no' : ''} style={{ ['--c' as string]: hueColor(p.hue) }} />
        ))}
      </div>
      {!mine && (
        <div className="buy">
          <button className="b1" onClick={() => act.vote(true)}>
            Leap!
          </button>
          <button className="bmax" onClick={() => act.vote(false)}>
            Not yet
          </button>
        </div>
      )}
    </div>
  );
}

function Banner() {
  useTicker(250);
  const b = useGame((st) => st.banner);
  if (!b || Date.now() > b.until) return null;
  return (
    <div className={'banner ' + b.tone} key={b.until}>
      <b>{b.title}</b>
      <span>{b.text}</span>
    </div>
  );
}

function Toasts() {
  const toasts = useGame((st) => st.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.tone}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

function OfflineCard() {
  const { offline, set } = useGame();
  if (!offline) return null;
  const h = Math.floor(offline.seconds / 3600);
  const m = Math.floor((offline.seconds % 3600) / 60);
  return (
    <div className="modal">
      <div className="card offline">
        <h3>Welcome back, prospector</h3>
        <p>
          Your drones, rigs and refinery kept working at reduced power for {h ? `${h}h ` : ''}
          {m}m:
        </p>
        <div className="gains">
          {RESOURCES.filter((r) => offline.gained[r] > 0).map((r) => (
            <span key={r} style={{ ['--c' as string]: RESOURCE_DEFS[r].color }}>
              +{fmt(offline.gained[r])} {RES_SHORT[r]}
            </span>
          ))}
        </div>
        <button className="b1" onClick={() => set({ offline: null })}>
          Collect
        </button>
      </div>
    </div>
  );
}

function LeapFlash() {
  const leap = useGame((st) => st.leap);
  if (!leap || Date.now() - leap.at > 2500) return null;
  return (
    <div className="leapflash" key={leap.at}>
      <b>QUANTUM LEAP</b>
      <span>+{leap.qp} QP</span>
    </div>
  );
}

function Menu() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const mode = useGame((st) => st.mode);
  return (
    <div className="menu">
      <button className="gear" onClick={() => setOpen(!open)} aria-label="Menu">
        ☰
      </button>
      {open && (
        <div className="panel drop">
          <a href="../">← All games</a>
          <details>
            <summary>How to play</summary>
            <p>
              <b>Miners</b> click the asteroid. Glowing seams pay ×3. Heat above the line doubles ore; at 100 the drill locks for 2 s.
            </p>
            <p>
              <b>Refiners</b> press machines (keys 1–4) to refine ore up the chain, and fire overclocks with power.
            </p>
            <p>
              <b>Events</b> hit every few minutes once a Smelter runs. Quakes: strike nodes then Stabilize. Flares: spam Shield.
            </p>
            <p>
              <b>Leap</b> after 10 cosmic energy for Quantum Points and permanent skills.
            </p>
          </details>
          {(mode === 'solo' || mode === 'host') && (
            <button className="ghost danger" onClick={() => (confirm ? resetSave() : setConfirm(true))}>
              {confirm ? 'Really wipe everything?' : 'Reset progress'}
            </button>
          )}
          {usesServer && <small>Connected to the game server.</small>}
        </div>
      )}
    </div>
  );
}

/* ---------------- keyboard ---------------- */

function useKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.repeat) return;
      const s = useGame.getState().s;
      if (!s) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 4) act.press(MACHINES[n - 1]);
      if (e.code === 'Space' && s.event) {
        e.preventDefault();
        if (s.event.kind === 'quake') act.stabilize();
        else act.shield();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}

/* ---------------- layout ---------------- */

export function Hud() {
  const s = useGame((st) => st.s);
  const view = useGame((st) => st.view);
  const set = useGame((st) => st.set);
  useKeys();
  if (!s) return null;
  return (
    <div className="hud">
      <header className="top">
        <div className="brand">
          STAR<span>FORGE</span>
        </div>
        <Resources s={s} />
        <div className="topr">
          <button className="view" onClick={() => set({ view: view === 'rock' ? 'station' : 'rock' })}>
            {view === 'rock' ? '⚙ Station' : '☄ Asteroid'}
          </button>
          <Menu />
        </div>
      </header>
      <aside className="left">
        <Team s={s} />
        <MyStatus s={s} />
      </aside>
      <Shop s={s} />
      <div className="center">
        <Banner />
        <VoteModal s={s} />
      </div>
      <div className="bottom">
        <EventPanel s={s} />
      </div>
      <Toasts />
      <OfflineCard />
      <LeapFlash />
    </div>
  );
}
