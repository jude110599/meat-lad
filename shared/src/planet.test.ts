import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ASTEROID_RADIUS,
  CAM_MAX_DIST,
  LAND_FRACTION,
  MAX_RELIEF,
  RoomHost,
  addPlayer,
  cleanCam,
  createRoomState,
  packCam,
  randomUnit,
  rng,
  surfacePoint,
  surfaceRadius,
  terrainAt,
  unpackCam,
  type Hello,
  type ServerMsg,
  type Vec3,
} from './index.js';

describe('planet surface', () => {
  it('is near-spherical: seas at the radius, land a few percent above', () => {
    for (const seed of [1, 7, 12345, 2 ** 31 - 1]) {
      const r = rng(seed ^ 99);
      let land = 0;
      for (let i = 0; i < 3000; i++) {
        const d = randomUnit(r);
        const rad = surfaceRadius(d, seed);
        assert.ok(Number.isFinite(rad));
        assert.ok(rad >= ASTEROID_RADIUS - 1e-9 && rad <= ASTEROID_RADIUS * (1 + MAX_RELIEF) + 1e-9, `radius ${rad}`);
        if (rad > ASTEROID_RADIUS + 1e-9) land++;
      }
      assert.ok(Math.abs(land / 3000 - LAND_FRACTION) < 0.06, `land share ${land / 3000} for seed ${seed}`);
    }
  });

  it('is deterministic and continuous', () => {
    const d: Vec3 = [0.3, 0.5, -0.81];
    const l = Math.hypot(...d);
    const u: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
    assert.equal(surfaceRadius(u, 42), surfaceRadius(u, 42));
    // A step of a thousandth of a radian moves the surface by much less than a hair.
    const r = rng(5);
    for (let i = 0; i < 500; i++) {
      const a = randomUnit(r);
      const b: Vec3 = [a[0] + 0.001, a[1], a[2]];
      const bl = Math.hypot(...b);
      const dr = Math.abs(surfaceRadius(a, 42) - surfaceRadius([b[0] / bl, b[1] / bl, b[2] / bl], 42));
      assert.ok(dr < 0.01, `jump ${dr}`);
    }
  });

  it('handles odd directions without NaN', () => {
    for (const d of [[0, 0, 0], [3, 0, 0], [NaN, 1, 0], [1e-12, 0, 0]] as Vec3[]) {
      const p = surfacePoint(d, 9);
      const rad = surfaceRadius(d, 9);
      assert.ok(Number.isFinite(rad) && rad >= ASTEROID_RADIUS, `radius for ${d}`);
      if (d.every(Number.isFinite)) assert.ok(p.every(Number.isFinite));
    }
    const t = terrainAt([0, 1, 0], 9);
    assert.ok(t.elev >= -1 && t.elev <= 1 && t.ridge >= 0 && t.ridge <= 1);
  });

  it('places old saves: any seam direction lands on the surface', () => {
    const r = rng(77);
    for (let i = 0; i < 200; i++) {
      const d = randomUnit(r);
      const p = surfacePoint(d, 31337);
      const len = Math.hypot(...p);
      assert.ok(Math.abs(len - surfaceRadius(d, 31337)) < 1e-9);
    }
  });
});

describe('crew cameras', () => {
  it('quantises and round-trips a camera', () => {
    const c = packCam(1.234, -5.678, 7.6, -0.2, 0.3, -1)!;
    assert.deepEqual(c.slice(0, 3), [123, -568, 760]);
    const p: Vec3 = [0, 0, 0];
    const dir: Vec3 = [0, 0, 0];
    assert.ok(unpackCam(c, p, dir));
    assert.ok(Math.abs(p[0] - 1.23) < 1e-9 && Math.abs(p[2] - 7.6) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...dir) - 1) < 1e-9);
    assert.ok(JSON.stringify({ t: 'cam', c }).length < 50);
  });

  it('rejects junk and clamps far cameras', () => {
    assert.equal(packCam(NaN, 0, 0, 0, 0, 1), null);
    assert.equal(packCam(0, 0, 5, 0, 0, 0), null);
    assert.equal(cleanCam('x'), null);
    assert.equal(cleanCam([1, 2, 3]), null);
    assert.equal(cleanCam([1, 2, 3, 0, 0, 0]), null);
    assert.equal(cleanCam([1, 2, 'a', 0, 0, 1]), null);
    const far = cleanCam([1e9, 0, 0, 0, 0, -1000])!;
    assert.ok(far[0] / 100 <= CAM_MAX_DIST + 1e-9);
  });

  it('host relays cameras of online players at a low rate', () => {
    const T0 = 1_000_000;
    const sent: ServerMsg[] = [];
    const h = new RoomHost(createRoomState(3, T0), (_to, m) => sent.push(m), 'ABCDE', () => 0.5);
    const hello = (key: string): Hello => ({ t: 'hello', protocol: 3, name: key, key });
    const a = h.join(hello('aaaa'), T0);
    const b = h.join(hello('bbbb'), T0);
    assert.ok('playerId' in a && 'playerId' in b);
    h.handle(a.playerId, { t: 'cam', c: [0, 160, 760, 0, -200, -980] }, T0);
    h.handle(b.playerId, { t: 'cam', c: [700, 0, 0, -1000, 0, 0] }, T0);
    // Junk is ignored.
    h.handle(b.playerId, { t: 'cam', c: [NaN, 0, 0, 0, 0, 0] as never }, T0);
    let t = T0;
    for (let i = 0; i < 40; i++) h.tick((t += 50)); // 2 s of ticks at 20 Hz
    const cams = sent.filter((m): m is Extract<ServerMsg, { t: 'cams' }> => m.t === 'cams');
    // At most CAM_HZ a second, and at least one relay with both cameras.
    assert.ok(cams.length >= 1 && cams.length <= 3, `relays ${cams.length}`);
    assert.deepEqual(Object.keys(cams[0].cams).sort(), [a.playerId, b.playerId].sort());
    assert.deepEqual(cams[0].cams[b.playerId], [700, 0, 0, -1000, 0, 0]);
    // Alone in the room: nothing is relayed.
    const solo: ServerMsg[] = [];
    const s1 = createRoomState(4, T0);
    const h1 = new RoomHost(s1, (_to, m) => solo.push(m), 'ABCDE', () => 0.5);
    addPlayer(s1, 'x', 'kx', 'X', T0);
    h1.handle('x', { t: 'cam', c: [0, 0, 760, 0, 0, -1000] }, T0);
    for (let i = 0; i < 20; i++) h1.tick(T0 + i * 50);
    assert.equal(solo.filter((m) => m.t === 'cams').length, 0);
  });
});
