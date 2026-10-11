# Starforge: Technical Design Specification

**Status:** v0.1, prototype scaffold. **Owner:** Lead Game Developer / Systems Architect.
**Scope:** a high-performance 3D multiplayer incremental mining game with asymmetric co-op roles, an authoritative server, and an exponential economy with a shared prestige layer.

This document is the source of truth for system design, network protocol and balance. Where a number appears in both this file and `shared/src/economy.ts`, the code wins and this file should be corrected.

---

## Table of contents

1. [Product summary](#1-product-summary)
2. [Relationship to the rest of this repository](#2-relationship-to-the-rest-of-this-repository)
3. [Technology stack and decisions](#3-technology-stack-and-decisions)
4. [Repository layout, running and deploying](#4-repository-layout-running-and-deploying)
5. [Runtime architecture](#5-runtime-architecture)
6. [Network protocol](#6-network-protocol)
7. [3D world and rendering](#7-3d-world-and-rendering)
8. [Core mining gameplay](#8-core-mining-gameplay)
9. [Asymmetric roles](#9-asymmetric-roles)
10. [Co-op events and mini-bosses](#10-co-op-events-and-mini-bosses)
11. [Incremental economy and balance curves](#11-incremental-economy-and-balance-curves)
12. [Prestige: the Galactic Quantum Leap](#12-prestige-the-galactic-quantum-leap)
13. [Persistence and offline progress](#13-persistence-and-offline-progress)
14. [Security and anti-cheat](#14-security-and-anti-cheat)
15. [Performance budgets](#15-performance-budgets)
16. [Testing and tooling](#16-testing-and-tooling)
17. [Roadmap](#17-roadmap)
18. [Open questions](#18-open-questions)

---

## 1. Product summary

Up to four players share one **expedition**: a rotating asteroid in a 3D scene. **Mining Specialists** fire drill lasers at the rock and its glowing mineral seams, juggling heat for bonus yield. **Refinery Operators** run a 3D processing station that turns ore into higher-tier materials and feeds power overclocks back to the miners. Drones, rigs and conveyors visibly automate the work as the expedition grows. Periodic **co-op events** (Seismic Shockwaves, Solar Flares) require synchronized inputs from both roles. When the team has produced enough Cosmic Energy, it can vote to perform a **Galactic Quantum Leap**: surface progress resets and every participant earns permanent Quantum Points for a cosmic skill tree.

Design pillars:

| Pillar | What it means in practice |
|---|---|
| **Tactile 3D clicks** | Every strike lands on a real point on a real mesh, with a laser, sparks, a number and a camera kick within one frame. Feedback is never delayed by the network. |
| **Visible automation** | Passive income is never just a number. If you bought 40 drones, you can see 40 drones. |
| **Roles that need each other** | A miner alone can progress, but slowly. Refiners multiply what miners produce, and co-op events can only be solved together. |
| **Numbers go up, forever** | Geometric costs, milestone doublings and a prestige layer that is designed to be repeated. |
| **One rules implementation** | Every outcome is computed by pure functions in `/shared`, run by the server online and by the browser offline. |

---

## 2. Relationship to the rest of this repository

This repo is an arcade of browser games (`index.html` menu plus one self-contained HTML file per game, deployed to GitHub Pages from `main`). One of those games, **Deepcore** (`deepcore.html`), is already a co-op mining incremental:

| | Deepcore (existing) | Starforge (this design) |
|---|---|---|
| Rendering | 2D canvas, one file | Three.js via React Three Fiber, bundled with Vite |
| Players | 1 or 2 on the **same device** (split stations) | 1 to 4 over the **network**, authoritative server |
| Save | `localStorage` | Redis (hot) + MongoDB (durable); `localStorage`-free offline mode |
| Roles | Driller / Refiner | Mining Specialist / Refinery Operator |
| Chain | ore → alloy → compound → energy | ore → alloy → plasma → dark matter → cosmic energy |
| Prestige | Collapse the Shaft → Core Shards | Galactic Quantum Leap → Quantum Points (shared vote) |

Starforge is a **separate, larger successor**, not a rewrite of Deepcore. Deepcore stays as it is. Concepts proven in Deepcore are deliberately carried over: the heat mechanic with a "hot drilling" bonus, sync-strike combos between the two roles, and the two event archetypes (cave-in → Seismic Shockwave, magma surge → Solar Flare).

Unlike the other games, Starforge has a build step and a server, so it lives in its own top-level folders (`/client`, `/server`, `/shared`) with its own `package.json`. Nothing in the existing games, the menu, or the existing workflows is touched. See §4.3 for how it would be published.

---

## 3. Technology stack and decisions

### 3.1 Chosen stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One type system across client, server and protocol; protocol shapes are compile-checked on both ends. |
| Rendering | **Three.js + React Three Fiber (R3F)** + `@react-three/drei` + `@react-three/postprocessing` | R3F gives declarative scene composition and React-driven HUD state, while still allowing imperative hot paths (`useFrame`, instanced meshes, pooled buffers). Bloom is what makes emissive seams, lasers and plasma read as "glowing". |
| Build | **Vite** | Instant dev server, HMR for scene code, tiny static output. |
| Client state | **Zustand** | Chosen over Redux Toolkit: the client store is a replica written by one authority, not a reducer graph, and Zustand's selector subscriptions let R3F components read state without re-rendering the Canvas tree. Transient FX bypass the store entirely (§5.4). |
| Networking | **Socket.io 4** over WebSocket, authoritative Node server | Rooms, acknowledgements, reconnection and a Redis adapter for horizontal scale are built in. WebRTC was rejected: peer-hosted state cannot be authoritative, and NAT traversal adds failure modes for no latency gain at this tick rate. |
| Server runtime | **Node 22** with `tsx` | Runs the same TS sources as the client imports, no separate compile in dev. |
| Hot state | **Redis 7** | Room state, presence, rate-limit counters, Socket.io adapter pub/sub. |
| Durable state | **MongoDB 7** | Player profiles, Quantum skill trees, lifetime stats, expedition history. Document-shaped data with frequent schema evolution. |
| Big numbers | `number` now, **`break_eternity.js` `Decimal`** from milestone M3 | Doubles overflow at ~1.8e308. Tiers past Dark Matter will exceed that. The shared economy functions are the only place that does arithmetic, so the switch is contained. |
| Tests | Node's built-in `node:test` runner via `tsx` | Zero extra dependencies; the shared rules are pure functions and need nothing more. |

### 3.2 Rejected alternatives

* **Raw WebGL**: full control, but rebuilding a scene graph, raycasting and postprocessing is months of work R3F gives for free.
* **Redux Toolkit**: its strengths (action logs, devtools time travel, normalized reducers) matter less when the server is the reducer. Zustand is smaller and faster to subscribe from inside the render loop.
* **Colyseus**: attractive state-sync framework, but its schema serializer fights with the shared pure-function rules approach. Revisit if delta compression becomes a bottleneck (§6.6).

---

## 4. Repository layout, running and deploying

### 4.1 Layout

```
/DESIGN.md                 this document
/package.json              npm workspaces root: shared, server, client
/tsconfig.base.json        strict TS settings shared by all three packages
/shared/                   @starforge/shared: the rules. Pure, isomorphic, no I/O.
  src/resources.ts         resource tiers, colors, refinery ratios
  src/economy.ts           upgrade defs, cost curves, crit, heat, prestige, offline formulas
  src/asteroid.ts          seeded PRNG + deterministic asteroid surface function
  src/sim.ts               RoomState, applyStrike, tickRoom, buyUpgrade
  src/protocol.ts          Socket.io event map and payload types, protocol version
  src/format.ts            1.23K / 4.5Qa number formatting
  src/economy.test.ts      unit tests for curves and the simulation
/server/                   @starforge/server: authoritative Socket.io server
  src/index.ts             HTTP + Socket.io bootstrap, lobby / room codes, /health
  src/game/Room.ts         one expedition: 20 Hz tick, 10 Hz snapshots, intent handlers
  src/persistence/Store.ts ProgressStore interface + MemoryStore (Redis/Mongo adapters planned)
/client/                   @starforge/client: Vite + React + R3F
  src/net/authority.ts     Authority interface; RemoteAuthority (server) and LocalAuthority (offline)
  src/state/store.ts       Zustand replica of the room
  src/state/fx.ts          transient FX event bus (lasers, bursts, floaters, shake)
  src/scene/               GameScene, Asteroid + seams, Drones, particle/laser/floater effects
  src/ui/Hud.tsx           resource counters, heat bar, upgrade shop
```

### 4.2 Running locally

```bash
npm install
npm run dev          # server on :3001 and client on :5173 together
npm test             # shared rules tests
npm run typecheck    # all three packages
```

Open `http://localhost:5173`. The client connects to the server, creates a room, and writes `?room=CODE` into the URL; open that URL in a second tab (optionally with `&role=refiner`) to join the same expedition. If the server is not running, the client falls back to **offline mode** after ~2 s and runs the same rules locally (`?offline` forces this).

### 4.3 Publishing

The existing site deploys the repo root to GitHub Pages. Starforge's client must be **built** before it can be served, and its server must run somewhere that supports WebSockets. Proposed (not yet implemented, needs sign-off because it changes the live site):

1. A workflow builds `client/` with `VITE_SERVER_URL` set and publishes `client/dist` to `/starforge/` on Pages (`vite.config.ts` already uses `base: './'`).
2. The server runs as a container (Fly.io / Railway / Render) with managed Redis and MongoDB Atlas.
3. A card is added to `index.html` linking to `starforge/`.

Until a server is deployed, the Pages build still works: it simply runs in offline mode.

---

## 5. Runtime architecture

### 5.1 Authority model

```
        intents (strike, buy, route, vote)                    rules: @starforge/shared
 ┌────────────┐  ───────────────────────────►  ┌──────────────────────────────┐
 │  Client    │                                │  Server Room (per expedition)│
 │  (replica) │  ◄───────────────────────────  │  RoomState  ← applyStrike    │
 └────────────┘   results + 10 Hz snapshots    │             ← tickRoom 20 Hz │
       │                                       │             ← buyUpgrade     │
       │ offline: same Authority interface     └──────────────┬───────────────┘
       ▼                                                      │ write-behind 30 s
 ┌────────────────┐                                    ┌──────┴──────┐  ┌─────────┐
 │ LocalAuthority │ runs the same shared rules         │   Redis     │  │ MongoDB │
 └────────────────┘ in the browser                     └─────────────┘  └─────────┘
```

* Clients send **intents only**. They never send amounts, crit flags, or positions the server trusts.
* The server owns all randomness (crit rolls, seam spawns from its seed sequence, event timing).
* `shared/src/sim.ts` is a set of pure functions over plain JSON. The server and `LocalAuthority` both call them, so there is exactly one implementation of every rule. The client's UI code holds an `Authority` and does not know which one it has.

### 5.2 Server loop

Each `Room`:

| Loop | Rate | Work |
|---|---|---|
| Simulation tick | 20 Hz (`SERVER_TICK_HZ`) | `tickRoom(state, dt)`: drone and rig output, heat venting, refinery throughput, event timers. |
| Snapshot | 10 Hz (`SNAPSHOT_HZ`) | Broadcast `snapshot` to the Socket.io room. |
| Intents | event-driven | `mine:strike` resolved immediately with `applyStrike` and broadcast as `mine:result`. |
| Persistence | every 30 s and on room close | `ProgressStore.saveRoom`. |

`dt` is measured, not assumed, so a delayed tick catches up instead of losing production. Long stalls (>1 s) will be clamped and the remainder credited through the offline-gain path (§13.3) to avoid a single giant tick.

### 5.3 Client replica and prediction

* **Counter interpolation:** the HUD shows `wallet.ore + orePerSec × (now − snapshotAt)` every animation frame, so the counter ticks smoothly at 60+ fps between 10 Hz snapshots.
* **Cosmetic prediction:** on pointer-down the client immediately fires the laser to the exact hit point and stores `{seq → point, normal}`. When `mine:result` arrives with the same `seq`, the burst, floating number and shake play at that point. Typical LAN/regional latency (20 to 80 ms) is hidden by the laser travel; the yield itself is never predicted, so there is nothing to roll back.
* **Other players' strikes** arrive without a local point; they are drawn at the struck seam (or a random seam) transformed into world space through the rock's current matrix.
* **Rejected intents** (`mine:reject`) just drop the pending entry. The UI reflects overheat from the replicated `heat` and `lockedUntil`.

### 5.4 Two kinds of client state

| Kind | Where | Examples | Re-renders React? |
|---|---|---|---|
| Replicated game state | Zustand store (`state/store.ts`) | wallet, levels, seams, players, heat | Yes, via selectors |
| Transient effects | FX bus (`state/fx.ts`) | laser, particle burst, floater, camera shake | No; consumers animate in `useFrame` |

Keeping hundreds of sparks per second out of React state is what keeps the scene at frame rate during rapid clicking.

---

## 6. Network protocol

### 6.1 Transport

Socket.io 4 over WebSocket only (`transports: ['websocket']`, no long-polling fallback), JSON payloads. `PROTOCOL_VERSION` (currently `1`) is checked in the handshake; a mismatch is rejected with `protocol-mismatch` and the client prompts a reload.

### 6.2 Handshake and lobby

```
client                                   server
  │ connect (ws)                            │
  │ hello {protocol, name, role,            │
  │        room?, resumeToken?}  ─────────► │ validate version
  │                                         │ room? join : create (6-char code, no 0/O/1/I)
  │                                         │ resumeToken? reclaim slot : new player
  │ ◄─────────  ack Welcome {room, playerId,│
  │             resumeToken, seed, snapshot}│
  │ ◄─────────  player:joined (to others)   │
```

* **Room codes:** 6 characters from a 32-symbol alphabet (~1.07e9 codes). Share links are `?room=CODE`.
* **Capacity:** `MAX_PLAYERS_PER_ROOM = 4`. Target composition is 2 miners + 2 refiners; any mix is allowed, and solo players hold both roles once the refinery ships (M2).
* **Reconnect:** the client keeps `resumeToken` in `sessionStorage`. On reconnect it re-sends `hello` with the room and token and gets the same `playerId` back. Empty rooms linger 60 s before being closed and saved.
* **Matchmaking (M4):** a public lobby list in Redis (`lobby:open` sorted set by open slots, filtered by "needs miner / needs refiner").

### 6.3 Events

Client → server (intents):

| Event | Payload | Ack | Notes |
|---|---|---|---|
| `hello` | `HelloPayload` | `Welcome \| {error}` | once per connection |
| `mine:strike` | `{seq, seamId \| null}` | none | rate-limited (§14) |
| `shop:buy` | `{id: UpgradeId}` | none | result visible in next snapshot (sent immediately) |
| `ping` | `clientTime` | `serverTime` | clock offset estimation for event sync windows |
| `refinery:route` *(M2)* | `{nodeId, outputId}` | none | reroute a pipeline edge |
| `refinery:overclock` *(M2)* | `{targetPlayerId, kind}` | none | spends power on a miner buff |
| `event:input` *(M3)* | `{eventId, inputId, t}` | none | synchronized boss inputs |
| `leap:vote` *(M3)* | `{yes: boolean}` | none | prestige vote |

Server → client:

| Event | Payload | Rate |
|---|---|---|
| `snapshot` | `Snapshot` (wallet, levels, seams, players, orePerSec, quantumPoints) | 10 Hz + on purchases |
| `mine:result` | `StrikeOutcome & {seq}` | per accepted strike, broadcast to the room |
| `mine:reject` | `{seq, reason}` | to the striker only |
| `player:joined` / `player:left` | `PlayerState` / `{id}` | on change |
| `event:start` / `event:state` / `event:end` *(M3)* | event descriptor, progress, outcome | on change, 10 Hz during events |

All payload types live in `shared/src/protocol.ts` and are applied as Socket.io generics on both ends, so a shape change fails type-checking in both packages.

### 6.4 Bandwidth budget

A full snapshot with four players is ~1.1 KB of JSON. At 10 Hz to 4 players that is ~44 KB/s per room outbound. A `mine:result` is ~180 bytes; at the 20 strikes/s/player cap with 4 miners that is 80 results/s × 4 recipients ≈ 58 KB/s worst case. Target per room is **< 120 KB/s** outbound, i.e. ~1,000 concurrent rooms per 1 Gbps node before CPU becomes the limit. Delta snapshots (§6.6) roughly halve the steady-state figure.

### 6.5 Time sync

`ping` round trips (every 5 s, median of last 5) estimate `serverOffset`. Co-op events schedule inputs in server time; the client converts to local time for its timing UI. Accepted input windows are evaluated server-side with the striker's measured half-RTT subtracted, capped at 150 ms of compensation.

### 6.6 Scaling path

1. **Single node** (now): rooms in memory, `MemoryStore`.
2. **Multi node**: `@socket.io/redis-adapter` for cross-node broadcast; a room is pinned to one node (`room:{code}:node` in Redis) and the load balancer routes by room code (sticky). Rooms are not migrated live; on node drain they are saved and reloaded on another node at next join.
3. **Delta snapshots** (if bandwidth matters): send only changed top-level fields keyed by tick, full snapshot every 2 s.

---

## 7. 3D world and rendering

### 7.1 Scene graph

```
<Canvas>
  background + fog + Stars
  ambientLight, directionalLight (key: distant star), pointLight (rim: refinery glow)
  <Asteroid>                group rotating slowly; registers itself as rockRef for world transforms
    mesh                    icosphere(detail 6) displaced by surfaceRadius(), flat-shaded, vertex colors
    <SeamCrystal> × N       5 emissive octahedron shards + pointLight + invisible hit sphere
  <Drones>                  InstancedMesh bodies + InstancedMesh beams, ≤ 64 visible
  <Particles>               one pooled THREE.Points cloud, 3,000 particles, additive
  <Laser>                   camera-anchored beam to the hit point
  <Floaters>                drei <Html> yield numbers
  <CameraShake>, <FitCamera>
  <OrbitControls>           orbit and zoom only, no pan
  <EffectComposer>          Bloom (mipmap) + Vignette
```

### 7.2 The asteroid surface

`shared/src/asteroid.ts` defines `surfaceRadius(direction, seed)`: a base radius of 2.2 modulated by nine seeded sinusoidal lobes. Because it is deterministic and shared, the server can place a seam by sending only a unit direction, and the client renders it exactly on the visible surface. No geometry is ever sent over the network.

### 7.3 Destructible terrain (M3)

The prototype rock is a single displaced mesh with a destructible **seam layer** (seams have HP, deplete, and respawn). The full design replaces the mesh with a **chunked signed-distance voxel field**:

* 32³ voxels per chunk, 6 × 6 × 6 chunks per asteroid, density stored as `Int8Array`.
* Meshing with **surface nets** (smoother than marching cubes, fewer triangles) in a Web Worker, transferable buffers back to the main thread.
* The server is authoritative over **edits**, not meshes: a strike that carves emits `terrain:carve {chunk, center, radius, seq}`. Clients apply carves to their local field and remesh the affected chunks (≤ 8 per carve).
* Ore richness is a second channel in the field; carving into a rich region reveals seams.
* A new expedition (or a Quantum Leap) regenerates the field from a new seed, so terrain never needs to persist beyond room state.

### 7.4 Lighting and VFX

* Seams are emissive with `emissiveIntensity` pulsing 2.2 to 4.7 and a short-range point light, so they light the surrounding rock. Bloom threshold 0.6 makes only emissive and additive elements bloom.
* Particle bursts scale with outcome: plain 18, seam 36, crit 70, depletion 160 + 60 white-hot.
* Resource tiers have fixed colors (`RESOURCE_DEFS.*.color`) used consistently for HUD, particles and seams of that tier.
* Planned: solar flare event darkens the key light and drives a full-screen chromatic aberration pulse; seismic shockwave sends a displacement ring across the rock in a vertex shader.

---

## 8. Core mining gameplay

### 8.1 Active mining (implemented)

| Action | Rule (from `sim.ts` / `economy.ts`) |
|---|---|
| Strike rock | `strikeBase = (1 + drillBit) × 2^floor(drillBit/25) × quantumMult` |
| Strike a seam | × `SEAM_MULT` (3); seam loses 1 HP (2 on a crit) |
| Deplete a seam | × 4 jackpot on the final hit; a new seam spawns elsewhere |
| Critical strike | chance `min(50%, 5% + 1% × focusLens)`, × `CRIT_MULT` (5) |
| Hot drilling | while heat ≥ 70, all strikes × 2 |
| Heat | +`7 × 0.94^coolant` per strike, vents `18 × (1 + 0.08 × coolant)`/s; at 100 the drill locks for 2 s |

Heat turns clicking into a rhythm: ride just under 100 to stay in the ×2 band, then back off. With no coolant upgrades, about 14 strikes in quick succession overheat the drill.

### 8.2 Mining rig customization (M2)

The Mining Specialist's rig has three slots, swappable outside of events:

| Slot | Options | Trade-off |
|---|---|---|
| Emitter | Laser (default), Pulse Drill, Plasma Lance | Laser: single target. Pulse: 3-strike burst, +40% heat. Lance: hold to channel, damage ramps, no crits. |
| Lens | Focus, Wide, Prism | Crit chance vs. splash to nearby seams vs. converts 10% of yield into the next tier up. |
| Heat sink | Passive, Vented, Cryo | Vent rate vs. hot-band width vs. overheat lock duration. |

Rig cosmetics (paint, emitter color, beam shape) are profile-level and persist across leaps.

### 8.3 Passive automation

| Automation | Status | Behaviour |
|---|---|---|
| **Orbital drones** | implemented | `0.5 ore/s` each, ×2 every 25 levels. Each has its own orbit plane and dives to the surface with a mining beam. One instanced draw call for all drones. |
| **Automated rigs** | M2 | Placed on the surface at a chosen seam; mine that seam at 1 strike/s with the owner's rig stats minus crits. Visible as a tripod drill with a pulsing beam. |
| **Conveyors** | M2 | Catmull-Rom splines from rigs to the refinery dock. Ore travels as instanced cubes along the spline (`t += speed × dt`), so throughput is literally visible. Conveyor throughput caps rig output. |

---

## 9. Asymmetric roles

### 9.1 Mining Specialist (frontline)

Camera orbits the asteroid. Inputs: strike, choose seams, manage heat, place rigs (M2), respond to event prompts. Owns heat and rig loadout. Contributes ore.

### 9.2 Refinery Operator (station)

Camera views a station diorama beside the asteroid. Inputs: route pipeline edges, set smelter recipes, allocate power, fire overclocks, respond to event prompts. Owns **power** and **pipeline**.

**Processing pipeline (M2).** A directed graph of machines placed on a grid:

| Machine | Input → Output | Base rate |
|---|---|---|
| Smelter | 10 ore → 1 alloy | 1/s |
| Plasma Infuser | 25 alloy → 1 plasma | 0.25/s |
| Dark Compressor | 50 plasma → 1 dark matter | 0.05/s |
| Cosmic Condenser | 100 dark matter → 1 cosmic energy | 0.01/s |
| Splitter / Merger | routing | n/a |

Ratios match `RESOURCE_DEFS.*.ratio`. Each machine draws power; the station generates power from a reactor that burns alloy. Throughput upgrades multiply machine rate; adding a machine in parallel needs routing work, which is the Refiner's skill expression.

**Overclocks (power → miner buffs).** Spend banked power for timed buffs on a chosen miner:

| Overclock | Effect | Duration | Cost |
|---|---|---|---|
| Thermal Dump | instantly vent 60 heat | instant | 20 power |
| Focus Field | +15% crit chance | 10 s | 40 power |
| Hyperdrive | strike rate cap 20 → 30/s and ×2 yield | 8 s | 80 power |

### 9.3 Synergies

* **Sync strike** (from Deepcore): a miner strike and a refiner "press" within 500 ms builds a combo up to ×2 for both.
* Refined alloy is the currency for drones and coolant tiers, so miners depend on refiners for automation.
* Solo players can switch roles at will with a 2 s swap animation; the role they are not in runs at 25% efficiency, which makes co-op roughly 2× faster than solo at equal skill.

---

## 10. Co-op events and mini-bosses

Events start on a server timer (every 4 to 7 minutes, never during another event) and are only offered when at least one player is in each role, or a solo player has unlocked both.

### 10.1 Seismic Shockwave

* A fault line glows across the asteroid; **three** resonance nodes appear on the surface.
* Miners must strike all three nodes; refiners must hold the **damper** input for each node in the same 400 ms window as its strike (server-time window, §6.5).
* 6 successful pairs in 20 s → reward: all seams refilled + ×3 ore for 30 s. Failure → the shockwave knocks 30% of unprocessed ore off conveyors.

### 10.2 Solar Flare

* The key light swings to a flare-facing direction; a shadow-side safe zone rotates around the rock.
* Miners must keep their rig aimed inside the safe zone (camera alignment, checked server-side from submitted aim direction at 5 Hz), or heat climbs 3× faster.
* Refiners must divert power to shields in a rhythm prompt (4 beats per bar).
* Survive 30 s → reward: one free Plasma per 10 alloy for 60 s. Failure → drones disabled for 20 s.

### 10.3 Event protocol

`event:start {id, kind, startsAt, endsAt, nodes[]}` → `event:input` from clients → `event:state {progress, pairs}` at 10 Hz → `event:end {success, rewards}`. All judgement is server-side.

---

## 11. Incremental economy and balance curves

### 11.1 Resource chain

| Tier | Resource | Produced by | Ratio | Color |
|---|---|---|---|---|
| 1 | Raw Ore | strikes, drones, rigs | n/a | `#ffb03a` |
| 2 | Refined Alloy | Smelter | 10 ore | `#cfd6e6` |
| 3 | Exotic Plasma | Plasma Infuser | 25 alloy | `#4de8ff` |
| 4 | Dark Matter Compound | Dark Compressor | 50 plasma | `#b07cff` |
| 5 | Cosmic Energy | Cosmic Condenser | 100 dark matter | `#ffe28a` |

One Cosmic Energy therefore embodies 10 × 25 × 50 × 100 = **1.25 million** ore.

### 11.2 Cost curves

Every upgrade uses `cost(n) = ceil(base × growth^n)`, and bulk purchases use the closed-form geometric sum `base × growth^n × (growth^k − 1) / (growth − 1)` (`bulkCost`).

| Upgrade | Currency | Base | Growth | Lv 10 | Lv 25 | Lv 50 | Lv 100 |
|---|---|---|---|---|---|---|---|
| Drill Bit | ore | 10 | 1.15 | 41 | 330 | 10.8K | 11.7M |
| Focus Lens (max 45) | ore | 50 | 1.35 | 1.0K | 90.6K | n/a | n/a |
| Coolant Loop (max 12) | ore | 75 | 1.60 | 8.2K | n/a | n/a | n/a |
| Orbital Drone | ore | 25 | 1.12 | 78 | 426 | 7.2K | 2.1M |

In M2, Coolant and Drone costs move to alloy so that mining automation depends on refining.

### 11.3 Production growth

* Producers grow **linearly per level** and **double every 25 levels** (`milestoneMult`). Costs grow geometrically, so each milestone is a visible spike that briefly outpaces cost, then the curve flattens again until the next one. This is the classic incremental sawtooth.
* Per-tier multiplier upgrades (M2) are bought with the tier above (e.g. a plasma-priced ×2 to all ore), so climbing the chain always feeds back into the bottom of it.

### 11.4 Pacing targets

| Milestone | Target time (first run, active co-op) |
|---|---|
| First drone | < 1 min |
| First alloy | ~3 min |
| First plasma | ~15 min |
| First dark matter | ~45 min |
| First cosmic energy | ~2 h |
| First Quantum Leap available (1,000 CE) | ~6 to 8 h |
| Second leap | ~50% of the first, thanks to Quantum Points |

These will be validated with a headless balance simulator (§16.2) before any number is tuned by hand.

### 11.5 Big numbers

Values will exceed `Number.MAX_VALUE` around the third leap. At M3 the economy functions switch to `break_eternity.js` `Decimal` (supports up to 10↑↑1e308), stored as strings in Mongo and as `{m, e}` pairs on the wire. `fmt()` already switches to scientific notation past decillions.

---

## 12. Prestige: the Galactic Quantum Leap

* **Unlock:** 1,000 Cosmic Energy produced in the current run (`LEAP_THRESHOLD`).
* **Vote:** any player can propose; it passes when every connected player votes yes, or by majority after 30 s. All connected players leap together, which is what makes the prestige "shared".
* **Reward:** `QP = floor( sqrt(runCosmicEnergy / 1000) × (1 + 0.1 × (participants − 1)) )` per participant (`quantumPointsFor`). Square-root scaling means pushing a run longer is rewarded but with diminishing returns, so leaping repeatedly is optimal. The co-op factor gives up to +30% for a full room.
* **Passive effect:** every **unspent** QP is +2% to all production (`quantumMult`), so hoarding is a valid strategy.
* **Resets:** wallet, upgrade levels, rigs, conveyors, pipeline layout, terrain seed. **Keeps:** QP, the cosmic skill tree, rig cosmetics, lifetime stats.

### 12.1 Cosmic skill tree

Three branches, each node costs QP and has a max level:

| Branch | Example nodes |
|---|---|
| **Excavation** (miner) | Ancestral Bits: +25% strike yield/level · Thermal Mastery: hot band starts at 60 · Seam Sense: +1 seam on the rock |
| **Industry** (refiner) | Furnace Soul: +25% refinery rate/level · Grid Surplus: +20% power · Head Start: begin a run with 500 alloy/level |
| **Resonance** (co-op) | Resonant Bond: +0.5 max sync combo · Event Horizon: event rewards ×1.5 · Shared Wake: offline gains efficiency 50% → 75% |

Spending QP trades the +2% passive for a targeted bonus; nodes are tuned so the first few points in each branch are worth more than hoarding.

---

## 13. Persistence and offline progress

### 13.1 Redis (hot)

| Key | Type | Contents | TTL |
|---|---|---|---|
| `room:{code}` | hash | serialized `RoomState` fields | 24 h after last activity |
| `room:{code}:node` | string | owning server node id | refreshed every tick batch |
| `room:{code}:players` | set | connected player ids | none (maintained) |
| `rl:strike:{playerId}` | string | token bucket for rate limiting | 2 s |
| `lobby:open` | sorted set | room codes by open slots | maintained |
| `session:{resumeToken}` | string | `playerId` and room code | 24 h |

### 13.2 MongoDB (durable)

```ts
// players
{ _id, displayName, createdAt, lastSeenAt,
  quantumPoints, skillTree: { [nodeId]: level },
  cosmetics: { rigPaint, beamColor }, lifetime: { ore, strikes, leaps, events } }

// expeditions (one per room lifetime)
{ _id: roomCode, seed, createdAt, closedAt, members: [playerId],
  state: RoomStateSnapshot, leaps: [{ at, participants, qpEach }] }
```

Write-behind from Redis to Mongo every 30 s and on room close. All schema changes ship with a version field and a forward migration run on load.

### 13.3 Offline gains

When a player rejoins: `gain = passivePerSec × min(elapsed, 8 h) × 50%` (`offlineGain`), computed from the room's saved passive rate and `lastSeenAt`, then shown in a "while you were away" card. In a shared expedition the room keeps running while anyone is online, so offline gains only apply to rooms that were fully empty.

---

## 14. Security and anti-cheat

* **Intents only.** The client cannot send amounts, crit results or upgrade outcomes.
* **Rate limits.** `MIN_STRIKE_INTERVAL_MS = 50` (20 strikes/s) per player is enforced inside `applyStrike`; in multi-node mode a Redis token bucket backs it up. Sustained rejection triggers a 10 s soft lock and a log entry.
* **Input validation.** Every handler type-checks its payload; `buyUpgrade` rejects unknown ids with `Object.hasOwn` since ids arrive from the network.
* **Resume tokens** are 128-bit random, stored server-side; player ids are not secrets and are never accepted as credentials.
* **Auth (M4):** optional account linking via OAuth (Google / Discord) so profiles follow players across devices. Anonymous play keeps a device-bound token.
* **Clock-dependent fields** (`lockedUntil`) are server-epoch; the client corrects them with `serverOffset` (§6.5) once time sync lands, so the overheat UI is accurate across skewed clocks.
* **CORS** for Socket.io is limited to `CORS_ORIGINS`.

---

## 15. Performance budgets

| Budget | Target | How |
|---|---|---|
| Frame rate | 60 fps on a 2020 mid-range laptop, 45+ on a recent phone | `dpr={[1, 2]}`, bloom with mipmap blur, no shadows on mobile |
| Draw calls | < 60 | instanced drones / conveyor items / rigs, one particle cloud, shared seam material per seam |
| Triangles | < 300K | prototype asteroid is a deliberately faceted icosphere (detail 6, ~1K tris); voxel chunks LOD'd by distance |
| Particles | 3,000 pooled | ring buffer, no allocations per burst |
| Main-thread GC | no allocations in `useFrame` hot paths | reused vectors/matrices; remeshing in a worker |
| Input → feedback | < 16 ms | laser and floater are client-side; only yield waits on the server |
| Server tick | < 2 ms per room at 20 Hz | pure functions, no I/O inside ticks |

---

## 16. Testing and tooling

### 16.1 Today

* `npm test`: `node:test` suite over the shared rules (cost curves, bulk cost, prestige, offline cap, deterministic asteroid, strike/crit/seam/rate-limit/overheat/drone simulation).
* `npm run typecheck`: strict TypeScript for all three packages, including the Socket.io event map on both ends.

### 16.2 Planned

* **Balance simulator:** a headless script that plays `sim.ts` with scripted strategies (idle, active miner, co-op pair) and prints time-to-milestone tables against §11.4. Runs in CI and fails on >20% drift.
* **Protocol contract tests:** a server instance plus two `socket.io-client` bots in-process, asserting join, strike broadcast, reconnect with token, and room-full.
* **Visual smoke test:** Playwright opens the client in offline mode, clicks the asteroid, and checks the ore counter increases and the canvas is non-empty.
* **CI workflow** for `npm ci && npm run typecheck && npm test`, scoped to `client/**`, `server/**`, `shared/**` paths so it never interacts with the existing deploy workflows.

---

## 17. Roadmap

| Milestone | Contents | State |
|---|---|---|
| **M0: scaffold** | Workspaces, shared rules + tests, authoritative Socket.io server, rooms + reconnect, R3F scene with clickable asteroid, emissive seams, laser, particle bursts, floaters, drones, heat, upgrade shop, live resource counter, offline fallback | **this PR** |
| **M1: persistence** | `RedisStore` + `MongoStore` adapters behind `ProgressStore`, offline gains card, time sync | next |
| **M2: refinery** | Refinery station scene and pipeline graph, power and overclocks, automated rigs, conveyors, alloy-priced automation, rig loadouts | |
| **M3: depth** | Voxel terrain with server-authoritative carving, co-op events, Quantum Leap + skill tree, `Decimal` migration | |
| **M4: live** | Pages build at `/starforge/`, hosted server, public lobby, accounts, menu card in `index.html` | needs sign-off (touches the live site) |

---

## 18. Open questions

1. **Hosting:** which provider for the Node server and the managed Redis / Mongo, and is a cost ceiling set?
2. **Shared vs. personal wallets:** the prototype uses one shared team wallet per expedition (simplest, most co-operative). Should players also have a personal stash that persists across expeditions?
3. **Solo viability:** is a 25% off-role efficiency the right solo penalty, or should solo players get a bot partner?
4. **Menu integration:** should Starforge eventually replace Deepcore on the menu, or sit beside it?
