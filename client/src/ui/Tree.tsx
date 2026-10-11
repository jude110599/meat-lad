import { useLayoutEffect, useRef, useState } from 'react';
import {
  NODES,
  NODE_IDS,
  UPGRADES,
  UPGRADE_IDS,
  fmt,
  fundBonus,
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
import { Amount, ConfirmButton, Icon, RES_LABEL, fmtDuration, liveWallet, resStyle, useMe, useRise, useTicker } from './common';

/* ---------------- star-map geometry (CSS px) ---------------- */

/** Height of one tier row. */
const ROW = 96;
/** Top of the map to the first row's gem centre. */
const TOP = 48;
/** Fraction of the map's width per unit of a node's x (-1.5..1.5 spans 12.5%..87.5%). */
const SPREAD = 0.25;
/** Size of a node's ring (the gem sits inside it) and of its button. */
const RING = 56;
const NODE_W = 88;
const TIERS = Math.max(...NODE_IDS.map((id) => NODES[id].tier)) + 1;
const MAP_H = TOP + (TIERS - 1) * ROW + 66;

const xAt = (w: number, x: number): number => w * (0.5 + x * SPREAD);
const yAt = (tier: number): number => TOP + tier * ROW;

const EDGES = NODE_IDS.flatMap((id) => NODES[id].needs.map((from) => ({ from, to: id, key: from + '>' + id })));

/** A stable 0..1 number per string, to stagger the energy pulses. */
function seed(k: string): number {
  let h = 2166136261;
  for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

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

/** Could this wallet pay everything still owed on the node? Pass the player to count a Refiner's bonus. */
export function canFinish(s: RoomState, id: NodeId, w: Wallet, p?: PlayerState): boolean {
  if (!nodeFundable(s, id)) return false;
  return (Object.entries(nodeRemaining(s, id)) as [ResourceId, number][]).every(([r, v]) => w[r] * (p ? fundBonus(s, p, r) : 1) >= v - 1e-9);
}

/* ---------------- pieces ---------------- */

const ARC_R = 27;
const ARC_C = 2 * Math.PI * ARC_R;

/** A hex gem inside a progress ring: a full gold orbit when owned, a glowing arc while it's being funded. */
function Gem({ st, p, icon, children }: { st: Status; p: number; icon: React.ReactNode; children?: React.ReactNode }) {
  const a = p * 2 * Math.PI;
  const partial = st === 'open' && p > 0 && p < 1;
  return (
    <span className="ring" style={{ ['--p' as string]: p }}>
      <svg className="arc" viewBox="0 0 60 60" aria-hidden>
        <circle className="trk" cx="30" cy="30" r={ARC_R} />
        {partial && (
          <>
            <circle className="val glow" cx="30" cy="30" r={ARC_R} strokeDasharray={`${p * ARC_C} ${ARC_C}`} transform="rotate(-90 30 30)" />
            <circle className="val" cx="30" cy="30" r={ARC_R} strokeDasharray={`${p * ARC_C} ${ARC_C}`} transform="rotate(-90 30 30)" />
            <circle className="head" cx={30 + ARC_R * Math.sin(a)} cy={30 - ARC_R * Math.cos(a)} r="2.6" />
          </>
        )}
      </svg>
      <span className="hex">
        <i>{icon}</i>
      </span>
      {children}
    </span>
  );
}

const SPARKS = [0, 40, 80, 120, 160, 200, 240, 280, 320];

/** Rings and sparkles when a node completes. Mount it with a new key to replay. */
function Burst() {
  return (
    <span className="burst" aria-hidden>
      <i className="flare" />
      <i className="gflash" />
      <i className="r1" />
      <i className="r2" />
      {SPARKS.map((d) => (
        <b key={d} style={{ transform: `rotate(${d}deg)` }} />
      ))}
    </span>
  );
}

function TreeNode({ s, p, w, id, x, y }: { s: RoomState; p: PlayerState; w: Wallet; id: NodeId; x: number; y: number }) {
  const set = useGame((st) => st.set);
  const def = NODES[id];
  const st = status(s, id);
  const lv = nodeLevel(s, id);
  const pct = st === 'owned' ? 1 : st === 'open' ? nodeProgress(s, id) : 0;
  const ready = st === 'open' && canFinish(s, id, w, p);
  const done = useRise(lv);
  return (
    <button
      className={`node ${st}${ready ? ' ready' : ''}${pct > 0 && st === 'open' ? ' started' : ''}`}
      style={{ left: x - NODE_W / 2, top: y - RING / 2 }}
      onClick={() => set({ node: id })}
      aria-label={`${def.name}${def.repeat && lv > 0 ? ` level ${lv}` : ''}: ${st === 'owned' ? 'unlocked' : st === 'open' ? (ready ? 'ready to finish' : `open, ${Math.floor(pct * 100)}% funded`) : 'locked'}`}
    >
      <Gem st={st} p={pct} icon={st === 'locked' ? <Icon name="lock" /> : def.icon}>
        {done.n > 0 && <Burst key={done.n} />}
      </Gem>
      <small>
        {def.name}
        {def.repeat && lv > 0 ? ` ${lv}` : ''}
      </small>
    </button>
  );
}

/** The map's width, kept in sync so edges, pulses and nodes share one pixel grid. */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 360 : window.innerWidth >= 900 ? 356 : window.innerWidth - 16));
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => el.clientWidth > 0 && setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** Where the map was scrolled when it was last closed; null until it has been opened once. */
let savedScroll: number | null = null;

