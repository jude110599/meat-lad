import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASTEROID_RADIUS,
  BREAK_MULT,
  COMET_MS,
  LEAP_MIN_ORE,
  MAX_PLAYERS_PER_ROOM,
  MEMORY_LEVELS,
  MIN_STRIKE_INTERVAL_MS,
  NODES,
  NODE_IDS,
  OFFLINE_CAP_S,
  PROTOCOL_VERSION,
  RoomHost,
  SEAM_HP,
  UPGRADES,
  UPGRADE_IDS,
  addPlayer,
  affordable,
  applyStrike,
  bulkCost,
  buyUpgrade,
  catchComet,
  coresFor,
  oreForCores,
  createRoomState,
  crewMult,
  dropPlayer,
  fmt,
  fromSave,
  fundNode,
  has,
  leap,
  nodeCost,
  nodeRemaining,
  passiveOrePerSec,
  seamTarget,
  surfaceRadius,
  surgeOn,
  tapValue,
  tickRoom,
  toSave,
  upgradeCost,
  type ServerMsg,
} from './index.js';
import {
  BEACON_EFF,
  CHAIN_STEP,
  COMBO_CAP,
  COMBO_WINDOW_MS,
  COMET_GAP_MAX_MS,
  CONTRACT_FIRST_MS,
  CONTRACT_MS,
  OFFLINE_EFF,
  REFINER_FUND_BONUS,
  REFINE_RATIO,
  ROLE_AURA,
  ROLE_SWITCH_MS,
  autoBuy,
  breakMult,
  cometReward,
  contractGoal,
  droneRate,
  leapCores,
  milestoneMult,
  nextMilestone,
  offlineCapS,
  offlineEff,
  renownMult,
  setPrefs,
  uplinkMult,
  type TickNote,
} from './index.js';


const T0 = 1_000_000;
function room(n = 1) {
  const s = createRoomState(7, T0);
  for (let i = 0; i < n; i++) addPlayer(s, `p${i}`, `key${i}`, `P${i}`, T0);
  return s;
}
/** Unlock a node outright, for tests that need it. */
function grant(s: ReturnType<typeof room>, ...ids: (typeof NODE_IDS)[number][]) {
  for (const id of ids) s.tree[id] = { level: 1, funded: {}, by: {} };
}

describe('tapping', () => {
  it('pays the player who tapped, nobody else', () => {
    const s = room(2);
    const out = applyStrike(s, 'p0', null, T0, 0.99);
    assert.equal(typeof out, 'object');
    // One ore, plus the +5% a crewmate online brings.
    assert.equal(s.players.p0.wallet.ore, crewMult(s));
    assert.equal(s.players.p1.wallet.ore, 0);
    assert.equal(s.players.p0.stats.taps, 1);
  });

  it('rate-limits taps', () => {
    const s = room();
    applyStrike(s, 'p0', null, T0, 0.99);
    assert.equal(applyStrike(s, 'p0', null, T0 + MIN_STRIKE_INTERVAL_MS - 1, 0.99), 'rate-limited');
  });

  it('seams pay more and pay a break bonus on the last hit', () => {
    const s = room();
    const seam = s.seams[0];
    let t = T0;
    let last;
    for (let i = 0; i < SEAM_HP; i++) {
      t += 100;
      last = applyStrike(s, 'p0', seam.id, t, 0.99);
    }
    assert.ok(typeof last === 'object' && last.broke && last.newSeam);
    assert.equal(last.amount, 3 * BREAK_MULT);
    assert.equal(s.seams.length, seamTarget(s));
    assert.ok(!s.seams.some((x) => x.id === seam.id));
  });

  it('a crit pays ×5, ×10 with Fine Optics', () => {
    const s = room();
    const a = applyStrike(s, 'p0', null, T0, 0);
    grant(s, 'optics');
    const b = applyStrike(s, 'p0', null, T0 + 100, 0);
    assert.ok(typeof a === 'object' && typeof b === 'object');
    assert.equal(a.amount, 5);
    assert.equal(b.amount, 10);
  });
});

