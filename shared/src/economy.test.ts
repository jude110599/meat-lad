import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASTEROID_RADIUS,
  BREAK_MULT,
  COMET_MS,
  LEAP_MIN_ORE,
  MAX_PLAYERS_PER_ROOM,
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
    assert.equal(s.players.p0.wallet.ore, 1);
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
    assert.equal(tapValue(s, s.players.p0), 2);
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
    assert.equal(tapValue(s, s.players.p1), 1.5);
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

  it('Crew Link scales with the crew', () => {
    const s = room();
    assert.equal(crewMult(s, 1), 1);
    grant(s, 'teamlink');
    assert.equal(crewMult(s, 1), 1.25);
    assert.equal(crewMult(s, 2), 1.25);
    assert.equal(crewMult(s, 4), 1.75);
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
    assert.equal(p.levels.drill, 10);
    assert.equal(p.levels.drone, 10);
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