function TreeMap({ s, p, w }: { s: RoomState; p: PlayerState; w: Wallet }) {
  const ref = useRef<HTMLDivElement>(null);
  const W = useWidth(ref);
  const owned = NODE_IDS.filter((id) => has(s, id)).length;

  // Come back to where you were; the first time, bring the frontier into view.
  useLayoutEffect(() => {
    const tree = ref.current;
    const sc = tree?.closest('.scroll') as HTMLElement | null;
    if (!tree || !sc) return;
    if (savedScroll !== null) sc.scrollTop = savedScroll;
    else {
      const target = tree.querySelector<HTMLElement>('.node.ready, .node.open');
      if (target) {
        const off = target.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
        if (off + RING > sc.clientHeight - 24) sc.scrollTop = Math.max(0, off - 110);
      }
    }
    return () => {
      savedScroll = sc.scrollTop;
    };
  }, []);

  const pos = (id: NodeId) => ({ x: xAt(W, NODES[id].x), y: yAt(NODES[id].tier) });

  return (
    <>
      <div className="tabhead treehead">
        <h2>
          Forge Tree <em>{owned}/{NODE_IDS.length}</em>
        </h2>
        <span className="tprog" aria-hidden>
          <i style={{ width: `${(owned / NODE_IDS.length) * 100}%` }} />
        </span>
        <span className="hint">Shared by the whole crew. Anyone can chip in, and every node unlocks for everyone, for good.</span>
      </div>
      <div className="tree" ref={ref} style={{ height: MAP_H }}>
        <span className="sky" aria-hidden />
        <svg className="edges" width={W} height={MAP_H} viewBox={`0 0 ${W} ${MAP_H}`} aria-hidden>
          <defs>
            {EDGES.map((e) => {
              if (!has(s, e.from) || has(s, e.to)) return null;
              const a = pos(e.from);
              const b = pos(e.to);
              return (
                <linearGradient key={e.key} id={'sf-e-' + e.key} gradientUnits="userSpaceOnUse" x1={a.x} y1={a.y} x2={b.x} y2={b.y}>
                  <stop offset="0" stopColor="#ffe28a" />
                  <stop offset="1" stopColor="#ffb03a" stopOpacity="0.35" />
                </linearGradient>
              );
            })}
          </defs>
          {EDGES.map((e) => {
            const a = pos(e.from);
            const b = pos(e.to);
            const lit = has(s, e.from);
            const kind = lit && has(s, e.to) ? 'done' : lit ? 'lit' : 'dark';
            return (
              <g key={e.key} className={kind}>
                {kind !== 'dark' && <line className="halo" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />}
                <line className="core" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={kind === 'lit' ? `url(#sf-e-${e.key})` : undefined} />
              </g>
            );
          })}
        </svg>
        {/* Energy pulses: plain rotated boxes whose spark slides with a transform, so they stay on the compositor. */}
        <div className="flows" aria-hidden>
          {EDGES.map((e) => {
            if (!has(s, e.from)) return null;
            const a = pos(e.from);
            const b = pos(e.to);
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            const done = has(s, e.to);
            const dur = done ? 2.4 + len / 55 : 1.1 + len / 80;
            return (
              <span
                key={e.key}
                className={'flow ' + (done ? 'done' : 'lit')}
                style={{ left: a.x, top: a.y, width: len, transform: `rotate(${Math.atan2(b.y - a.y, b.x - a.x)}rad)` }}
              >
                <i style={{ animationDuration: `${dur.toFixed(2)}s`, animationDelay: `${(-seed(e.key) * dur).toFixed(2)}s` }} />
              </span>
            );
          })}
        </div>
        {NODE_IDS.map((id) => {
          const { x, y } = pos(id);
          return <TreeNode key={id} s={s} p={p} w={w} id={id} x={x} y={y} />;
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
  // A Refiner's ore and alloy count for more than they cost.
  const bonus = fundBonus(s, p, r);
  const all = Math.min(owed / bonus, have);
  const finishes = all * bonus >= owed - 1e-9;
  const rate = r === 'ore' ? p.rates.ore : r === 'alloy' ? p.rates.alloy : 0;
  const chip = useRise(funded);
  return (
    <div className="fund" style={resStyle(r)}>
      <div className="frow">
        <span>
          <Amount r={r} v={funded} /> <em>/ {fmt(cost)}</em>
        </span>
        <b className={chip.n ? 'pop' : ''} key={chip.n}>
          {Math.floor((funded / cost) * 100)}%
        </b>
      </div>
      <div className="bar">
        <i style={{ width: `${(funded / cost) * 100}%` }} />
      </div>
      {owed > 0 && (
        <>
          <div className="fbtns">
            {SHARES.map(({ pct, label }) => {
              const raw = Math.min(owed / bonus, have * pct);
              const amt = r === 'cores' ? Math.floor(raw) : raw;
              return (
                <button key={label} disabled={amt < 1} onClick={() => act.fund(id, r, amt)}>
                  {label} of mine
                  <small>{fmt(amt)}</small>
                </button>
              );
            })}
            <ConfirmButton
              className={finishes ? 'finish' : ''}
              disabled={all <= 0}
              onConfirm={() => act.fund(id, r, all)}
              armed={
                <>
                  Confirm
                  <small>{fmt(all)}</small>
                </>
              }
            >
              {finishes ? 'Finish it' : 'All I can'}
              <small>{fmt(all)}</small>
            </ConfirmButton>
          </div>
          <p className="fnote">
            You have {fmt(have)} {RES_LABEL[r]}.
            {bonus > 1 && ` As a Refiner, yours counts ×${bonus}.`}
            {r === 'cores'
              ? ' Cores you spend stop boosting your ore.'
              : rate > 0 && !finishes
                ? ` The rest is about ${fmtDuration((owed / bonus - have) / rate)} of your passive income.`
                : ''}
          </p>
        </>
      )}
    </div>
  );
}

function NodeDetail({ s, p, w, id }: { s: RoomState; p: PlayerState; w: Wallet; id: NodeId }) {
  const set = useGame((st) => st.set);
  const ref = useRef<HTMLDivElement>(null);
  const def = NODES[id];
  const st = status(s, id);
  const lv = nodeLevel(s, id);
  const cost = nodeCost(id, lv);
  const unlocks = UPGRADE_IDS.filter((u) => UPGRADES[u].needs === id);
  const leadsTo = NODE_IDS.filter((n) => NODES[n].needs.includes(id));
  const by = Object.entries(s.tree[id]?.by ?? {}).sort((a, b) => b[1] - a[1]);
  const done = useRise(lv);
  const ready = st === 'open' && canFinish(s, id, w, p);

  // A node's page always opens at its top, wherever the map was scrolled.
  useLayoutEffect(() => {
    const sc = ref.current?.closest('.scroll');
    if (sc) sc.scrollTop = 0;
  }, [id]);

  return (
    <div className="nodedetail" ref={ref}>
      <button className="backlink" onClick={() => set({ node: null })}>
        <Icon name="back" /> Forge Tree
      </button>
      <div className={'nd-head ' + st + (ready ? ' ready' : '')}>
        <Gem st={st} p={st === 'owned' ? 1 : nodeProgress(s, id)} icon={def.icon}>
          {done.n > 0 && <Burst key={done.n} />}
        </Gem>
        <div>
          <h2>
            {def.name}
            {def.repeat ? ` · Lv ${lv}` : ''}
          </h2>
          <span className={'chip ' + st}>
            {st === 'owned' ? <Icon name="check" /> : st === 'locked' ? <Icon name="lock" /> : <i className="pip" />}
            {st === 'owned' ? 'Unlocked for the crew' : st === 'open' ? 'Ready to fund' : 'Locked'}
          </span>
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
              <Icon name={has(s, n) ? 'check' : 'lock'} /> {NODES[n].name}
            </button>
          ))}
        </div>
      )}
      {st === 'open' && (
        <div className="nd-cost">
          {(Object.entries(cost) as [ResourceId, number][]).map(([r, v]) => (
            <FundResource key={r} s={s} p={p} w={w} id={id} r={r} cost={v} />
          ))}
        </div>
      )}
      {st === 'locked' && (
        <div className="nd-cost">
          <div className="frow">
            <span>Costs</span>
            <span className="costs">
              {(Object.entries(cost) as [ResourceId, number][]).map(([r, v]) => (
                <Amount key={r} r={r} v={v} label />
              ))}
            </span>
          </div>
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
  return node ? <NodeDetail s={s} p={p} w={w} id={node} /> : <TreeMap s={s} p={p} w={w} />;
}
