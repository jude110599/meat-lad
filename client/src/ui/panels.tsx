import type { ReactNode } from 'react';
import {
  LEAP_THRESHOLD,
  MACHINES,
  MACHINE_DEFS,
  OVERCLOCKS,
  OVERCLOCK_IDS,
  RESOURCE_DEFS,
  SKILLS,
  SKILL_IDS,
  UPGRADES,
  critChance,
  droneOrePerSec,
  fmt,
  globalMult,
  isUnlocked,
  machineRate,
  maxCombo,
  onlinePlayers,
  passiveOrePerSec,
  powerMax,
  powerRegen,
  pressYield,
  quantumMult,
  quantumPointsFor,
  refineMult,
  strikeBase,
  upgradeCost,
  type BuffId,
  type MachineId,
  type ResourceId,
  type RoomState,
  type SkillBranch,
  type UpgradeId,
} from '@starforge/shared';
import { act } from '../net/actions';
import { hostNow, useGame } from '../state/store';

export const RES_SHORT: Record<ResourceId, string> = {
  ore: 'ore',
  alloy: 'alloy',
  plasma: 'plasma',
  darkMatter: 'dark matter',
  cosmicEnergy: 'cosmic',
};

export function Cost({ n, res }: { n: number; res: ResourceId }) {
  return (
    <span className="cost" style={{ ['--c' as string]: RESOURCE_DEFS[res].color }}>
      <i />
      {fmt(n)} {RES_SHORT[res]}
    </span>
  );
}

/** How many levels the wallet covers right now (capped at 100). */
function affordable(s: RoomState, id: UpgradeId): { n: number; total: number } {
  const def = UPGRADES[id];
  let lv = s.levels[id];
  let total = 0;
  let n = 0;
  while (n < 100 && (def.maxLevel === undefined || lv < def.maxLevel)) {
    const c = upgradeCost(id, lv);
    if (total + c > s.wallet[def.currency]) break;
    total += c;
    lv++;
    n++;
  }
  return { n, total };
}

function Locked({ s, id }: { s: RoomState; id: UpgradeId }) {
  const def = UPGRADES[id];
  const u = def.unlock!;
  const have = s.run.made[u.res];
  return (
    <div className="card locked">
      <div className="row">
        <b>🔒 {def.name}</b>
      </div>
      <div className="desc">
        Produce {fmt(u.amount)} {RES_SHORT[u.res]} this run to unlock.
      </div>
      <div className="bar thin">
        <i style={{ width: `${Math.min(100, (have / u.amount) * 100)}%`, background: RESOURCE_DEFS[u.res].color }} />
      </div>
    </div>
  );
}

