import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASTEROID_RADIUS,
  FLARE_MS,
  HEAT_MAX,
  LEAP_THRESHOLD,
  MIN_STRIKE_INTERVAL_MS,
  OFFLINE_CAP_S,
  PROTOCOL_VERSION,
  QUAKE_MS,
  SEAM_COUNT,
  SEAM_HP,
  RoomHost,
  addPlayer,
  applyOffline,
  applyPress,
  applyStrike,
  bulkCost,
  buySkill,
  buyUpgrade,
  createRoomState,
  fromSave,
  isUnlocked,
  UPGRADES,
  offlineGain,
  overclock,
  performLeap,
  proposeLeap,
  castVote,
  quantumPointsFor,
  shieldPress,
  stabilize,
  startEvent,
  surfaceRadius,
  tickRoom,
  toSave,
  upgradeCost,
  type PressOutcome,
  type ServerMsg,
  type StrikeOutcome,
} from './index.js';

const NO_CRIT = 0.99;

function setup() {
  const s = createRoomState(7, 0);
  addPlayer(s, 'm', 'Miner', 'miner');
  addPlayer(s, 'r', 'Refiner', 'refiner');
  return s;
}

describe('cost curves', () => {
  it('grows geometrically', () => {
    assert.equal(upgradeCost('drillBit', 0), 10);
    assert.equal(upgradeCost('drillBit', 10), Math.ceil(10 * 1.18 ** 10));
  });
  it('bulk cost matches the sum of single purchases within rounding', () => {
    let sum = 0;
    for (let i = 5; i < 15; i++) sum += 10 * 1.18 ** i;
    assert.equal(bulkCost('drillBit', 5, 10), Math.ceil(sum));
  });
});

describe('prestige', () => {
  it('needs the threshold and scales with the square root', () => {
    assert.equal(quantumPointsFor(LEAP_THRESHOLD - 0.01), 0);
    assert.equal(quantumPointsFor(LEAP_THRESHOLD), 1);
    assert.equal(quantumPointsFor(LEAP_THRESHOLD * 100), 10);
    assert.equal(quantumPointsFor(LEAP_THRESHOLD * 100, 3), 12);
  });
  it('leaps by vote, keeping Quantum Points and skills', () => {
    const s = setup();
    s.run.cosmicEnergy = LEAP_THRESHOLD * 4;
    s.wallet.ore = 999;
    s.levels.drone = 5;
    assert.equal(proposeLeap(s, 'm', 1000), true);
    tickRoom(s, 0.05, 1050);
    assert.ok(s.vote, 'needs the second player');
    castVote(s, 'r', true);
    const notes = tickRoom(s, 0.05, 1100);
    assert.equal(notes[0]?.k, 'leap');
    assert.equal(s.quantumPoints, 2); // sqrt(4) × 1.1, floored
    assert.equal(s.wallet.ore, 0);
    assert.equal(s.levels.drone, 0);
    assert.equal(buySkill(s, 'ancestralBits'), true);
    assert.equal(s.skills.ancestralBits, 1);
    performLeap(s, 2000);
    assert.equal(s.skills.ancestralBits, 1, 'skills survive leaps');
  });
});

describe('offline gains', () => {
  it('is capped and scaled', () => {
    assert.equal(offlineGain(2, 100), 100);
    assert.equal(offlineGain(1, OFFLINE_CAP_S * 3), OFFLINE_CAP_S / 2);
  });
  it('runs the passive economy while away', () => {
    const s = setup();
    s.levels.drone = 10;
    const { gained } = applyOffline(s, 3600_000, 10_000_000);
    assert.ok(gained.ore > 1000);
  });
});

describe('asteroid', () => {
  it('is deterministic and roughly spherical', () => {
    const d: [number, number, number] = [0, 1, 0];
    assert.equal(surfaceRadius(d, 42), surfaceRadius(d, 42));
    const r = surfaceRadius(d, 42);
    assert.ok(r > ASTEROID_RADIUS * 0.6 && r < ASTEROID_RADIUS * 1.4);
  });
});

