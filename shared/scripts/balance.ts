/**
 * Headless pacing check (`npm run balance`). Simulates a crew of CREW bots
 * (default 1) in one world. Each bot taps TAPS times a second (half of them
 * on glowing seams, keeping its streak alive), catches CATCH of the comets,
 * buys the personal upgrade that pays itself back fastest in each currency,
 * and saves up with the crew for a Forge Tree node once no upgrade pays for
 * itself within PAYBACK seconds and the node takes less than SAVE_FOR
 * seconds of the crew's income (or less than the best upgrade's payback). Crews take different roles
 * (Prospector, Engineer, Refiner, Engineer); a solo bot picks whichever role
 * pays it most. Prints when each node unlocks, when leaps and contracts
 * happen, and how often there was something to buy, to compare against
 * DESIGN.md §12.3.
 *
 *   CREW=1 TAPS=3 HOURS=24 LEAPS=60 SAVE_FOR=360 CATCH=0.7 QUIET=0
 */
import {
  CHAIN_CAP,
  COMBO_CAP,
  NODES,
  NODE_IDS,
  ROLE_IDS,
  SEAM_HP,
  UPGRADES,
  UPGRADE_IDS,
  addPlayer,
  applyStrike,
  breakMult,
  buyUpgrade,
  canLeap,
  catchComet,
  chainMult,
  comboMult,
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
  refineShare,
  rng,
  roleOf,
  seamMult,
  setPrefs,
  tapValue,
  tickRoom,
  upgradeCost,
  upgradeUnlocked,
  type NodeId,
  type PlayerState,
  type ResourceId,
  type RoleId,
  type RoomState,
  type UpgradeId,
} from '../src/index.js';

const CREW = Math.max(1, Math.min(4, Number(process.env.CREW ?? 1)));
const TAPS = Number(process.env.TAPS ?? 3);
const SEAM_SHARE = 0.5;
const SAVE_FOR = Number(process.env.SAVE_FOR ?? 360);
const HOURS = Number(process.env.HOURS ?? 6);
const LEAPS = Number(process.env.LEAPS ?? 3);
const CATCH = Number(process.env.CATCH ?? 0.7);
const QUIET = process.env.QUIET === '1';
/** Buy an upgrade instead of saving while one pays for itself within this many seconds. */
const PAYBACK = Number(process.env.PAYBACK ?? 60);
/** Minutes between status lines. */
const REPORT = Number(process.env.REPORT ?? 30);
const CREW_ROLES: RoleId[] = ['prospector', 'engineer', 'refiner', 'engineer'];

const r = rng(42);
let now = 0;
const s = createRoomState(7, now);
const bots: PlayerState[] = [];
for (let i = 0; i < CREW; i++) bots.push(addPlayer(s, 'p' + i, 'bot' + i, 'Bot' + i, now).player);
const lead = bots[0];

