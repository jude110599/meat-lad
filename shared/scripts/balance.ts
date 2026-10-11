/**
 * Headless pacing check (`npm run balance`): one solo player who taps 5 times
 * a second (half of them on glowing seams), buys the personal upgrade that
 * pays itself back fastest, and saves up for a Forge Tree node whenever one
 * costs less than SAVE_FOR seconds of income. Prints when each node unlocks
 * and when Quantum Leaps happen, to compare against DESIGN.md §12.3.
 */
import {
  NODES,
  NODE_IDS,
  UPGRADES,
  UPGRADE_IDS,
  addPlayer,
  applyStrike,
  buyUpgrade,
  canLeap,
  critChance,
  critMult,
  createRoomState,
  fmt,
  fundNode,
  has,
  leap,
  leapCores,
  nodeFundable,
  nodeRemaining,
  passiveOrePerSec,
  rng,
  seamMult,
  tapValue,
  tickRoom,
  upgradeCost,
  upgradeUnlocked,
  type NodeId,
  type PlayerState,
  type ResourceId,
  type RoomState,
  type UpgradeId,
} from '../src/index.js';

const TAPS = Number(process.env.TAPS ?? 5);
const SEAM_SHARE = 0.5;
const SAVE_FOR = Number(process.env.SAVE_FOR ?? 360);
const HOURS = Number(process.env.HOURS ?? 6);
const LEAPS = Number(process.env.LEAPS ?? 3);

const r = rng(42);
let now = 0;
const s = createRoomState(7, now);
const p = addPlayer(s, 'p', 'bot', 'Bot', now).player;
const log = (t: string) => console.log(`${clock(now)}  ${t}`);
function clock(ms: number): string {
  const m = Math.floor(ms / 60000);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`;
}

/** Ore per second this player makes, taps included. */
function income(st: RoomState, pl: PlayerState): number {
  const tap = tapValue(st, pl) * (1 + critChance(pl) * (critMult(st) - 1)) * (1 - SEAM_SHARE + SEAM_SHARE * seamMult(st, pl) * 1.5);
  return TAPS * tap + passiveOrePerSec(st, pl);
}

/** Income gained per unit spent, by trying the purchase on a copy. */
function valueOf(id: UpgradeId): number {
  const def = UPGRADES[id];
  if (def.maxLevel !== undefined && p.levels[id] >= def.maxLevel) return 0;
  if (!upgradeUnlocked(s, id)) return 0;
  const cost = upgradeCost(id, p.levels[id]);
  if (id === 'smelter') return (income(s, p) * 0.004) / cost; // alloy matters once alloy prices show up
  const base = income(s, p);
  p.levels[id]++;
  const after = income(s, p);
  p.levels[id]--;
  return (after - base) / cost;
}

function target(): NodeId | null {
  const inc = income(s, p);
  let best: NodeId | null = null;
  let bestCost = Infinity;
  for (const id of NODE_IDS) {
    if (!nodeFundable(s, id) || id === 'mastery') continue;
    const rem = nodeRemaining(s, id);
    const cost = (rem.ore ?? 0) + (rem.alloy ?? 0) * 200 + (rem.cores ?? 0) * 1e15;
    if ((rem.cores ?? 0) > p.wallet.cores) continue;
    if (id !== 'leap' && (rem.ore ?? 0) > inc * SAVE_FOR && (rem.cores ?? 0) === 0) continue;
    if (cost < bestCost) {
      best = id;
      bestCost = cost;
    }
  }
  return best;
}

let leaps = 0;
const end = HOURS * 3600_000;
let lastReport = 0;
let tapAcc = 0;
while (now < end && leaps < LEAPS) {
  now += 1000;
  tickRoom(s, 1, now, r);
  tapAcc += TAPS;
  for (; tapAcc >= 1; tapAcc--) {
    const seam = r() < SEAM_SHARE ? s.seams[0]?.id ?? null : null;
    p.lastStrikeAt = 0;
    applyStrike(s, 'p', seam, now, r());
  }
  const goal = target();
  if (goal) {
    for (const res of ['cores', 'alloy', 'ore'] as ResourceId[]) {
      const out = fundNode(s, 'p', goal, res, 1e300);
      if (typeof out !== 'string' && out.done) log(`unlocked ${NODES[goal].name.padEnd(18)} ore/s ${fmt(income(s, p))}`);
    }
  }
  // Spend what's left (all of it when not saving, only small change when saving).
  for (let i = 0; i < 200; i++) {
    let best: UpgradeId | null = null;
    let bv = 0;
    for (const id of UPGRADE_IDS) {
      const def = UPGRADES[id];
      const cost = upgradeCost(id, p.levels[id]);
      if (p.wallet[def.currency] < cost) continue;
      if (goal && def.currency !== 'cores') {
        const rem = nodeRemaining(s, goal)[def.currency] ?? 0;
        if (rem > 0 && cost > rem * 0.02) continue;
      }
      const v = valueOf(id) * (def.currency === 'alloy' ? 200 : 1);
      if (v > bv) {
        bv = v;
        best = id;
      }
    }
    if (!best) break;
    buyUpgrade(s, 'p', best, 1);
  }
  if (canLeap(s, p) && leapCores(p) >= Math.max(4, Math.ceil(0.4 * p.stats.cores))) {
    log(`LEAP ${leaps + 1}: +${leapCores(p)} cores (mined ${fmt(p.run.ore)} this run)`);
    leap(s, 'p', now);
    leaps++;
  }
  if (now - lastReport >= 15 * 60_000) {
    lastReport = now;
    const lv = UPGRADE_IDS.filter((id) => p.levels[id]).map((id) => `${id} ${p.levels[id]}`).join(', ');
    log(`ore/s ${fmt(income(s, p))}  alloy ${fmt(p.wallet.alloy)}  cores ${p.wallet.cores}  [${lv}]`);
  }
}
console.log('tree:', NODE_IDS.filter((id) => has(s, id)).join(', '));