describe('personal upgrades', () => {
  it('spend your own wallet', () => {
    const s = room(2);
    s.players.p0.wallet.ore = 100;
    assert.equal(buyUpgrade(s, 'p0', 'drill', 1), 1);
    assert.equal(s.players.p0.levels.drill, 1);
    assert.equal(s.players.p0.wallet.ore, 100 - upgradeCost('drill', 0));
    assert.equal(s.players.p1.levels.drill, 0);
    assert.equal(tapValue(s, s.players.p0), 2 * crewMult(s));
  });

  it('buy many at once, as far as the wallet goes', () => {
    const s = room();
    s.players.p0.wallet.ore = bulkCost('drone', 0, 10) + 1;
    assert.equal(buyUpgrade(s, 'p0', 'drone', 100), 10);
    assert.equal(affordable('drone', 0, bulkCost('drone', 0, 10)), 10);
  });

  it('stay locked until the tree unlocks them', () => {
    const s = room();
    s.players.p0.wallet.ore = 1e9;
    assert.equal(buyUpgrade(s, 'p0', 'rig', 1), 'locked');
    grant(s, 'autorig');
    assert.equal(buyUpgrade(s, 'p0', 'rig', 1), 1);
  });

  it('respect max levels', () => {
    const s = room();
    s.players.p0.wallet.ore = 1e30;
    assert.equal(buyUpgrade(s, 'p0', 'lens', 1000), UPGRADES.lens.maxLevel);
    assert.equal(buyUpgrade(s, 'p0', 'lens', 1), 'maxed');
  });

  it('every upgrade has a sane cost curve', () => {
    for (const id of UPGRADE_IDS) {
      assert.ok(upgradeCost(id, 1) > upgradeCost(id, 0), id);
      assert.equal(bulkCost(id, 0, 1), upgradeCost(id, 0), id);
    }
  });
});

describe('the Forge Tree', () => {
  it('is funded by several players and unlocks for everyone', () => {
    const s = room(2);
    const cost = NODES.core.cost.ore!;
    s.players.p0.wallet.ore = cost * 0.7;
    s.players.p1.wallet.ore = cost;
    const a = fundNode(s, 'p0', 'core', 'ore', 1e12);
    assert.ok(typeof a === 'object' && !a.done);
    assert.equal(s.players.p0.wallet.ore, 0);
    assert.equal(nodeRemaining(s, 'core').ore, cost * 0.3);
    const b = fundNode(s, 'p1', 'core', 'ore', 1e12);
    assert.ok(typeof b === 'object' && b.done);
    // Only what was owed was taken.
    assert.equal(s.players.p1.wallet.ore, cost * 0.7);
    assert.ok(has(s, 'core'));
    assert.ok(Math.abs(s.tree.core!.by.p0 - 0.7) < 1e-9);
    assert.ok(Math.abs(s.tree.core!.by.p1 - 0.3) < 1e-9);
    assert.equal(tapValue(s, s.players.p1), 1.5 * crewMult(s));
  });

  it('needs every prerequisite', () => {
    const s = room();
    s.players.p0.wallet.ore = 1e12;
    assert.equal(fundNode(s, 'p0', 'swarm', 'ore', 1), 'locked');
    grant(s, 'core');
    assert.equal(typeof fundNode(s, 'p0', 'swarm', 'ore', 1), 'object');
    assert.equal(fundNode(s, 'p0', 'harvesters', 'ore', 1), 'locked');
  });

  it('refuses resources a node does not take, finished nodes and junk', () => {
    const s = room();
    s.players.p0.wallet = { ore: 1e12, alloy: 1e12, cores: 100 };
    assert.equal(fundNode(s, 'p0', 'core', 'alloy', 5), 'locked');
    assert.equal(fundNode(s, 'p0', 'core', 'ore', -5), 'too-poor');
    assert.equal(fundNode(s, 'p0', 'core', 'ore', Number.NaN), 'too-poor');
    assert.equal(fundNode(s, 'p0', 'nope' as never, 'ore', 5), 'locked');
    grant(s, 'core');
    assert.equal(fundNode(s, 'p0', 'core', 'ore', 5), 'maxed');
  });

  it('needs every resource of a mixed price', () => {
    const s = room();
    grant(s, 'core', 'autorig', 'smelting');
    s.players.p0.wallet = { ore: 1e12, alloy: 0, cores: 0 };
    const out = fundNode(s, 'p0', 'hotsmelt', 'ore', 1e12);
    assert.ok(typeof out === 'object' && !out.done);
    assert.equal(nodeRemaining(s, 'hotsmelt').ore, 0);
    s.players.p0.wallet.alloy = 1e12;
    const done = fundNode(s, 'p0', 'hotsmelt', 'alloy', 1e12);
    assert.ok(typeof done === 'object' && done.done);
  });

  it('repeatable nodes level up and get pricier', () => {
    const s = room();
    for (const id of NODES.mastery.needs) grant(s, id);
    s.players.p0.wallet = { ore: 1e20, alloy: 0, cores: 1e6 };
    for (const r of ['ore', 'cores'] as const) fundNode(s, 'p0', 'mastery', r, 1e20);
    assert.equal(s.tree.mastery!.level, 1);
    assert.equal(nodeCost('mastery', 1).ore, NODES.mastery.cost.ore! * 10);
    assert.equal(nodeRemaining(s, 'mastery').ore, nodeCost('mastery', 1).ore);
  });

  it('every node is reachable from the root', () => {
    for (const id of NODE_IDS) for (const n of NODES[id].needs) assert.ok(NODES[n].tier < NODES[id].tier, `${id} needs ${n}`);
  });

  it('crews earn more together, and Crew Link and Hive Mind add to it', () => {
    const s = room();
    assert.equal(crewMult(s, 1), 1);
    assert.equal(crewMult(s, 4), 1.15);
    grant(s, 'teamlink');
    assert.equal(crewMult(s, 1), 1.2);
    assert.ok(Math.abs(crewMult(s, 2) - 1.4) < 1e-9);
    assert.ok(Math.abs(crewMult(s, 4) - 1.8) < 1e-9);
    grant(s, 'hivemind');
    assert.ok(Math.abs(crewMult(s, 4) - 2.25) < 1e-9);
  });

  it('Deep Scan adds seams, Resonance surges the crew when a seam breaks', () => {
    const s = room();
    grant(s, 'core', 'optics', 'deepscan');
    s.players.p0.wallet.ore = 1e12;
    // Funding the node is what refills, so do it for real on a fresh room.
    const t = room();
    grant(t, 'core', 'optics');
    t.players.p0.wallet.ore = 1e12;
    fundNode(t, 'p0', 'deepscan', 'ore', 1e12);
    assert.equal(t.seams.length, 7);
    grant(s, 'resonance');
    const seam = s.seams[0];
    seam.hp = 1;
    const out = applyStrike(s, 'p0', seam.id, T0, 0.99);
    assert.ok(typeof out === 'object' && out.broke && out.surge);
    assert.ok(surgeOn(s, T0 + 1000));
  });
});