const log = (t: string) => console.log(`${clock(now)}  ${t}`);
function clock(ms: number): string {
  const m = Math.floor(ms / 60000);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`;
}

/** Expected ore per second this player makes while tapping, taps included, net of the Refinery. */
function income(st: RoomState, pl: PlayerState): number {
  const cc = Math.min(1, critChance(pl));
  const chain = chainMult(pl, Math.min(CHAIN_CAP, cc / Math.max(0.01, 1 - cc)));
  const hitsPerSeam = SEAM_HP / (1 + cc + (roleOf(st, pl) === 'prospector' ? 1 : 0));
  const seam = seamMult(st, pl) * (1 + (breakMult(st) - 1) / hitsPerSeam);
  const tap = tapValue(st, pl) * comboMult(pl, COMBO_CAP) * (1 + cc * (critMult(st) * chain - 1)) * (1 - SEAM_SHARE + SEAM_SHARE * seam);
  return TAPS * tap + passiveOrePerSec(st, pl) * (1 - refineShare(pl));
}
const crewIncome = () => bots.reduce((a, b) => a + income(s, b), 0);
const crewAlloy = () => bots.reduce((a, b) => a + b.rates.alloy, 0);

/** Income gained per unit spent, by trying the purchase on a copy. */
function valueOf(p: PlayerState, id: UpgradeId): number {
  const def = UPGRADES[id];
  if (def.maxLevel !== undefined && p.levels[id] >= def.maxLevel) return 0;
  if (!upgradeUnlocked(s, id)) return 0;
  // The bot plays by hand: no Foreman, no Beacon (it never leaves).
  if (id === 'foreman' || id === 'beacon') return 0;
  const cost = upgradeCost(id, p.levels[id]);
  // Alloy only matters once alloy prices show up; Refineries are for Refiners.
  if (id === 'smelter') return (income(s, p) * 0.004) / cost;
  if (id === 'refinery') return roleOf(s, p) === 'refiner' ? (income(s, p) * 0.003) / cost : 0;
  const base = income(s, p);
  p.levels[id]++;
  const after = income(s, p);
  p.levels[id]--;
  return (after - base) / cost;
}

/** Seconds the bot's best ore upgrade takes to pay for itself. */
function bestPayback(p: PlayerState): number {
  let best = Infinity;
  for (const id of UPGRADE_IDS) {
    if (UPGRADES[id].currency !== 'ore') continue;
    const v = valueOf(p, id);
    if (v > 0) best = Math.min(best, 1 / v);
  }
  return best;
}

/** The node the crew is saving for, if any. */
function target(): NodeId | null {
  // Quick wins first: nobody saves while a cheap upgrade pays back in a minute.
  const payback = Math.min(...bots.map(bestPayback));
  if (payback < PAYBACK) return null;
  const inc = crewIncome();
  const alloyInc = Math.max(1e-9, crewAlloy());
  const cores = bots.reduce((a, b) => a + b.wallet.cores, 0);
  const alloy = bots.reduce((a, b) => a + b.wallet.alloy, 0);
  let best: NodeId | null = null;
  let bestT = Infinity;
  for (const id of NODE_IDS) {
    if (!nodeFundable(s, id) || id === 'mastery') continue;
    const rem = nodeRemaining(s, id);
    if ((rem.cores ?? 0) > cores) continue;
    const t = Math.max((rem.ore ?? 0) / inc, Math.max(0, (rem.alloy ?? 0) - alloy) / alloyInc) + (rem.cores ?? 0) * 1e6;
    // Worth saving for if it comes within SAVE_FOR, or sooner than upgrades would pay back.
    if (id !== 'leap' && !rem.cores && t > SAVE_FOR && t > payback) continue;
    if (t < bestT) {
      best = id;
      bestT = t;
    }
  }
  return best;
}

let leaps = 0;
const end = HOURS * 3600_000;
let lastReport = 0;
let tapAcc = 0;
const unlockedAt: [string, number][] = [];
const buys: number[] = [];
let contracts = 0;
let failed = 0;
let catchAt = 0;

while (now < end && leaps < LEAPS) {
  now += 1000;
  for (const note of tickRoom(s, 1, now, r)) {
    if (note.k === 'comet') catchAt = r() < CATCH ? now + 3000 : 0;
    if (note.k === 'contractDone') {
      contracts++;
      if (!QUIET) log(`contract ${note.kind} done, renown ${note.renown}, paid ${fmt(note.rewards[lead.id] ?? 0)} each`);
    }
    if (note.k === 'contractFailed') failed++;
  }
  if (s.comet && catchAt && now >= catchAt) {
    catchComet(s, bots[Math.floor(r() * CREW)].id, s.comet.id, now);
    catchAt = 0;
  }

  // Taps, spread across the second so the streak holds.
  tapAcc += TAPS;
  const n = Math.floor(tapAcc);
  tapAcc -= n;
  for (const p of bots) {
    for (let i = 0; i < n; i++) {
      const seam = r() < SEAM_SHARE ? s.seams[0]?.id ?? null : null;
      applyStrike(s, p.id, seam, now - 1000 + ((i + 1) * 1000) / n, r());
    }
  }

  // Roles, once the Crew Charter is in.
  if (has(s, 'charter')) {
    bots.forEach((p, i) => {
      if (p.role) return;
      let role = CREW_ROLES[i];
      if (CREW === 1) {
        let bestInc = -1;
        for (const id of ROLE_IDS) {
          p.role = id;
          const v = income(s, p);
          if (v > bestInc) {
            bestInc = v;
            role = id;
          }
        }
        p.role = null;
      }
      setPrefs(s, p.id, { role }, now);
      if (!QUIET && i === 0) log(`roles: ${bots.map((b) => b.role ?? CREW_ROLES[bots.indexOf(b)]).join(', ')}`);
    });
  }

  const goal = target();
  if (goal) {
    for (const p of bots) {
      for (const res of ['cores', 'alloy', 'ore'] as ResourceId[]) {
        if (!(p.wallet[res] > 0) || !nodeFundable(s, goal)) continue;
        const out = fundNode(s, p.id, goal, res, res === 'cores' ? Math.floor(p.wallet.cores) : 1e300);
        if (typeof out !== 'string' && out.done) {
          const name = NODES[goal].repeat ? `${NODES[goal].name} ${out.level}` : NODES[goal].name;
          unlockedAt.push([name, now]);
          buys.push(now);
          log(`unlocked ${name.padEnd(18)} crew ore/s ${fmt(crewIncome())}`);
        }
      }
    }
  }
  // Spend what's left (all of it when not saving, only small change when saving).
  for (const p of bots) {
    for (let i = 0; i < 200; i++) {
      let best: UpgradeId | null = null;
      let bv = 0;
      for (const id of UPGRADE_IDS) {
        const def = UPGRADES[id];
        const cost = upgradeCost(id, p.levels[id]);
        if (p.wallet[def.currency] < cost) continue;
        if (goal && nodeFundable(s, goal)) {
          const rem = nodeRemaining(s, goal)[def.currency] ?? 0;
          if (rem > 0 && cost > rem * 0.02) continue;
        }
        const v = valueOf(p, id) * (def.currency === 'alloy' ? 1e6 : 1);
        if (v > bv) {
          bv = v;
          best = id;
        }
      }
      if (!best) break;
      buyUpgrade(s, p.id, best, 1);
      if (p === lead) buys.push(now);
    }
  }
  for (const p of bots) {
    if (canLeap(s, p) && leapCores(p, s) >= Math.max(3, Math.ceil(0.4 * p.stats.cores))) {
      if (p === lead || !QUIET) log(`${p.name} LEAP ${p.stats.leaps + 1}: +${leapCores(p, s)} cores (mined ${fmt(p.run.ore)} this run)`);
      leap(s, p.id, now);
      if (p === lead) leaps++;
    }
  }
  if (!QUIET && now - lastReport >= REPORT * 60_000) {
    lastReport = now;
    const lv = UPGRADE_IDS.filter((id) => lead.levels[id]).map((id) => `${id} ${lead.levels[id]}`).join(', ');
    log(`ore/s ${fmt(income(s, lead))}  alloy ${fmt(lead.wallet.alloy)}  cores ${lead.wallet.cores}  renown ${s.renown}  [${lv}]`);
  }
}

/** Longest stretch without a purchase in the first `h` hours. */
function maxGap(h: number): number {
  let prev = 0;
  let gap = 0;
  for (const t of [...buys].sort((a, b) => a - b)) {
    if (t > h * 3600_000) break;
    gap = Math.max(gap, t - prev);
    prev = t;
  }
  return Math.round(Math.max(gap, Math.min(h * 3600_000, now) - prev) / 1000);
}
console.log(`crew ${CREW}, ${TAPS} taps/s: ${unlockedAt.length} unlocks, ${contracts} contracts (${failed} missed), renown ${s.renown}`);
console.log(`bot 0 made ${buys.filter((t) => t <= 3600_000).length} purchases (levels and nodes) in hour 1; longest wait between purchases: ${maxGap(1)}s in hour 1, ${maxGap(3)}s in the first 3 h`);
console.log('tree:', NODE_IDS.filter((id) => has(s, id)).join(', '));
