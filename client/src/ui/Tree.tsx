import {
  NODES,
  NODE_IDS,
  UPGRADES,
  UPGRADE_IDS,
  fmt,
  has,
  nodeCost,
  nodeFundable,
  nodeLevel,
  nodeRemaining,
  type NodeId,
  type PlayerState,
  type ResourceId,
  type RoomState,
  type Wallet,
} from '@starforge/shared';
import { act } from '../net/actions';
import { hueColor } from '../state/refs';
import { useGame } from '../state/store';
import { Amount, ConfirmButton, RES_LABEL, fmtDuration, liveWallet, resStyle, useMe, useTicker } from './common';

const ROW = 84;
const TIERS = Math.max(...NODE_IDS.map((id) => NODES[id].tier)) + 1;
const xPct = (x: number): number => 50 + x * 21;
const yPx = (tier: number): number => tier * ROW + 36;

type Status = 'owned' | 'open' | 'locked';

function status(s: RoomState, id: NodeId): Status {
  if (nodeFundable(s, id)) return 'open';
  return has(s, id) ? 'owned' : 'locked';
}

/** Fraction of the next level paid for, 0..1. */
export function nodeProgress(s: RoomState, id: NodeId): number {
  const cost = Object.entries(nodeCost(id, nodeLevel(s, id))) as [ResourceId, number][];
  const funded = s.tree[id]?.funded ?? {};
  return cost.reduce((a, [r, v]) => a + Math.min(1, (funded[r] ?? 0) / v), 0) / cost.length;
}

/** Could this wallet pay everything still owed on the node? */
export function canFinish(s: RoomState, id: NodeId, w: Wallet): boolean {
  if (!nodeFundable(s, id)) return false;
  return (Object.entries(nodeRemaining(s, id)) as [ResourceId, number][]).every(([r, v]) => w[r] >= v);
}

function TreeMap({ s, w }: { s: RoomState; w: Wallet }) {
  const set = useGame((st) => st.set);
  const owned = NODE_IDS.filter((id) => has(s, id)).length;
  return (
    <>
      <div className="tabhead">
        <h2>
          Forge Tree <em>{owned}/{NODE_IDS.length}</em>
        </h2>
        <span className="hint">Shared by the whole crew. Anyone can chip in, and every node unlocks for everyone, for good.</span>
      </div>
      <div className="tree" style={{ height: TIERS * ROW }}>
        <svg className="edges" viewBox={`0 0 100 ${TIERS * ROW}`} preserveAspectRatio="none" aria-hidden>
          {NODE_IDS.flatMap((id) =>
            NODES[id].needs.map((n) => {
              const lit = has(s, n);
              const done = lit && has(s, id);
              return (
                <line
                  key={n + id}
                  className={done ? 'done' : lit ? 'lit' : ''}
                  x1={xPct(NODES[n].x)}
                  y1={yPx(NODES[n].tier)}
                  x2={xPct(NODES[id].x)}
                  y2={yPx(NODES[id].tier)}
                  vectorEffect="non-scaling-stroke"
                />
              );
            }),
          )}
        </svg>
        {NODE_IDS.map((id) => {
          const def = NODES[id];
          const st = status(s, id);
          const lv = nodeLevel(s, id);
          const pct = st === 'owned' ? 1 : st === 'open' ? nodeProgress(s, id) : 0;
          const ready = st === 'open' && canFinish(s, id, w);
          return (
            <button
              key={id}
              className={`node ${st}${ready ? ' ready' : ''}${pct > 0 && st === 'open' ? ' started' : ''}`}
              style={{ left: `${xPct(def.x)}%`, top: yPx(def.tier) - 26 }}
              onClick={() => set({ node: id })}
            >
              <span className="ring" style={{ ['--p' as string]: pct }}>
                <i>{st === 'locked' ? '🔒' : def.icon}</i>
              </span>
              <small>
                {def.name}
                {def.repeat && lv > 0 ? ` ${lv}` : ''}
              </small>
            </button>
          );
        })}
      </div>
    </>
  );
}

const SHARES: { pct: number; label: string }[] = [
  { pct: 0.1, label: '10%' },
  { pct: 0.5, label: '50%' },
];