describe('Quantum Leap', () => {
  it('pays cores on a cube-root curve, and oreForCores is its inverse', () => {
    assert.equal(coresFor(LEAP_MIN_ORE - 1), 0);
    assert.equal(coresFor(LEAP_MIN_ORE), 3);
    for (let n = 4; n < 2000; n += 7) {
      assert.equal(coresFor(oreForCores(n)), n);
      assert.equal(coresFor(oreForCores(n) * 0.999), n - 1);
    }
  });
  it('needs the node and a big enough run', () => {
    const s = room();
    s.players.p0.run.ore = LEAP_MIN_ORE * 4;
    assert.equal(leap(s, 'p0', T0), 'locked');
    grant(s, 'leap');
    s.players.p0.run.ore = LEAP_MIN_ORE / 2;
    assert.equal(leap(s, 'p0', T0), 'not-ready');
  });

  it('resets only your run, keeps the tree, pays cores', () => {
    const s = room(2);
    grant(s, 'core', 'leap', 'memory');
    const p = s.players.p0;
    p.run.ore = LEAP_MIN_ORE * 4;
    p.wallet = { ore: 5e9, alloy: 1e6, cores: 1 };
    p.levels.drill = 80;
    s.players.p1.wallet.ore = 123;
    const out = leap(s, 'p0', T0);
    assert.ok(typeof out === 'object');
    assert.equal(out.cores, coresFor(LEAP_MIN_ORE * 4));
    assert.equal(p.wallet.cores, 1 + out.cores);
    assert.equal(p.wallet.ore, 0);
    assert.equal(p.levels.drill, MEMORY_LEVELS);
    assert.equal(p.levels.drone, MEMORY_LEVELS);
    assert.equal(s.players.p1.wallet.ore, 123);
    assert.ok(has(s, 'core'));
    // Cores boost everything you earn.
    assert.ok(tapValue(s, p) > tapValue(s, s.players.p1) * 3);
  });
});

describe('crewmates coming and going', () => {
  it('a returning key gets its progress back plus offline earnings', () => {
    const s = room();
    const p = s.players.p0;
    p.levels.drone = 20;
    dropPlayer(s, 'p0', T0);
    const rate = passiveOrePerSec(s, p, 1, false);
    const back = addPlayer(s, 'other-id', 'key0', 'P0', T0 + 3600_000);
    assert.equal(back.player, p);
    assert.ok(back.offline);
    assert.ok(Math.abs(back.offline.gained.ore - rate * 3600 * 0.25) < 1e-6);
    assert.ok(p.online);
  });

  it('offline earnings are capped', () => {
    const s = room();
    s.players.p0.levels.drone = 5;
    dropPlayer(s, 'p0', T0);
    const back = addPlayer(s, 'x', 'key0', 'P0', T0 + 1000 * 3600_000);
    assert.equal(back.offline!.seconds, OFFLINE_CAP_S);
  });

  it('only online players earn passive income', () => {
    const s = room(2);
    s.players.p0.levels.drone = 10;
    s.players.p1.levels.drone = 10;
    dropPlayer(s, 'p1', T0);
    tickRoom(s, 1, T0 + 1000, () => 0.5);
    assert.ok(s.players.p0.wallet.ore > 0);
    assert.equal(s.players.p1.wallet.ore, 0);
  });
});

