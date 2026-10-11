import {
  CHAIN_CAP,
  COMBO_CAP,
  COMBO_WINDOW_MS,
  CONTRACTS,
  FOREMAN_SHARE,
  LEAP_MIN_ORE,
  MEMORY_LEVELS,
  NODES,
  RENOWN_BONUS,
  RENOWN_BONUS_GUILD,
  ROLES,
  ROLE_IDS,
  UPGRADES,
  UPGRADE_IDS,
  affordable,
  bulkCost,
  canLeap,
  chainMult,
  comboMult,
  contractLabel,
  contractReward,
  critChance,
  critMult,
  droneRate,
  fmt,
  harvesterRate,
  has,
  leapCores,
  leapMult,
  nextMilestone,
  nodeOpen,
  offlineCapS,
  offlineEff,
  onlinePlayers,
  oreForCores,
  refineRate,
  refineShare,
  rigRate,
  roleReadyAt,
  seamMult,
  smeltShare,
  tapValue,
  upgradeCost,
  upgradeUnlocked,
  uplinkMult,
  type PlayerState,
  type RoomState,
  type UpgradeId,
} from '@starforge/shared';
import { act } from '../net/actions';
import { hostNow, useGame, type BuyMode } from '../state/store';
import { Amount, ConfirmButton, Icon, fmtDuration, liveWallet, resStyle, useMe, useRise, useTicker } from './common';

/** Your tap streak as it stands now (it lapses COMBO_WINDOW_MS after your last tap). */
const liveStreak = (p: PlayerState): number => (hostNow() - p.lastStrikeAt <= COMBO_WINDOW_MS ? p.streak : 0);

const milestone = (lv: number): string => `×2 at Lv ${nextMilestone(lv)}`;

