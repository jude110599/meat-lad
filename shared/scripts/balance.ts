/**
 * Headless pacing check (`npm run balance`): one solo player who strikes
 * seams 4 times a second while keeping the drill out of overheat, presses
 * the smelter twice a second, and buys upgrades greedily. Prints when each
 * resource tier first appears and when the first Quantum Leap unlocks, to
 * compare against DESIGN.md §11.4.
 */
import {
  LEAP_THRESHOLD,
  MACHINES,
  MACHINE_DEFS,
  RESOURCES,
  UPGRADES,
  UPGRADE_IDS,
  addPlayer,
  applyPress,
  applyStrike,
  buyUpgrade,
  canLeap,
  createRoomState,
  rng,
  tickRoom,
  upgradeCost,
  type UpgradeId,
} from '../src/index.js';

const r = rng(42);
const s = createRoomState(7, 0);
addPlayer(s, 'p', 'Bot', 'miner');
const first: Record<string, number> = {};
const order: UpgradeId[] = ['drone', 'drillBit', 'smelter', 'rig', 'infuser', 'coolant', 'compressor', 'condenser', 'seismic', 'focusLens', 'press', 'reactor'];
const fmt = (ms?: number) => (ms === undefined ? 'never' : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);
const HOURS = Number(process.argv[2] ?? 3);
let now = 0;
const step = 250;
for (let ms = 0; ms < HOURS * 3600_000; ms += step) {
  now = ms;
  const p = s.players.p;
  // 4 strikes/s, aimed at a seam, backing off near overheat.
  if (ms % 250 === 0 && p.heat < 88 && now >= p.lockedUntil) applyStrike(s, 'p', { seamId: s.seams[0]?.id ?? null }, now, r());
  // 2 presses/s on the highest machine that has input.
  if (ms % 500 === 0) {
    const m = [...MACHINES].reverse().find((id) => s.levels[id] > 0 && s.wallet[MACHINE_DEFS[id].input] >= MACHINE_DEFS[id].ratio * 4);
    if (m) applyPress(s, 'p', m, now);
  }
  tickRoom(s, step / 1000, now, r);
  if (s.event) s.event = null;
  if (ms % 1000 === 0) {
    for (const id of order) {
      const def = UPGRADES[id];
      if (def.maxLevel !== undefined && s.levels[id] >= def.maxLevel) continue;
      // Keep half the ore for the refinery once it exists.
      const budget = def.currency === 'ore' && s.levels.smelter > 3 ? 0.5 : 1;
      if (upgradeCost(id, s.levels[id]) <= s.wallet[def.currency] * budget && buyUpgrade(s, id) && s.levels[id] === 1) first['buy:' + id] = ms;
    }
  }
  for (const k of RESOURCES) if (!first[k] && s.wallet[k] >= 1) first[k] = ms;
  if (!first.leap && canLeap(s)) first.leap = ms;
  if (ms % 600000 === 0 && process.argv[3]) console.log(fmt(ms), Object.fromEntries(RESOURCES.map((k) => [k, Math.round(s.wallet[k])])), `drone ${s.levels.drone} bit ${s.levels.drillBit} sm ${s.levels.smelter} inf ${s.levels.infuser} cmp ${s.levels.compressor} cnd ${s.levels.condenser} rig ${s.levels.rig} seis ${s.levels.seismic}`);
}
for (const k of Object.keys(first).sort((a, b) => first[a] - first[b])) console.log(k.padEnd(16), fmt(first[k]));
console.log('levels', JSON.stringify(s.levels));
console.log('wallet', Object.fromEntries(RESOURCES.map((k) => [k, Math.round(s.wallet[k])])), 'run CE', s.run.cosmicEnergy.toFixed(2), `(leap at ${LEAP_THRESHOLD})`);
void UPGRADE_IDS;