describe('comets', () => {
  it('pay every online crewmate, double for the catcher, once', () => {
    const s = room(2);
    s.nextCometAt = T0;
    tickRoom(s, 0.05, T0 + 10, () => 0.5);
    const c = s.comet!;
    assert.ok(c && c.until - c.at === COMET_MS);
    const out = catchComet(s, 'p1', c.id, T0 + 1000);
    assert.ok(typeof out === 'object');
    assert.equal(out.rewards.p1, out.rewards.p0 * 2);
    assert.equal(s.players.p0.wallet.ore, out.rewards.p0);
    assert.equal(catchComet(s, 'p0', c.id, T0 + 1100), 'gone');
  });
});

describe('saves', () => {
  it('round-trip the tree and every crewmate', () => {
    const s = room(2);
    grant(s, 'core');
    s.players.p1.wallet.ore = 42;
    s.players.p1.levels.drill = 7;
    const back = fromSave(JSON.parse(JSON.stringify(toSave(s, T0))), T0 + 5000)!;
    assert.ok(back);
    assert.ok(has(back, 'core'));
    assert.equal(back.players.p1.wallet.ore, 42);
    assert.equal(back.players.p1.levels.drill, 7);
    assert.equal(back.players.p1.online, false);
    assert.equal(back.comet, null);
  });

  it('reject other versions and junk', () => {
    assert.equal(fromSave({ v: 2, room: { seed: 1 } }), null);
    assert.equal(fromSave(null), null);
    assert.equal(fromSave({ v: 3 }), null);
  });
});

describe('RoomHost', () => {
  function host() {
    const sent: ServerMsg[] = [];
    const h = new RoomHost(createRoomState(3, T0), (_to, m) => sent.push(m), 'ABCDE', () => 0.99);
    return { h, sent };
  }
  const hello = (key: string) => ({ t: 'hello' as const, protocol: PROTOCOL_VERSION, name: key, key });

  it('admits up to the cap and gives a returning key the same player', () => {
    const { h } = host();
    const ids: string[] = [];
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) {
      const r = h.join(hello('k' + i), T0);
      assert.ok('playerId' in r);
      ids.push(r.playerId);
    }
    assert.deepEqual(h.join(hello('k9'), T0), { error: 'room-full' });
    h.leave(ids[0], T0);
    const again = h.join(hello('k0'), T0 + 10);
    assert.ok('playerId' in again && again.playerId === ids[0]);
    assert.deepEqual(h.join({ ...hello('z'), protocol: 1 }, T0), { error: 'protocol-mismatch' });
  });

  it('a second tab of the same browser is a second crewmate; the same tab reconnecting is not', () => {
    const { h } = host();
    const a = h.join({ ...hello('k'), tab: 't1' }, T0);
    const b = h.join({ ...hello('k'), tab: 't2' }, T0);
    assert.ok('playerId' in a && 'playerId' in b);
    assert.notEqual(a.playerId, b.playerId);
    const again = h.join({ ...hello('k'), tab: 't1' }, T0 + 5);
    assert.ok('playerId' in again && again.playerId === a.playerId);
  });

  it("never sends anyone's browser key to the crew", () => {
    const { h, sent } = host();
    const r = h.join({ ...hello('secret-key'), name: 'Ann' }, T0);
    assert.ok('playerId' in r);
    h.tick(T0 + 1000);
    const states = [r.welcome, ...sent].flatMap((m) => (m.t === 'welcome' || m.t === 'snap' ? [m.state] : []));
    assert.ok(states.length >= 2);
    assert.ok(!JSON.stringify(states).includes('secret-key'));
    assert.equal(h.state.players[r.playerId].key, 'secret-key');
  });

  it('turns intents into state and effects', () => {
    const { h, sent } = host();
    const r = h.join(hello('a'), T0);
    assert.ok('playerId' in r);
    h.handle(r.playerId, { t: 'strike', seq: 1, seamId: null }, T0 + 100);
    const fx = sent.filter((m): m is Extract<ServerMsg, { t: 'fx' }> => m.t === 'fx').flatMap((m) => m.fx);
    assert.ok(fx.some((f) => f.k === 'strike' && f.amount === 1));
    h.handle(r.playerId, { t: 'fund', node: 'core', res: 'ore', amount: 1 }, T0 + 200);
    assert.equal(h.state.tree.core?.funded.ore, 1);
  });

  it('takes role and switch changes, and refuses junk', () => {
    const { h, sent } = host();
    const r = h.join(hello('a'), T0);
    assert.ok('playerId' in r);
    h.handle(r.playerId, { t: 'prefs', prefs: { role: 'engineer' } }, T0 + 1);
    assert.equal(h.state.players[r.playerId].role, null, 'roles need Crew Charter');
    h.state.tree.charter = { level: 1, funded: {}, by: {} };
    h.handle(r.playerId, { t: 'prefs', prefs: { role: 'engineer', auto: false } }, T0 + 2);
    assert.equal(h.state.players[r.playerId].role, 'engineer');
    assert.equal(h.state.players[r.playerId].auto, false);
    h.handle(r.playerId, { t: 'prefs', prefs: null as never }, T0 + 3);
    const fx = sent.filter((m): m is Extract<ServerMsg, { t: 'fx' }> => m.t === 'fx').flatMap((m) => m.fx);
    assert.ok(fx.some((f) => f.k === 'reject' && f.reason === 'locked'));
  });
});