function FundResource({ s, p, w, id, r, cost }: { s: RoomState; p: PlayerState; w: Wallet; id: NodeId; r: ResourceId; cost: number }) {
  const funded = s.tree[id]?.funded?.[r] ?? 0;
  const owed = Math.max(0, cost - funded);
  const have = w[r];
  const all = Math.min(owed, have);
  const rate = r === 'ore' ? p.rates.ore : r === 'alloy' ? p.rates.alloy : 0;
  return (
    <div className="fund" style={resStyle(r)}>
      <div className="frow">
        <span>
          <Amount r={r} v={funded} /> <em>/ {fmt(cost)}</em>
        </span>
        <b>{Math.floor((funded / cost) * 100)}%</b>
      </div>
      <div className="bar">
        <i style={{ width: `${(funded / cost) * 100}%` }} />
      </div>
      {owed > 0 && (
        <>
          <div className="fbtns">
            {SHARES.map(({ pct, label }) => {
              const raw = Math.min(owed, have * pct);
              const amt = r === 'cores' ? Math.floor(raw) : raw;
              return (
                <button key={label} disabled={amt < 1} onClick={() => act.fund(id, r, amt)}>
                  {label} of mine
                  <small>{fmt(amt)}</small>
                </button>
              );
            })}
            <ConfirmButton
              className={all >= owed ? 'finish' : ''}
              disabled={all <= 0}
              onConfirm={() => act.fund(id, r, all)}
              armed={
                <>
                  Confirm
                  <small>{fmt(all)}</small>
                </>
              }
            >
              {all >= owed ? 'Finish it' : 'All I can'}
              <small>{fmt(all)}</small>
            </ConfirmButton>
          </div>
          <p className="fnote">
            You have {fmt(have)} {RES_LABEL[r]}.
            {r === 'cores'
              ? ' Cores you spend stop boosting your ore.'
              : rate > 0 && owed > have
                ? ` The rest is about ${fmtDuration((owed - have) / rate)} of your passive income.`
                : ''}
          </p>
        </>
      )}
    </div>
  );
}

function NodeDetail({ s, p, w, id }: { s: RoomState; p: PlayerState; w: Wallet; id: NodeId }) {
  const set = useGame((st) => st.set);
  const def = NODES[id];
  const st = status(s, id);
  const lv = nodeLevel(s, id);
  const cost = nodeCost(id, lv);
  const unlocks = UPGRADE_IDS.filter((u) => UPGRADES[u].needs === id);
  const leadsTo = NODE_IDS.filter((n) => NODES[n].needs.includes(id));
  const by = Object.entries(s.tree[id]?.by ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="nodedetail">
      <button className="backlink" onClick={() => set({ node: null })}>
        ← Forge Tree
      </button>
      <div className={'nd-head ' + st}>
        <span className="ring" style={{ ['--p' as string]: st === 'owned' ? 1 : nodeProgress(s, id) }}>
          <i>{def.icon}</i>
        </span>
        <div>
          <h2>
            {def.name}
            {def.repeat ? ` · Lv ${lv}` : ''}
          </h2>
          <span className={'chip ' + st}>{st === 'owned' ? 'Unlocked for the crew' : st === 'open' ? 'Ready to fund' : 'Locked'}</span>
        </div>
      </div>
      <p className="nd-desc">{def.desc}</p>
      {unlocks.length > 0 && (
        <p className="nd-meta">
          Unlocks the{' '}
          {unlocks.map((u, i) => (
            <b key={u}>
              {i ? ' and ' : ''}
              {UPGRADES[u].icon} {UPGRADES[u].name}
            </b>
          ))}{' '}
          upgrade.
        </p>
      )}
      {st === 'locked' && (
        <div className="nd-needs">
          <span>Needs</span>
          {def.needs.map((n) => (
            <button key={n} className={'chip ' + (has(s, n) ? 'owned' : 'locked')} onClick={() => set({ node: n })}>
              {has(s, n) ? '✓' : '✗'} {NODES[n].name}
            </button>
          ))}
        </div>
      )}
      {st !== 'owned' && (
        <div className="nd-cost">
          {(Object.entries(cost) as [ResourceId, number][]).map(([r, v]) =>
            st === 'open' ? (
              <FundResource key={r} s={s} p={p} w={w} id={id} r={r} cost={v} />
            ) : (
              <div key={r} className="frow">
                <span>Costs</span>
                <Amount r={r} v={v} label />
              </div>
            ),
          )}
        </div>
      )}
      {by.length > 0 && (
        <div className="credits">
          <span>{st === 'owned' ? 'Funded by' : 'Chipped in so far'}</span>
          {by.map(([pid, share]) => {
            const q = s.players[pid];
            return (
              <em key={pid} style={{ ['--c' as string]: hueColor(q?.hue ?? 200, 66) }}>
                <i />
                {q?.name ?? 'Former crewmate'} {Math.round(share * 100)}%
              </em>
            );
          })}
        </div>
      )}
      {leadsTo.length > 0 && (
        <div className="nd-needs">
          <span>Leads to</span>
          {leadsTo.map((n) => (
            <button key={n} className={'chip ' + status(s, n)} onClick={() => set({ node: n })}>
              {NODES[n].icon} {NODES[n].name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TreeTab() {
  useTicker(250);
  const s = useGame((st) => st.s);
  const snapAt = useGame((st) => st.snapAt);
  const node = useGame((st) => st.node);
  const p = useMe();
  if (!s || !p) return null;
  const w = liveWallet(p, snapAt);
  return node ? <NodeDetail s={s} p={p} w={w} id={node} /> : <TreeMap s={s} w={w} />;
}