/** What an upgrade is doing for you right now. */
function effect(s: RoomState, p: PlayerState, id: UpgradeId): string {
  const mates = Math.max(0, onlinePlayers(s).length - 1);
  switch (id) {
    case 'drill':
      return `${fmt(tapValue(s, p))} ore per tap · ${milestone(p.levels.drill)}`;
    case 'drone':
      return `${fmt(droneRate(s, p))} ore/s · ${milestone(p.levels.drone)}`;
    case 'lens':
      return `${Math.round(critChance(p) * 100)}% crit chance, crits ×${critMult(s)}`;
    case 'combo': {
      const k = liveStreak(p);
      return `Streak ${Math.min(k, COMBO_CAP)}/${COMBO_CAP}: taps ×${comboMult(p, k).toFixed(2)} (full ×${comboMult(p, COMBO_CAP).toFixed(1)})`;
    }
    case 'beacon':
      return `While away: up to ${Math.round(offlineCapS(s, p) / 3600)} h at ${Math.round(offlineEff(s, p) * 100)}%`;
    case 'rig':
      return `${fmt(rigRate(s, p))} ore/s from seams`;
    case 'chain':
      return `Crits in a row pay up to ×${chainMult(p, CHAIN_CAP).toFixed(1)} more`;
    case 'foreman': {
      const lv = p.levels.foreman;
      const what = lv >= 3 ? 'everything' : lv === 2 ? 'producers, Lens, Rigs, Combo, Chain and Smelters' : 'Drills, Drones and Harvesters';
      return `${p.auto ? 'Buys' : 'Paused · buys'} ${what}, up to ${Math.round(FOREMAN_SHARE[Math.min(lv, 3)] * 100)}% of your wallet a level`;
    }
    case 'smelter':
      return `${(smeltShare(s, p) * 100).toFixed(2)}% of your ore becomes alloy`;
    case 'refinery':
      return p.refine ? `${fmt(refineRate(s, p))} alloy/s from ${Math.round(refineShare(p) * 100)}% of your passive ore` : 'Switched off: your passive ore stays ore';
    case 'uplink':
      return mates ? `All income ×${uplinkMult(s, p).toFixed(2)} with ${mates} crewmate${mates === 1 ? '' : 's'} online` : 'Nothing while you play alone';
    case 'scanner':
      return `Seams pay ×${fmt(seamMult(s, p))}`;
    case 'harvester':
      return `${fmt(harvesterRate(s, p))} ore/s · ${milestone(p.levels.harvester)}`;
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
  // Replays the purchase flash each time this level goes up.
  const bought = useRise(lv);
  return (
    <div className={'up' + (ok ? ' ok' : '') + (maxed ? ' maxed' : '')} style={resStyle(def.currency)}>
      <i className={'ico' + (bought.n ? ' pop' : '')} key={'i' + bought.n}>
        {def.icon}
      </i>
      <div className="txt">
        <b>
          {def.name}{' '}
          <em className={bought.n ? 'pop' : ''} key={'l' + bought.n}>
            {maxed ? 'MAX' : `Lv ${lv}`}
          </em>
        </b>
        <span>{lv === 0 ? def.desc : effect(s, p, id)}</span>
      </div>
      {maxed ? (
        <div className="buy done" role="img" aria-label="Maxed">
          <Icon name="check" />
        </div>
      ) : (
        <button className="buy" disabled={!ok} onClick={() => act.buy(id, mode === 'max' ? 1000 : n)}>
          {n > 1 && <small>+{n}</small>}
          <Amount r={def.currency} v={cost} />
        </button>
      )}
      {bought.n > 0 && (
        <>
          <span className="flash" key={'f' + bought.n} aria-hidden />
          <s className="plus" key={'p' + bought.n} aria-hidden>
            +{bought.by}
          </s>
        </>
      )}
    </div>
  );
}

function LeapCard({ s, p }: { s: RoomState; p: PlayerState }) {
  const cores = leapCores(p, s);
  const next = oreForCores(cores + 1, leapMult(s));
  const ready = canLeap(s, p);
  const per = has(s, 'starseed') ? 20 : 10;
  return (
    <div className="card leap">
      <h3>
        <i>🌀</i> Quantum Leap
      </h3>
      <p>
        Restart your own run (ore, alloy and upgrades) for Star Cores. Each core you hold gives +{per}% ore, and the Forge Tree and renown stay.
        {has(s, 'memory') && ` Stellar Memory starts you at Drill ${MEMORY_LEVELS} and Drone ${MEMORY_LEVELS}.`}
        {has(s, 'echo') && ' Quantum Echo keeps your capped upgrades.'}
        {has(s, 'corelens') && ' Core Lens pays ×1.5 cores.'}
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

/** The crew's shared goal: everyone online gets paid when it is done. */
function ContractCard({ s, p }: { s: RoomState; p: PlayerState }) {
  const c = s.contract;
  const now = hostNow();
  const per = Math.round((has(s, 'guild') ? RENOWN_BONUS_GUILD : RENOWN_BONUS) * 100);
  const renown = (
    <p className="hint">
      Renown {s.renown ?? 0}: +{(s.renown ?? 0) * per}% income for everyone in this world, kept through leaps.
    </p>
  );
  if (!c) {
    const wait = Math.max(0, (s.nextContractAt || now) - now) / 1000;
    return (
      <div className="card">
        <h3>
          <i>📋</i> Crew contract
        </h3>
        <p>{wait > 0 ? `Next contract in ${fmtDuration(wait)}.` : 'A new contract is on its way.'}</p>
        {renown}
      </div>
    );
  }
  const def = CONTRACTS[c.kind];
  const pct = Math.min(1, c.progress / c.goal);
  const mine = c.by[p.id] ?? 0;
  return (
    <div className="card">
      <h3>
        <i>{def.icon}</i> Crew contract
      </h3>
      <p>
        {contractLabel(c, fmt)}. Pays everyone online about <b>{fmt(contractReward(s, p))}</b> ore each and +1 renown.
      </p>
      <div className="leaprow">
        <span>
          <b>{fmt(Math.min(c.progress, c.goal))}</b> / {fmt(c.goal)}
          {mine > 0 && c.kind !== 'streak' && <> · you {fmt(mine)}</>}
        </span>
        <span>{fmtDuration(Math.max(0, c.until - now) / 1000)} left</span>
      </div>
      <div className="bar">
        <i style={{ width: `${pct * 100}%` }} />
      </div>
      {renown}
    </div>
  );
}

/** Optional specialisation: double one part of your game and boost your crewmates' share of it. */
function RoleCard({ s, p }: { s: RoomState; p: PlayerState }) {
  const now = hostNow();
  const ready = roleReadyAt(p);
  const wait = Math.max(0, ready - now) / 1000;
  const mates = onlinePlayers(s).filter((q) => q.id !== p.id && q.role);
  const role = p.role ? ROLES[p.role] : null;
  return (
    <div className="card">
      <h3>
        <i>{role ? role.icon : '📜'}</i> Crew role{role ? `: ${role.name}` : ''}
      </h3>
      <p>
        {role
          ? `${role.desc} ${role.aura.replace('Crewmates’', 'Your crewmates’').replace('Crewmates', 'Your crewmates')}`
          : 'Pick a specialty to double one part of your game and boost your crewmates’ share of it. You can still do everything.'}
      </p>
      <div className="nd-needs">
        {ROLE_IDS.map((id) => (
          <button
            key={id}
            className={'chip ' + (p.role === id ? 'owned' : 'open')}
            disabled={p.role === id || wait > 0}
            aria-pressed={p.role === id}
            title={`${ROLES[id].desc} ${ROLES[id].aura}`}
            onClick={() => act.prefs({ role: id })}
          >
            {ROLES[id].icon} {ROLES[id].name}
          </button>
        ))}
        {p.role && (
          <button className="chip" disabled={wait > 0} onClick={() => act.prefs({ role: null })}>
            No role
          </button>
        )}
      </div>
      {(wait > 0 || mates.length > 0) && (
        <p className="hint">
          {mates.length > 0 && <>Crew: {mates.map((q) => `${q.name} (${ROLES[q.role!]?.name ?? q.role})`).join(', ')}. </>}
          {wait > 0 && <>You can switch again in {fmtDuration(wait)}.</>}
        </p>
      )}
    </div>
  );
}

/** On/off switches for the Foreman and the Refinery, once you own them. */
function SwitchesCard({ p }: { p: PlayerState }) {
  if (!p.levels.foreman && !p.levels.refinery) return null;
  return (
    <div className="card">
      <h3>
        <i>🤖</i> Automation
      </h3>
      <div className="nd-needs">
        {p.levels.foreman > 0 && (
          <button className={'chip ' + (p.auto ? 'owned' : '')} aria-pressed={p.auto} onClick={() => act.prefs({ auto: !p.auto })}>
            {UPGRADES.foreman.icon} Foreman {p.auto ? 'on' : 'off'}
          </button>
        )}
        {p.levels.refinery > 0 && (
          <button className={'chip ' + (p.refine ? 'owned' : '')} aria-pressed={p.refine} onClick={() => act.prefs({ refine: !p.refine })}>
            {UPGRADES.refinery.icon} Refinery {p.refine ? 'on' : 'off'}
          </button>
        )}
      </div>
    </div>
  );
}

const MODES: BuyMode[] = [1, 10, 'max'];

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
        <div className="seg" role="group" aria-label="Buy amount" style={{ ['--i' as string]: MODES.indexOf(mode) }}>
          {MODES.map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => set({ buyMode: m })}>
              {m === 'max' ? 'Max' : `×${m}`}
            </button>
          ))}
          <span className="thumb" aria-hidden />
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
                <i>
                  <Icon name="lock" />
                </i>
                <span>
                  <b>{UPGRADES[id].name}</b> unlocks with <u>{NODES[need].name}</u> in the Forge Tree
                </span>
              </button>
            );
          })}
        </div>
      )}
      {has(s, 'core') && <ContractCard s={s} p={p} />}
      {has(s, 'charter') && <RoleCard s={s} p={p} />}
      <SwitchesCard p={p} />
      {has(s, 'leap') && <LeapCard s={s} p={p} />}
    </div>
  );
}