describe('producers', () => {
  it('double at levels 10, 25, 50 and 100, then every 50', () => {
    const at = [0, 9, 10, 24, 25, 49, 50, 99, 100, 149, 150, 200];
    assert.deepEqual(at.map(milestoneMult), [1, 1, 2, 2, 4, 4, 8, 8, 16, 16, 32, 64]);
    assert.deepEqual([0, 10, 25, 99, 100, 160].map(nextMilestone), [10, 25, 50, 100, 150, 200]);
  });

  it('an early drone pays for itself within ten seconds, and Swarm Logic and Overdrive multiply drones', () => {
    const s = room();
    const p = s.players.p0;
    p.levels.drone = 1;
    assert.ok(upgradeCost('drone', 0) / droneRate(s, p) <= 10);
    p.levels.drone = 30;
    const base = droneRate(s, p);
    grant(s, 'swarm');
    assert.ok(Math.abs(droneRate(s, p) - base * 3) < 1e-9);
    grant(s, 'overclock');
    assert.ok(Math.abs(droneRate(s, p) - base * 9) < 1e-9);
  });
});

describe('streaks and chains', () => {
  it('a tap streak builds inside the window, and Combo Coil pays for it', () => {
    const s = room();
    s.players.p0.levels.combo = 10;
    let t = T0;
    let out: ReturnType<typeof applyStrike> = 'gone';
    for (let i = 0; i < COMBO_CAP; i++) out = applyStrike(s, 'p0', null, (t += 500), 0.99);
    assert.ok(typeof out === 'object');
    assert.equal(out.streak, COMBO_CAP);
    assert.ok(Math.abs(out.amount - 2) < 1e-9, 'a full streak at level 10 is ×2');
    const late = applyStrike(s, 'p0', null, t + COMBO_WINDOW_MS + 1, 0.99);
    assert.ok(typeof late === 'object' && late.streak === 1);
    assert.ok(Math.abs(late.amount - (1 + 1 / COMBO_CAP)) < 1e-9);
    assert.equal(s.players.p0.stats.bestStreak, COMBO_CAP);
  });

  it('crits in a row chain up with Chain Reactor, and a plain tap breaks the chain', () => {
    const s = room();
    s.players.p0.levels.chain = 10;
    const a = applyStrike(s, 'p0', null, T0, 0);
    const b = applyStrike(s, 'p0', null, T0 + 100, 0);
    const c = applyStrike(s, 'p0', null, T0 + 200, 0.99);
    assert.ok(typeof a === 'object' && typeof b === 'object' && typeof c === 'object');
    assert.equal(a.amount, 5);
    assert.equal(b.amount, 5 * (1 + CHAIN_STEP * 10));
    assert.equal(b.chain, 2);
    assert.equal(c.chain, 0);
  });
});