describe('mining', () => {
  it('spawns seams', () => {
    assert.equal(setup().seams.length, SEAM_COUNT);
  });
  it('grants ore for a plain strike', () => {
    const s = setup();
    const out = applyStrike(s, 'm', {}, 1000, NO_CRIT) as StrikeOutcome;
    assert.equal(out.amount, 1);
    assert.equal(s.wallet.ore, 1);
  });
  it('applies crit and seam multipliers', () => {
    const s = setup();
    const seam = s.seams[0];
    const out = applyStrike(s, 'm', { seamId: seam.id }, 1000, 0) as StrikeOutcome;
    assert.equal(out.crit, true);
    assert.equal(out.amount, 1 * 5 * 3);
    assert.equal(seam.hp, SEAM_HP - 2);
  });
  it('rate limits strikes', () => {
    const s = setup();
    applyStrike(s, 'm', {}, 1000, NO_CRIT);
    assert.equal(applyStrike(s, 'm', {}, 1000 + MIN_STRIKE_INTERVAL_MS - 1, NO_CRIT), 'rate-limited');
  });
  it('depletes and replaces a seam', () => {
    const s = setup();
    const id = s.seams[0].id;
    let out: StrikeOutcome | string = '';
    for (let i = 0; i < SEAM_HP; i++) out = applyStrike(s, 'm', { seamId: id }, 1000 * (i + 1), NO_CRIT);
    assert.equal((out as StrikeOutcome).seamDepleted, true);
    assert.equal(s.seams.find((x) => x.id === id), undefined);
    assert.equal(s.seams.length, SEAM_COUNT);
  });
  it('overheats and locks the drill', () => {
    const s = setup();
    let t = 0;
    for (let i = 0; i < 20; i++) {
      const out = applyStrike(s, 'm', {}, (t += 60), NO_CRIT);
      if (typeof out !== 'string' && out.overheated) break;
    }
    assert.equal(s.players.m.heat, HEAT_MAX);
    assert.equal(applyStrike(s, 'm', {}, t + 100, NO_CRIT), 'overheated');
  });
  it('runs drones and buys upgrades', () => {
    const s = setup();
    s.wallet.ore = 25;
    assert.equal(buyUpgrade(s, 'drone'), true);
    assert.equal(buyUpgrade(s, 'drone'), false);
    tickRoom(s, 2, 0);
    assert.ok(Math.abs(s.wallet.ore - 1.2) < 1e-6);
  });
  it('hides refinery tiers until their production milestone', () => {
    const s = setup();
    s.wallet.ore = 1e6;
    assert.equal(isUnlocked(s, 'smelter'), false);
    assert.equal(buyUpgrade(s, 'smelter'), false);
    s.run.made.ore = UPGRADES.smelter.unlock!.amount;
    assert.equal(buyUpgrade(s, 'smelter'), true);
  });
  it('rejects unknown upgrade ids from the network', () => {
    assert.equal(buyUpgrade(setup(), 'toString' as never), false);
  });
});

describe('refinery', () => {
  it('presses need a built machine', () => {
    const s = setup();
    s.wallet.ore = 100;
    assert.equal(applyPress(s, 'r', 'smelter', 1000), 'locked');
  });
  it('presses convert ore to alloy and charge power', () => {
    const s = setup();
    s.wallet.ore = 100;
    s.levels.smelter = 1;
    const before = s.power;
    const out = applyPress(s, 'r', 'smelter', 1000) as PressOutcome;
    assert.equal(out.made, 1);
    assert.equal(s.wallet.alloy, 1);
    assert.equal(s.wallet.ore, 90);
    assert.ok(s.power > before);
  });
  it('machines run every tick and can be switched off', () => {
    const s = setup();
    s.wallet.ore = 1000;
    s.levels.smelter = 2;
    tickRoom(s, 1, 1000);
    assert.ok(Math.abs(s.wallet.alloy - 2) < 1e-9);
    s.machinesOn.smelter = false;
    tickRoom(s, 1, 2000);
    assert.ok(Math.abs(s.wallet.alloy - 2) < 1e-9);
  });
  it('a strike and a press in sync build the combo', () => {
    const s = setup();
    s.wallet.ore = 100;
    s.levels.smelter = 1;
    applyStrike(s, 'm', {}, 1000, NO_CRIT);
    applyPress(s, 'r', 'smelter', 1200);
    assert.ok(s.combo > 1);
  });
  it('overclocks spend power', () => {
    const s = setup();
    s.players.m.heat = 90;
    s.power = 30;
    assert.equal(overclock(s, 'r', 'thermalDump', 1000), true);
    assert.equal(s.players.m.heat, 0);
    assert.equal(overclock(s, 'r', 'hyperdrive', 1000), 'no-power');
  });
});

