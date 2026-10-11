import { useEffect, useState } from 'react';
import {
  HEAT_BONUS_THRESHOLD,
  HEAT_MAX,
  RESOURCES,
  RESOURCE_DEFS,
  UPGRADES,
  critChance,
  fmt,
  strikeBase,
  quantumMult,
  upgradeCost,
  type UpgradeId,
} from '@starforge/shared';
import type { Authority } from '../net/authority';
import { selectMe, useGame } from '../state/store';

/** Re-render at display rate so the ore counter ticks smoothly between 10 Hz snapshots. */
function useAnimationClock(): number {
  const [t, setT] = useState(performance.now());
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setT(performance.now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  return t;
}

export function Hud({ auth }: { auth: Authority }) {
  const now = useAnimationClock();
  const st = useGame();
  const me = selectMe(st);
  const ore = st.wallet.ore + st.orePerSec * Math.max(0, (now - st.snapshotAt) / 1000);
  const heat = me?.heat ?? 0;
  const locked = me ? Date.now() < me.lockedUntil : false;
  const perStrike = strikeBase(st.levels, quantumMult(st.quantumPoints));

  return (
    <div className="hud">
      <header className="top">
        <div className="brand">
          STARFORGE<span>prototype</span>
        </div>
        <div className={'conn ' + st.mode}>
          {st.mode === 'online' ? `Online · room ${st.room} · ${st.players.length} here` : st.mode === 'offline' ? 'Offline · solo' : 'Connecting…'}
        </div>
      </header>

      <section className="wallet">
        {RESOURCES.map((id) => {
          const v = id === 'ore' ? ore : st.wallet[id];
          const locked = id !== 'ore' && v <= 0;
          return (
            <div key={id} className={'pill' + (locked ? ' locked' : '')} style={{ ['--c' as string]: RESOURCE_DEFS[id].color }}>
              <b>{locked ? '—' : fmt(v)}</b>
              <span>{RESOURCE_DEFS[id].name}</span>
            </div>
          );
        })}
      </section>

      <section className="stats">
        <div>
          <b>{fmt(st.orePerSec)}</b>
          <span>ore / s</span>
        </div>
        <div>
          <b>{fmt(perStrike)}</b>
          <span>per strike</span>
        </div>
        <div>
          <b>{Math.round(critChance(st.levels) * 100)}%</b>
          <span>crit ×5</span>
        </div>
      </section>

      <section className="heat">
        <div className="bar">
          <i style={{ width: `${(heat / HEAT_MAX) * 100}%` }} className={locked ? 'locked' : heat >= HEAT_BONUS_THRESHOLD ? 'hot' : ''} />
          <em style={{ left: `${HEAT_BONUS_THRESHOLD}%` }} />
        </div>
        <span>{locked ? 'OVERHEATED · venting' : heat >= HEAT_BONUS_THRESHOLD ? 'HOT DRILL · ore ×2' : 'Drill heat'}</span>
      </section>

      <section className="shop">
        {(Object.keys(UPGRADES) as UpgradeId[]).map((id) => {
          const def = UPGRADES[id];
          const lv = st.levels[id];
          const maxed = def.maxLevel !== undefined && lv >= def.maxLevel;
          const cost = upgradeCost(id, lv);
          const can = !maxed && st.wallet[def.currency] >= cost;
          return (
            <button key={id} disabled={!can} onClick={() => auth.buy(id)}>
              <div className="name">
                {def.name} <small>Lv {lv}</small>
              </div>
              <div className="desc">{def.desc}</div>
              <div className="cost">{maxed ? 'MAX' : `${fmt(cost)} ${def.currency}`}</div>
            </button>
          );
        })}
      </section>

      {st.role === 'refiner' && <div className="toast">Refinery station is not built yet. You can buy upgrades for the team.</div>}
      <footer className="hint">Click the asteroid to fire the drill laser. Glowing seams pay ×3 and burst when depleted. Drag to orbit.</footer>
    </div>
  );
}