describe('more personal upgrades', () => {
  it('the Refinery turns a share of passive ore into alloy, and can be switched off', () => {
    const s = room();
    const p = s.players.p0;
    p.levels.drone = 10;
    p.levels.refinery = 4;
    const gross = droneRate(s, p);
    tickRoom(s, 1, T0 + 1000, () => 0.5);
    assert.ok(Math.abs(p.wallet.ore - gross * 0.8) < 1e-6);
    assert.ok(Math.abs(p.wallet.alloy - gross * 0.2 * REFINE_RATIO) < 1e-6);
    assert.ok(Math.abs(p.run.ore - gross) < 1e-6, 'refined ore still counts toward the leap');
    setPrefs(s, 'p0', { refine: false }, T0 + 1000);
    p.wallet = { ore: 0, alloy: 0, cores: 0 };
    tickRoom(s, 1, T0 + 2000, () => 0.5);
    assert.ok(Math.abs(p.wallet.ore - gross) < 1e-6);
    assert.equal(p.wallet.alloy, 0);
  });

  it('Night Beacons stretch time away and the offline rate', () => {
    const s = room();
    const p = s.players.p0;
    p.levels.beacon = 3;
    assert.equal(offlineCapS(s, p), OFFLINE_CAP_S + 3 * 3600);
    assert.ok(Math.abs(offlineEff(s, p) - (OFFLINE_EFF + 3 * BEACON_EFF)) < 1e-9);
    p.levels.drone = 5;
    dropPlayer(s, 'p0', T0);
    const back = addPlayer(s, 'x', 'key0', 'P0', T0 + 1000 * 3600_000);
    assert.equal(back.offline!.seconds, OFFLINE_CAP_S + 3 * 3600);
  });

  it('Crew Uplink pays more for every crewmate online', () => {
    const s = room();
    const p = s.players.p0;
    p.levels.uplink = 10;
    assert.equal(uplinkMult(s, p, 1), 1);
    assert.ok(Math.abs(uplinkMult(s, p, 4) - 1.9) < 1e-9);
  });

  it('the Foreman auto-buys the cheapest levels it may, only within its share of your wallet', () => {
    const s = room();
    const p = s.players.p0;
    p.wallet.ore = 10_000;
    p.levels.foreman = 1;
    assert.deepEqual(autoBuy(s, p), {}, 'locked until Foreman Protocol');
    grant(s, 'core', 'autorig', 'swarm', 'foreman');
    const before = p.wallet.ore;
    const bought = autoBuy(s, p);
    assert.ok((bought.drill ?? 0) > 0 && (bought.drone ?? 0) > 0);
    assert.equal(p.levels.lens, 0, 'level 1 only buys producers');
    // A tick buys a few dozen at most; run it out.
    while (Object.keys(autoBuy(s, p)).length);
    assert.ok(p.wallet.ore > before * 0.3);
    // Nothing left that costs under 10% of the wallet.
    assert.ok(upgradeCost('drill', p.levels.drill) > p.wallet.ore * 0.1);
    assert.ok(upgradeCost('drone', p.levels.drone) > p.wallet.ore * 0.1);
    p.auto = false;
    p.wallet.ore = 1e9;
    assert.deepEqual(autoBuy(s, p), {});
    p.auto = true;
    tickRoom(s, 0.05, T0 + 50, () => 0.5);
    assert.ok(p.wallet.ore < 1e9, 'it runs in the tick');
  });
});

describe('crew roles', () => {
  it('need Crew Charter, double your part of the game and boost crewmates', () => {
    const s = room(2);
    const [a, b] = [s.players.p0, s.players.p1];
    assert.equal(setPrefs(s, 'p0', { role: 'engineer' }, T0), 'locked');
    grant(s, 'charter');
    a.levels.drone = b.levels.drone = 10;
    const [ra, rb] = [droneRate(s, a), droneRate(s, b)];
    assert.deepEqual(setPrefs(s, 'p0', { role: 'engineer' }, T0), { role: 'engineer' });
    assert.ok(Math.abs(droneRate(s, a) - ra * 2) < 1e-9);
    assert.ok(Math.abs(droneRate(s, b) - rb * (1 + ROLE_AURA)) < 1e-9);
    // Offline counts as alone: no crewmate boost.
    assert.ok(Math.abs(droneRate(s, b, 1) - droneRate(s, { ...b, role: null }, 1)) < 1e-9);
    assert.equal(setPrefs(s, 'p0', { role: 'prospector' }, T0 + 1000), 'cooldown');
    assert.equal(setPrefs(s, 'p0', { role: 'pirate' as never }, T0 + ROLE_SWITCH_MS), 'locked');
    assert.deepEqual(setPrefs(s, 'p0', { role: 'prospector' }, T0 + ROLE_SWITCH_MS), { role: 'prospector' });
  });

  it('Prospectors chip seams faster; Refiners fund the tree for less', () => {
    const s = room(2);
    grant(s, 'core', 'charter');
    setPrefs(s, 'p0', { role: 'prospector' }, T0);
    setPrefs(s, 'p1', { role: 'refiner' }, T0);
    const seam = s.seams[0];
    applyStrike(s, 'p0', seam.id, T0, 0.99);
    assert.equal(seam.hp, SEAM_HP - 2);
    const p = s.players.p1;
    p.wallet.ore = 1000;
    const out = fundNode(s, 'p1', 'autorig', 'ore', 100);
    assert.ok(typeof out === 'object');
    assert.equal(out.amount, 100 * REFINER_FUND_BONUS);
    assert.equal(p.wallet.ore, 900);
    // Finishing only takes what the rest is worth after the bonus.
    p.wallet.ore = 1e12;
    const owed = nodeRemaining(s, 'autorig').ore!;
    const done = fundNode(s, 'p1', 'autorig', 'ore', 1e12);
    assert.ok(typeof done === 'object' && done.done);
    assert.ok(Math.abs(1e12 - p.wallet.ore - owed / REFINER_FUND_BONUS) < 1e-3);
  });
});