describe('co-op events', () => {
  it('Seismic Shockwave: strike a node, then stabilize to lock it', () => {
    const s = setup();
    const ev = startEvent(s, 'quake', 0, () => 0.3);
    assert.equal(ev.kind, 'quake');
    if (ev.kind !== 'quake') return;
    let t = 100;
    for (const n of ev.nodes) {
      applyStrike(s, 'm', { nodeId: n.id }, (t += 300), NO_CRIT);
      stabilize(s, 'r', (t += 100));
    }
    const notes = tickRoom(s, 0.05, t + 50);
    const end = notes.find((n) => n.k === 'eventEnd');
    assert.ok(end && end.k === 'eventEnd' && end.end.success);
    assert.ok((s.buffs.resonance ?? 0) > t);
  });
  it('Seismic Shockwave fails when time runs out', () => {
    const s = setup();
    startEvent(s, 'quake', 0, () => 0.3);
    const notes = tickRoom(s, 0.05, QUAKE_MS + 1);
    const end = notes.find((n) => n.k === 'eventEnd');
    assert.ok(end && end.k === 'eventEnd' && !end.end.success);
  });
  it('Solar Flare: keeping the shield up wins', () => {
    const s = setup();
    startEvent(s, 'flare', 0, () => 0.3);
    let won = false;
    for (let t = 0; t <= FLARE_MS + 200; t += 200) {
      shieldPress(s, 'r', t);
      for (const n of tickRoom(s, 0.2, t)) if (n.k === 'eventEnd') won = n.end.success;
    }
    assert.equal(won, true);
  });
});

describe('saving', () => {
  it('round-trips a room and drops session-only state', () => {
    const s = setup();
    s.wallet.ore = 123;
    s.levels.drone = 4;
    s.quantumPoints = 3;
    const back = fromSave(JSON.parse(JSON.stringify(toSave(s, 5000))), 6000)!;
    assert.equal(back.wallet.ore, 123);
    assert.equal(back.levels.drone, 4);
    assert.equal(back.quantumPoints, 3);
    assert.deepEqual(back.players, {});
  });
  it('rejects garbage', () => {
    assert.equal(fromSave({ v: 1 }), null);
    assert.equal(fromSave(null), null);
  });
});

describe('RoomHost', () => {
  it('admits players, resolves intents and broadcasts', () => {
    const sent: [string, ServerMsg][] = [];
    const host = new RoomHost(createRoomState(3, 0), (to, m) => sent.push([to, m]), 'ABCDE', () => 0.99);
    const joined = host.join({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'Ana', role: 'miner' }, 0);
    assert.ok('playerId' in joined);
    if (!('playerId' in joined)) return;
    host.handle(joined.playerId, { t: 'strike', seq: 1, seamId: null, nodeId: null }, 1000);
    const fx = sent.filter(([, m]) => m.t === 'fx').flatMap(([, m]) => (m.t === 'fx' ? m.fx : []));
    assert.ok(fx.some((f) => f.k === 'strike' && f.seq === 1));
    assert.equal(host.state.wallet.ore, 1);
    // Reconnect with the token keeps the same player.
    if (joined.welcome.t !== 'welcome') return;
    host.leave(joined.playerId);
    const again = host.join({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'Ana', role: 'miner', resume: joined.welcome.resume }, 2000);
    assert.ok('playerId' in again && again.playerId === joined.playerId);
  });
  it('refuses old clients and full rooms', () => {
    const host = new RoomHost(createRoomState(3, 0), () => {}, 'ABCDE');
    assert.deepEqual(host.join({ t: 'hello', protocol: 1, name: 'x', role: 'miner' }), { error: 'protocol-mismatch' });
    for (let i = 0; i < 4; i++) host.join({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'p' + i, role: 'miner' });
    assert.deepEqual(host.join({ t: 'hello', protocol: PROTOCOL_VERSION, name: 'late', role: 'miner' }), { error: 'room-full' });
  });
});
