import {
  LEAP_MIN_ORE,
  NODES,
  UPGRADES,
  UPGRADE_IDS,
  affordable,
  bulkCost,
  canLeap,
  critChance,
  critMult,
  droneRate,
  fmt,
  harvesterRate,
  has,
  leapCores,
  nodeOpen,
  rigRate,
  seamMult,
  smeltShare,
  tapValue,
  upgradeCost,
  upgradeUnlocked,
  type PlayerState,
  type RoomState,
  type UpgradeId,
} from '@starforge/shared';
import { act } from '../net/actions';
import { useGame, type BuyMode } from '../state/store';
import { Amount, ConfirmButton, liveWallet, useMe, useTicker } from './common';

/** What an upgrade is doing for you right now. */
function effect(s: RoomState, p: PlayerState, id: UpgradeId): string {
  switch (id) {
    case 'drill':
      return `${fmt(tapValue(s, p))} ore per tap`;
    case 'drone':
      return `${fmt(droneRate(s, p))} ore/s`;
    case 'lens':
      return `${Math.round(critChance(p) * 100)}% crit chance, crits ×${critMult(s)}`;
    case 'rig':
      return `${fmt(rigRate(s, p))} ore/s from seams`;
    case 'smelter':
      return `${(smeltShare(s, p) * 100).toFixed(2)}% of your ore becomes alloy`;
    case 'scanner':
      return `Seams pay ×${fmt(seamMult(s, p))}`;
    case 'harvester':
      return `${fmt(harvesterRate(s, p))} ore/s`;
    case 'plating':
      return `Drones and Harvesters ×${(1 + 0.25 * p.levels.plating).toFixed(2)}`;
  }
}

/** How many levels a tap buys in this mode, and what they cost. */
function plan(id: UpgradeId, level: number, budget: number, mode: BuyMode): { n: number; cost: number } {
  const max = UPGRADES[id].maxLevel;
  const room = max === undefined ? Infinity : max - level;
  if (room <= 0) return { n: 0, cost: 0 };
  if (mode === 'max') {
    const n = affordable(id, level, budget);
    return n > 0 ? { n, cost: bulkCost(id, level, n) } : { n: 1, cost: upgradeCost(id, level) };
  }
  const n = Math.min(mode, room);
  return { n, cost: bulkCost(id, level, n) };
}

function UpgradeRow({ s, p, id, mode, budget }: { s: RoomState; p: PlayerState; id: UpgradeId; mode: BuyMode; budget: number }) {
  const def = UPGRADES[id];
  const lv = p.levels[id];
  const maxed = def.maxLevel !== undefined && lv >= def.maxLevel;
  const { n, cost } = plan(id, lv, budget, mode);
  const ok = !maxed && budget >= cost;
  return (
    <div className={'up' + (ok ? ' ok' : '')}>
      <i className="ico">{def.icon}</i>
      <div className="txt">
        <b>
          {def.name} <em>{maxed ? 'MAX' : `Lv ${lv}`}</em>
        </b>
        <span>{lv === 0 ? def.desc : effect(s, p, id)}</span>
      </div>
      {maxed ? (
        <div className="buy done">✓</div>
      ) : (
        <button className="buy" disabled={!ok} onClick={() => act.buy(id, mode === 'max' ? 1000 : n)}>
          {n > 1 && <small>+{n}</small>}
          <Amount r={def.currency} v={cost} />
        </button>
      )}
    </div>
  );
}

function LeapCard({ s, p }: { s: RoomState; p: PlayerState }) {
  const cores = leapCores(p);
  const next = Math.max(LEAP_MIN_ORE, Math.pow(cores + 1, 2) * 1e8);
  const ready = canLeap(s, p);
  const per = has(s, 'starseed') ? 20 : 10;
  return (
    <div className="card leap">
      <h3>
        <i>🌀</i> Quantum Leap
      </h3>
      <p>
        Restart your own run (ore, alloy and upgrades) for Star Cores. Each core you hold gives +{per}% ore, and the Forge Tree stays.
        {has(s, 'memory') && ' Stellar Memory starts you at Drill 10 and Drone 10.'}
      </p>
      <div className="leaprow">
        <span>
          This run: <b>{fmt(p.run.ore)}</b> ore
        </span>
        <span>Next core at {fmt(next)}</span>
      </div>
      <ConfirmButton className="primary wide" disabled={!ready} onConfirm={act.leap} armed={<>Tap again to leap for +{cores} ★</>}>
        {ready ? <>Leap for +{cores} Star Core{cores === 1 ? '' : 's'}</> : <>Mine {fmt(LEAP_MIN_ORE)} ore in one run</>}
      </ConfirmButton>
    </div>
  );
}

export function UpgradesTab() {
  useTicker(250);
  const s = useGame((st) => st.s);
  const snapAt = useGame((st) => st.snapAt);
  const mode = useGame((st) => st.buyMode);
  const set = useGame((st) => st.set);
  const p = useMe();
  if (!s || !p) return null;
  const w = liveWallet(p, snapAt);
  const open = UPGRADE_IDS.filter((id) => upgradeUnlocked(s, id));
  // Only tease the upgrades whose tree node can be funded now; the rest stay a surprise.
  const locked = UPGRADE_IDS.filter((id) => !upgradeUnlocked(s, id) && nodeOpen(s, UPGRADES[id].needs!));
  return (
    <div className="tab-upgrades">
      <div className="tabhead">
        <div className="seg" role="group" aria-label="Buy amount">
          {([1, 10, 'max'] as BuyMode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => set({ buyMode: m })}>
              {m === 'max' ? 'Max' : `×${m}`}
            </button>
          ))}
        </div>
        <span className="hint">Your own rig. Only you can buy these.</span>
      </div>
      {open.map((id) => (
        <UpgradeRow key={id} s={s} p={p} id={id} mode={mode} budget={w[UPGRADES[id].currency]} />
      ))}
      {locked.length > 0 && (
        <div className="locked">
          {locked.map((id) => {
            const need = UPGRADES[id].needs!;
            return (
              <button key={id} className="lockrow" onClick={() => set({ tab: 'tree', node: need, sheet: true })}>
                <i>🔒</i>
                <span>
                  <b>{UPGRADES[id].name}</b> unlocks with <u>{NODES[need].name}</u> in the Forge Tree
                </span>
              </button>
            );
          })}
        </div>
      )}
      {has(s, 'leap') && <LeapCard s={s} p={p} />}
    </div>
  );
}
