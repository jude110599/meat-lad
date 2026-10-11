import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HEAT_MAX,
  MIN_STRIKE_INTERVAL_MS,
  addPlayer,
  applyStrike,
  bulkCost,
  buyUpgrade,
  createRoomState,
  offlineGain,
  OFFLINE_CAP_S,
  quantumPointsFor,
  surfaceRadius,
  tickRoom,
  upgradeCost,
  ASTEROID_RADIUS,
  SEAM_COUNT,
  SEAM_HP,
  type StrikeOutcome,
} from './index.js';

describe('cost curves', () => {
  it('grows geometrically', () => {
    assert.equal(upgradeCost('drillBit', 0), 10);
    assert.equal(upgradeCost('drillBit', 10), Math.ceil(10 * 1.15 ** 10));
  });
  it('bulk cost matches the sum of single purchases within rounding', () => {
    let sum = 0;
    for (let i = 5; i < 15; i++) sum += 10 * 1.15 ** i;
    assert.equal(bulkCost('drillBit', 5, 10), Math.ceil(sum));
  });
});

describe('prestige', () => {
  it('needs the threshold', () => {
    assert.equal(quantumPointsFor(999), 0);
    assert.equal(quantumPointsFor(1000), 1);
    assert.equal(quantumPointsFor(100_000), 10);
  });
  it('rewards co-op leaps', () => {
    assert.equal(quantumPointsFor(100_000, 3), 12);
  });
});

describe('offline gains', () => {
  it('is capped and half efficiency', () => {
    assert.equal(offlineGain(2, 100), 100);
    assert.equal(offlineGain(1, OFFLINE_CAP_S * 3), OFFLINE_CAP_S / 2);
  });
});

describe('asteroid', () => {
  it('is deterministic and roughly spherical', () => {
    const d: [number, number, number] = [0, 1, 0];
    assert.equal(surfaceRadius(d, 42), surfaceRadius(d, 42));
    const r = surfaceRadius(d, 42);
    assert.ok(r > ASTEROID_RADIUS * 0.6);
    assert.ok(r < ASTEROID_RADIUS * 1.4);
  });
});

describe('simulation', () => {
  const setup = () => {
    const s = createRoomState(7);
    addPlayer(s, 'm', 'Miner', 'miner');
    addPlayer(s, 'r', 'Refiner', 'refiner');
    return s;
  };

  it('spawns seams', () => {
    assert.equal(setup().seams.length, SEAM_COUNT);
  });

  it('grants ore for a plain strike and rejects refiners', () => {
    const s = setup();
    const out = applyStrike(s, 'm', null, 1000, 0.99) as StrikeOutcome;
    assert.equal(out.amount, 1);
    assert.equal(s.wallet.ore, 1);
    assert.equal(applyStrike(s, 'r', null, 2000, 0.99), 'wrong-role');
  });

  it('applies crit and seam multipliers', () => {
    const s = setup();
    const seam = s.seams[0];
    const out = applyStrike(s, 'm', seam.id, 1000, 0) as StrikeOutcome;
    assert.equal(out.crit, true);
    assert.equal(out.amount, 1 * 5 * 3);
    assert.equal(seam.hp, SEAM_HP - 2);
  });

  it('rate limits strikes', () => {
    const s = setup();
    applyStrike(s, 'm', null, 1000, 0.99);
    assert.equal(applyStrike(s, 'm', null, 1000 + MIN_STRIKE_INTERVAL_MS - 1, 0.99), 'rate-limited');
  });

  it('depletes and replaces a seam', () => {
    const s = setup();
    const id = s.seams[0].id;
    let t = 1000;
    let out: StrikeOutcome | string = '';
    for (let i = 0; i < SEAM_HP; i++) {
      out = applyStrike(s, 'm', id, (t += 1000), 0.99);
    }
    assert.equal((out as StrikeOutcome).seamDepleted, true);
    assert.equal(s.seams.find((x) => x.id === id), undefined);
    assert.equal(s.seams.length, SEAM_COUNT);
  });

  it('overheats and locks the drill', () => {
    const s = setup();
    let t = 0;
    for (let i = 0; i < 20; i++) {
      const out = applyStrike(s, 'm', null, (t += 60), 0.99);
      if (typeof out !== 'string' && out.overheated) break;
    }
    assert.equal(s.players.m.heat, HEAT_MAX);
    assert.equal(applyStrike(s, 'm', null, t + 100, 0.99), 'overheated');
  });

  it('runs drones and buys upgrades', () => {
    const s = setup();
    s.wallet.ore = 25;
    assert.equal(buyUpgrade(s, 'drone'), true);
    assert.equal(buyUpgrade(s, 'drone'), false);
    tickRoom(s, 2, 0);
    assert.ok(Math.abs(s.wallet.ore - 1) < 1e-6);
  });
});