export function UpgradeCard({ s, id, extra }: { s: RoomState; id: UpgradeId; extra?: ReactNode }) {
  const def = UPGRADES[id];
  if (!isUnlocked(s, id)) return <Locked s={s} id={id} />;
  const lv = s.levels[id];
  const maxed = def.maxLevel !== undefined && lv >= def.maxLevel;
  const cost = upgradeCost(id, lv);
  const can = !maxed && s.wallet[def.currency] >= cost;
  const max = affordable(s, id);
  return (
    <div className={'card' + (can ? ' can' : '')}>
      <div className="row">
        <b>{def.name}</b>
        <small>
          Lv {lv}
          {def.maxLevel !== undefined ? ` / ${def.maxLevel}` : ''}
        </small>
      </div>
      <div className="desc">{def.desc}</div>
      {extra}
      <div className="buy">
        {maxed ? (
          <span className="maxed">MAXED</span>
        ) : (
          <>
            <button className="b1" disabled={!can} onClick={() => act.buy(id)}>
              Buy <Cost n={cost} res={def.currency} />
            </button>
            {max.n > 1 && (
              <button className="bmax" onClick={() => act.buy(id, max.n)}>
                ×{max.n}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="stat">
      <b>{v}</b>
      <span>{k}</span>
    </div>
  );
}

export function MiningTab({ s }: { s: RoomState }) {
  const g = globalMult(s);
  return (
    <>
      <div className="stats">
        <Stat k="per strike" v={fmt(strikeBase(s.levels, s.skills, g))} />
        <Stat k="crit ×5" v={`${Math.round(critChance(s.levels, (s.buffs.focusField ?? 0) > hostNow()) * 100)}%`} />
        <Stat k="drones /s" v={fmt(droneOrePerSec(s.levels, g))} />
        <Stat k="passive /s" v={fmt(passiveOrePerSec(s))} />
      </div>
      {(['drillBit', 'focusLens', 'drone', 'coolant', 'rig', 'seismic'] as UpgradeId[]).map((id) => (
        <UpgradeCard key={id} s={s} id={id} />
      ))}
      <p className="tip">Tip: strike glowing seams for ×3. A seam that cracks open pays ×4. Keep the drill hot (×2) without overheating.</p>
    </>
  );
}

const MACHINE_KEYS: Record<MachineId, string> = { smelter: '1', infuser: '2', compressor: '3', condenser: '4' };

function MachineCard({ s, m }: { s: RoomState; m: MachineId }) {
  const lastPress = useGame((st) => st.lastPress);
  const def = MACHINE_DEFS[m];
  const lv = s.levels[m];
  if (!isUnlocked(s, m)) return <Locked s={s} id={m} />;
  const g = globalMult(s);
  const rate = machineRate(m, s.levels, s.skills, g) * refineMult(s);
  const press = pressYield(m, s.levels, s.skills, g) * s.combo * refineMult(s);
  const on = s.machinesOn[m];
  const starved = lv > 0 && on && s.wallet[def.input] < def.ratio;
  const flash = lastPress?.machine === m && performance.now() - lastPress.at < 160;
  const color = RESOURCE_DEFS[def.output].color;
  return (
    <UpgradeCard
      s={s}
      id={m}
      extra={
        lv > 0 && (
          <div className="machine" style={{ ['--c' as string]: color }}>
            <div className="flow">
              <span>
                {RES_SHORT[def.input]} → <b>{RES_SHORT[def.output]}</b>
              </span>
              <span className={starved ? 'warn' : ''}>
                {on ? (starved ? `needs ${RES_SHORT[def.input]}` : `+${fmt(rate)}/s`) : 'paused'}
              </span>
              <label className="switch" title={on ? 'Running' : 'Paused'}>
                <input type="checkbox" checked={on} onChange={(e) => act.toggle(m, e.target.checked)} />
                <i />
              </label>
            </div>
            <button className={'press' + (flash ? ' flash' : '')} onPointerDown={() => act.press(m)}>
              PRESS <span>+{fmt(press)} {RES_SHORT[def.output]}</span>
              <kbd>{MACHINE_KEYS[m]}</kbd>
            </button>
          </div>
        )
      }
    />
  );
}

export function RefineryTab({ s }: { s: RoomState }) {
  const cap = maxCombo(s.skills);
  return (
    <>
      <p className="tip">
        Press a machine right after a strike (within 0.6 s) to build the <b>sync combo</b> up to ×{cap.toFixed(2)}. Solo, alternate clicks; in a party,
        miners and refiners keep it going together.
      </p>
      {MACHINES.map((m) => (
        <MachineCard key={m} s={s} m={m} />
      ))}
      <UpgradeCard s={s} id="press" />
      <UpgradeCard s={s} id="reactor" />
    </>
  );
}

export function PowerTab({ s }: { s: RoomState }) {
  const max = powerMax(s.levels);
  const now = hostNow();
  return (
    <>
      <div className="card">
        <div className="row">
          <b>⚡ Station power</b>
          <small>
            {Math.floor(s.power)} / {max}
          </small>
        </div>
        <div className="bar power">
          <i style={{ width: `${(s.power / max) * 100}%` }} />
        </div>
        <div className="desc">+{powerRegen(s.levels, s.skills).toFixed(1)}/s, and every press adds more. Fusion Reactors raise both.</div>
      </div>
      {OVERCLOCK_IDS.map((id) => {
        const d = OVERCLOCKS[id];
        const left = d.ms ? Math.max(0, (s.buffs[id as BuffId] ?? 0) - now) : 0;
        return (
          <div key={id} className={'card' + (s.power >= d.cost ? ' can' : '')}>
            <div className="row">
              <b>{d.name}</b>
              <small>{d.ms ? `${d.ms / 1000}s` : 'instant'}</small>
            </div>
            <div className="desc">{d.desc}</div>
            {left > 0 && (
              <div className="bar thin">
                <i style={{ width: `${(left / d.ms) * 100}%` }} />
              </div>
            )}
            <div className="buy">
              <button className="b1" disabled={s.power < d.cost} onClick={() => act.overclock(id)}>
                {left > 0 ? 'Extend' : 'Fire'} <span className="cost pow">⚡ {d.cost}</span>
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

const BRANCHES: { id: SkillBranch; name: string; color: string }[] = [
  { id: 'excavation', name: 'Excavation', color: '#ffb03a' },
  { id: 'industry', name: 'Industry', color: '#4de8ff' },
  { id: 'resonance', name: 'Resonance', color: '#b07cff' },
];

export function QuantumTab({ s }: { s: RoomState }) {
  const me = useGame((st) => st.me);
  const online = onlinePlayers(s).length;
  const ce = s.run.cosmicEnergy;
  const qp = quantumPointsFor(ce, online);
  const ready = ce >= LEAP_THRESHOLD;
  const voted = s.vote && (s.vote.yes.includes(me) || s.vote.no.includes(me));
  return (
    <>
      <div className="card quantum">
        <div className="row">
          <b>✦ Quantum Leap</b>
          <small>{s.quantumPoints} QP banked · ×{quantumMult(s.quantumPoints).toFixed(2)} everything</small>
        </div>
        <div className="desc">
          Reset this asteroid for Quantum Points. Every unspent point adds +5% to all income, and skills are permanent. More players in the party = more points.
        </div>
        <div className="bar">
          <i style={{ width: `${Math.min(100, (ce / LEAP_THRESHOLD) * 100)}%`, background: RESOURCE_DEFS.cosmicEnergy.color }} />
        </div>
        <div className="desc">
          {fmt(ce)} / {LEAP_THRESHOLD} cosmic energy this run{ready ? ` · leap now for +${qp} QP` : ''}
        </div>
        <div className="buy">
          {s.vote ? (
            voted ? (
              <span className="maxed">Vote in progress…</span>
            ) : (
              <>
                <button className="b1" onClick={() => act.vote(true)}>
                  Vote yes
                </button>
                <button className="bmax" onClick={() => act.vote(false)}>
                  No
                </button>
              </>
            )
          ) : (
            <button className="b1 leap" disabled={!ready} onClick={() => act.leap()}>
              {online > 1 ? 'Propose leap to the party' : 'Quantum Leap'} {ready && `(+${qp} QP)`}
            </button>
          )}
        </div>
      </div>
      <div className="tree">
        {BRANCHES.map((b) => (
          <div key={b.id} className="branch" style={{ ['--c' as string]: b.color }}>
            <h4>{b.name}</h4>
            {SKILL_IDS.filter((id) => SKILLS[id].branch === b.id).map((id) => {
              const d = SKILLS[id];
              const lv = s.skills[id];
              const maxed = lv >= d.max;
              return (
                <button key={id} className={'skill' + (lv ? ' owned' : '')} disabled={maxed || s.quantumPoints < d.cost} onClick={() => act.skill(id)}>
                  <b>{d.name}</b>
                  <span>{d.desc}</span>
                  <em>
                    {lv}/{d.max} · {maxed ? 'max' : `${d.cost} QP`}
                  </em>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="stats">
        <Stat k="leaps" v={String(s.leaps)} />
        <Stat k="events won" v={`${s.eventsWon}/${s.eventsWon + s.eventsLost}`} />
        <Stat k="lifetime ore" v={fmt(s.lifetime.ore)} />
        <Stat k="strikes" v={fmt(s.lifetime.strikes)} />
      </div>
    </>
  );
}