describe('crew contracts', () => {
  /** Tick until a contract is running (it starts CONTRACT_FIRST_MS after the Forge Core). */
  function withContract(s: ReturnType<typeof room>, roll: number) {
    assert.deepEqual(tickRoom(s, 0.05, T0 + 10, () => roll), []);
    const notes: TickNote[] = tickRoom(s, 0.05, T0 + 10 + CONTRACT_FIRST_MS, () => roll);
    const started = notes.find((n) => n.k === 'contract');
    assert.ok(started && started.k === 'contract' && s.contract === started.contract);
    return started.contract;
  }

  it('need the Forge Core', () => {
    const s = room();
    tickRoom(s, 0.05, T0 + 10, () => 0);
    tickRoom(s, 0.05, T0 + 10 * CONTRACT_FIRST_MS, () => 0);
    assert.equal(s.contract, null);
  });

  it('pay everyone online when the crew finishes one, and add renown', () => {
    const s = room(2);
    grant(s, 'core');
    const c = withContract(s, 0);
    assert.equal(c.kind, 'seams');
    assert.equal(c.goal, contractGoal('seams', 0, 2, 1));
    let t = T0 + 20 + CONTRACT_FIRST_MS;
    for (let i = 0; i < c.goal; i++) {
      s.seams[0].hp = 1;
      applyStrike(s, 'p0', s.seams[0].id, (t += 100), 0.99);
    }
    assert.equal(c.progress, c.goal);
    assert.equal(c.by.p0, c.goal);
    const p1Before = s.players.p1.wallet.ore;
    const notes = tickRoom(s, 0.05, (t += 50), () => 0.5);
    const done = notes.find((n) => n.k === 'contractDone');
    assert.ok(done && done.k === 'contractDone');
    assert.ok(done.rewards.p1 > 0 && s.players.p1.wallet.ore >= p1Before + done.rewards.p1 - 1e-9, 'paid even though p1 never tapped');
    assert.equal(s.renown, 1);
    assert.equal(s.contract, null);
    assert.equal(renownMult(s), 1.01);
    grant(s, 'guild');
    assert.equal(renownMult(s), 1.02);
  });

  it('run out of time, and the next one comes after a short break', () => {
    const s = room();
    grant(s, 'core');
    const c = withContract(s, 0.99);
    const notes = tickRoom(s, 0.05, c.until + 1, () => 0.5);
    assert.ok(notes.some((n) => n.k === 'contractFailed'));
    assert.equal(s.contract, null);
    assert.ok(s.nextContractAt > c.until && s.nextContractAt - c.until < CONTRACT_MS);
    assert.equal(s.renown, 0);
  });

  it('grow with the crew, but by less than one-for-one', () => {
    for (const k of ['seams', 'crits', 'ore'] as const) {
      const one = contractGoal(k, 0, 1, 1000);
      const four = contractGoal(k, 0, 4, 1000);
      assert.ok(four > one && four < 4 * one, k);
      assert.ok(contractGoal(k, 20, 1, 1000) > one, 'later contracts are bigger');
    }
  });

  it('count crits, comets and the best streak', () => {
    const s = room(2);
    grant(s, 'core');
    const c = withContract(s, 1 / 6 + 0.01);
    assert.equal(c.kind, 'crits');
    applyStrike(s, 'p0', null, T0 + 100_000, 0);
    applyStrike(s, 'p1', null, T0 + 100_000, 0);
    applyStrike(s, 'p1', null, T0 + 100_100, 0.99);
    assert.equal(c.progress, 2);
  });
});

describe('new Forge Tree nodes', () => {
  it('Motherlode, Comet Lure, Core Lens and Deep Refit do what they say', () => {
    const s = room();
    const p = s.players.p0;
    assert.equal(breakMult(s), 5);
    grant(s, 'motherlode');
    assert.equal(breakMult(s), 10);

    p.levels.drone = 10;
    const comet = cometReward(s, p);
    grant(s, 'lure');
    assert.equal(cometReward(s, p), comet * 2);
    s.nextCometAt = T0;
    tickRoom(s, 0.05, T0 + 10, () => 0.999);
    assert.ok(s.nextCometAt - (T0 + 10) <= COMET_GAP_MAX_MS / 2);

    p.run.ore = oreForCores(10);
    assert.equal(leapCores(p, s), 10);
    grant(s, 'corelens');
    assert.equal(leapCores(p, s), 15);

    const tap = tapValue(s, p);
    s.tree.refit = { level: 2, funded: {}, by: {} };
    assert.ok(Math.abs(tapValue(s, p) - tap * 1.5625) < 1e-9);
    assert.equal(nodeCost('refit', 2).ore, NODES.refit.cost.ore! * NODES.refit.repeat! ** 2);
  });

  it('Quantum Echo keeps capped upgrades through a leap', () => {
    const s = room();
    grant(s, 'leap', 'echo');
    const p = s.players.p0;
    Object.assign(p.levels, { lens: 20, smelter: 10, foreman: 2, drill: 50, harvester: 9 });
    p.run.ore = LEAP_MIN_ORE;
    assert.equal(typeof leap(s, 'p0', T0), 'object');
    assert.equal(p.levels.lens, 20);
    assert.equal(p.levels.smelter, 10);
    assert.equal(p.levels.foreman, 2);
    assert.equal(p.levels.drill, 0);
    assert.equal(p.levels.harvester, 0);
  });

  it('fit the star map: tiers in order, at most four a row, never overlapping', () => {
    const rows = new Map<number, number[]>();
    for (const id of NODE_IDS) {
      const { tier, x } = NODES[id];
      assert.ok(Math.abs(x) <= 1.5, id);
      rows.set(tier, [...(rows.get(tier) ?? []), x]);
    }
    for (const [tier, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 1, `tier ${tier} is crowded`);
    }
    for (const id of UPGRADE_IDS) {
      const n = UPGRADES[id].needs;
      assert.ok(!n || Object.hasOwn(NODES, n), id);
    }
  });
});

describe('save migration', () => {
  it('loads a save written before roles, contracts and the new upgrades', () => {
    const s = room();
    const file = JSON.parse(JSON.stringify(toSave(s, T0)));
    const pl = file.room.players.p0;
    for (const k of ['role', 'roleAt', 'auto', 'refine', 'streak', 'chain']) delete pl[k];
    delete pl.stats.contracts;
    delete pl.stats.bestStreak;
    pl.levels = { drill: 5, drone: 7, lens: 3, rig: 0, smelter: 0, scanner: 0, harvester: 0, plating: 0 };
    for (const k of ['contract', 'nextContractAt', 'nextContractId', 'contractsDone', 'renown']) delete file.room[k];
    // Paid more than the node costs now, part-paid, and a node this version doesn't have.
    file.room.tree = {
      core: { level: 0, funded: { ore: 1e6 }, by: { p0: 1 } },
      autorig: { level: 0, funded: { ore: 10 }, by: { p0: 0.001 } },
      bogus: { level: 1, funded: {}, by: {} },
    };
    const back = fromSave(file, T0 + 1000)!;
    assert.ok(back);
    const p = back.players.p0;
    assert.equal(p.role, null);
    assert.equal(p.auto, true);
    assert.equal(p.refine, true);
    assert.equal(p.levels.drill, 5);
    assert.equal(p.levels.combo, 0);
    assert.equal(p.stats.contracts, 0);
    assert.equal(back.renown, 0);
    assert.equal(back.contract, null);
    assert.ok(has(back, 'core'), 'a node paid for at the old price unlocks');
    assert.equal(back.tree.autorig?.funded.ore, 10);
    assert.ok(!('bogus' in back.tree));
    // And it plays.
    addPlayer(back, 'p0', 'key0', 'P0', T0 + 2000);
    assert.equal(typeof applyStrike(back, 'p0', null, T0 + 2000, 0.5), 'object');
    tickRoom(back, 1, T0 + 3000, () => 0.5);
  });

  it('keeps renown and finished contracts, not the running one', () => {
    const s = room();
    s.renown = 7;
    s.contractsDone = 9;
    s.contract = { id: 3, kind: 'seams', goal: 10, progress: 4, at: T0, until: T0 + CONTRACT_MS, by: {} };
    const back = fromSave(JSON.parse(JSON.stringify(toSave(s, T0))), T0 + 5000)!;
    assert.equal(back.renown, 7);
    assert.equal(back.contractsDone, 9);
    assert.equal(back.contract, null);
  });
});

describe('misc', () => {
  it('formats big numbers', () => {
    assert.equal(fmt(999), '999');
    assert.equal(fmt(1500), '1.50K');
    assert.equal(fmt(2.5e9), '2.50B');
  });
  it('asteroid stays near its radius', () => {
    for (let i = 0; i < 50; i++) {
      const r = surfaceRadius([Math.sin(i), Math.cos(i), 0.3].map((v, _, a) => v / Math.hypot(...a)) as [number, number, number], 5);
      assert.ok(r > ASTEROID_RADIUS * 0.6 && r < ASTEROID_RADIUS * 1.4);
    }
  });
});
