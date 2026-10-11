# Starforge: Technical Design Specification

**Status:** v0.2, playable online co-op build. **Owner:** Lead Game Developer / Systems Architect.
**Scope:** a 3D multiplayer incremental mining game with asymmetric co-op roles, host-authoritative networking that runs on static hosting, a five-tier refinery economy, co-op events and a shared prestige layer.

This document is the source of truth for system design, network protocol and balance. Where a number appears in both this file and `shared/src/economy.ts` / `shared/src/sim.ts`, the code wins and this file should be corrected.

---

## Table of contents

1. [Product summary](#1-product-summary)
2. [Relationship to the rest of this repository](#2-relationship-to-the-rest-of-this-repository)
3. [Technology stack and decisions](#3-technology-stack-and-decisions)
4. [Repository layout, running and deploying](#4-repository-layout-running-and-deploying)
5. [Runtime architecture](#5-runtime-architecture)
6. [Network protocol](#6-network-protocol)
7. [Social layer: friends and party invites](#7-social-layer-friends-and-party-invites)
8. [3D world and rendering](#8-3d-world-and-rendering)
9. [Core mining gameplay](#9-core-mining-gameplay)
10. [Asymmetric roles](#10-asymmetric-roles)
11. [Co-op events](#11-co-op-events)
12. [Incremental economy and balance](#12-incremental-economy-and-balance)
13. [Prestige: the Galactic Quantum Leap](#13-prestige-the-galactic-quantum-leap)
14. [Persistence and offline progress](#14-persistence-and-offline-progress)
15. [Security and anti-cheat](#15-security-and-anti-cheat)
16. [Performance budgets](#16-performance-budgets)
17. [Testing and tooling](#17-testing-and-tooling)
18. [Roadmap](#18-roadmap)
19. [Open questions](#19-open-questions)

---

## 1. Product summary

Up to four players share one **expedition**: a rotating asteroid beside an orbital refinery station. **Miners** fire drill lasers at the rock and its glowing seams, riding heat for a bonus without overheating. **Refiners** press the station's machines to refine ore up a five-tier chain and spend station power on team-wide overclocks. Drones, auto-rigs and an ore stream make automation visible. Every few minutes a **co-op event** (Seismic Shockwave or Solar Flare) needs the whole team. When the team has made enough Cosmic Energy, anyone can propose a **Galactic Quantum Leap**; on a passing vote the run resets and everyone earns Quantum Points for a permanent skill tree.

Design pillars:

| Pillar | What it means in practice |
|---|---|
| **Tactile 3D clicks** | Every strike lands on a real point of a real mesh, with a laser, sparks, a scorch mark, a number and a camera kick within one frame. Feedback never waits on the network. |
| **Visible automation** | Passive income is never just a number: drones orbit and dive, rigs drill on seams, ore streams to the station, machines pulse. |
| **Roles that need each other** | A solo player can do everything, but strikes and presses in sync build a combo, events want both roles, and leaps pay more with more players. |
| **Numbers go up** | Geometric costs, milestone doublings, tier unlocks and a repeatable prestige layer. |
| **One rules implementation** | Every outcome is computed by pure functions in `/shared`, run by whoever hosts the room: a player's browser or the optional server. |

---

## 2. Relationship to the rest of this repository

This repo is an arcade of browser games (`index.html` menu plus one HTML file per game, deployed to GitHub Pages from `main`). **Deepcore** (`deepcore.html`) is a same-device co-op mining incremental; Starforge is its larger, networked successor and borrows its heat band, sync combo and event archetypes. Deepcore stays as it is.

Starforge has a build step, so it lives in `/client`, `/server` and `/shared` with its own npm workspaces, and its built output is committed to `/starforge/` (§4.3).

Starforge also plugs into the **site-wide friends list** (`js/friends.js`, §7), shared with Meat Lad, Beetdown and Alien Attack, so a friend can be invited into a Starforge party from the main menu or from inside any game.

---

## 3. Technology stack and decisions

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One type system across client, server and protocol. |
| Rendering | **Three.js + React Three Fiber** + drei + postprocessing | Declarative scene composition with imperative hot paths (`useFrame`, instancing, pooled buffers); bloom and chromatic aberration sell the glow. |
| Build | **Vite** | Fast dev server, small static output, `base: './'` for any sub-path. |
| Client state | **Zustand** | The store is a replica written by one authority; selector subscriptions keep the Canvas from re-rendering. Transient FX bypass the store (§5.4). |
| Networking (live site) | **PeerJS / WebRTC data channels**, host-authoritative | GitHub Pages cannot run a server. The hosting player's browser runs the authoritative `RoomHost`; guests send intents. Same model the site's other multiplayer games use, and the same PeerJS cloud signalling. |
| Networking (optional) | **Socket.io 4** dedicated server | Wraps the same `RoomHost`. Used when a build sets `VITE_SERVER_URL`; this is the path to public lobbies and server-side persistence later. |
| Tests | `node:test` via `tsx`, plus Playwright end-to-end in development | Pure rules need nothing more. |

**Why host-authoritative P2P instead of "server or nothing":** v0.1 rejected WebRTC because peer-hosted state cannot be trusted. That is still true against a malicious host, but in a friends-only co-op game the host is a friend, and the alternative was single-player only on the live site. The rules are written once and transport-agnostic (`RoomHost`), so moving a room to the dedicated server needs no rules changes.

---

## 4. Repository layout, running and deploying

### 4.1 Layout

```
/DESIGN.md
/package.json              npm workspaces: shared, server, client
/shared/                   @starforge/shared: the rules. Pure, isomorphic, no I/O.
  src/resources.ts         resource tiers, colours, ratios
  src/economy.ts           upgrades, unlocks, machines, skills, overclocks, curves, prestige, offline
  src/asteroid.ts          seeded PRNG + deterministic asteroid surface
  src/sim.ts               RoomState and every rule: strikes, presses, shop, events, votes, tick
  src/host.ts              RoomHost: one authoritative room, transport-agnostic
  src/protocol.ts          wire messages (Hello, ClientMsg, ServerMsg, Fx), PROTOCOL_VERSION
  src/save.ts              save format, load with migration defaults, offline simulation
  src/economy.test.ts      unit tests
  scripts/balance.ts       headless pacing bot
/server/                   optional dedicated host (Socket.io), wraps RoomHost
/client/                   Vite + React + R3F
  src/net/session.ts       solo / host (PeerJS) / guest (PeerJS) / server (Socket.io) sessions, saving
  src/net/dispatch.ts      applies host messages to the store and turns Fx into effects and toasts
  src/net/actions.ts       every player intent (strike, press, buy, overclock, vote…)
  src/state/               Zustand store, FX bus, shared world-space refs
  src/scene/               3D scene: sky, asteroid, seams, rigs, drones, station, ships, events, effects
  src/ui/                  lobby, HUD, tabs, events, votes, friends hook-up
/starforge/                committed production build served by GitHub Pages
/js/friends.js             site-wide friends list and party invites (§7)
```

### 4.2 Running locally

```bash
npm install
npm run dev:client   # http://localhost:5173 — solo, host and join all work in the browser
npm test             # shared rules tests
npm run typecheck    # all three packages
npm run balance      # pacing bot (optional hours argument)
npm run dev          # also starts the optional Socket.io server on :3001
```

Open the client, press **Host a party**, then open the printed `?join=CODE` link in a second browser or window. Signalling goes through the public PeerJS cloud; `?peer=host:port` (or `VITE_PEER_HOST` at build time) points it at a self-hosted PeerServer instead.

### 4.3 Publishing

```bash
npm run build:site   # builds client/ into /starforge (index.html + assets/)
```

The build is committed, so GitHub Pages serves it at `<site>/starforge/` with no workflow changes. Multiplayer works on the live site out of the box through PeerJS. Building with `VITE_SERVER_URL=https://…` switches Host/Join to the dedicated server.

---

## 5. Runtime architecture

### 5.1 Authority model

```
 guest browser                         host browser (or the dedicated server)
 ┌──────────────┐  intents (ClientMsg)  ┌─────────────────────────────────────┐
 │ store replica│ ────────────────────► │ RoomHost                            │
 │ scene + HUD  │ ◄──────────────────── │   handle(): applyStrike, applyPress,│
 └──────────────┘  snap 10 Hz + fx      │   buyUpgrade, overclock, votes…     │
                                        │   tick() 20 Hz: tickRoom()           │
 host's own UI ◄── same messages ────── │   save to localStorage every 10 s   │
                                        └─────────────────────────────────────┘
```

* Clients send **intents only** (`{t:'strike', seq, seamId}`), never amounts or rolls. The host owns all randomness.
* `RoomHost` takes a `send(to, msg)` callback, so the PeerJS host, the Socket.io server and solo play all wrap the same class. Solo is simply a host with no peers.
* The host's own UI receives the same `welcome` / `snap` / `fx` messages as guests (deep-cloned), so there is a single client code path.

### 5.2 Host loop

| Loop | Rate | Work |
|---|---|---|
| Simulation | 20 Hz | `tickRoom`: drones, rigs, refinery, heat, power, combo decay, events, votes, smoothed rates. Background tabs are throttled by the browser, so the host catches up in 1 s steps (up to 5 min) when its timer fires late. |
| Snapshot | 10 Hz + immediately after purchases, role changes and votes | full `RoomState` (~3 KB JSON with four players) |
| Fx | after every intent and tick | batched `Fx[]`: strikes, presses, buys, joins, event notes… |
| Save | every 10 s, on tab hide and on page hide | `localStorage['starforge_save_v2']` |

### 5.3 Client replica and prediction

* **Counters** interpolate `wallet + rates × (now − snapAt)` between snapshots.
* **Strikes** fire the laser immediately and remember `{seq → point, normal}`; the host's `strike` fx with the same `seq` plays the burst, scorch, floater and shake at that exact point. The ore counter, heat and seam HP are patched from the fx so the HUD reacts before the next snapshot.
* **Other players' strikes** are drawn from their ship to the struck seam or node, transformed through the rock's current matrix (`rockPoint`).
* **Clock skew:** event, buff, vote and overheat deadlines are host-epoch. The client keeps `skew = state.now − Date.now()` (smoothed) and compares deadlines against `hostNow()`.

### 5.4 Two kinds of client state

| Kind | Where | Examples | Re-renders React? |
|---|---|---|---|
| Replicated game state | `state/store.ts` | the RoomState replica, session, tab, toasts | Yes, via selectors |
| Transient effects | `state/fx.ts` | laser, burst, scorch, float, shake, press, shockwave, leap | No; scene components animate in `useFrame` |

---

## 6. Network protocol

### 6.1 Transports

* **PeerJS** (default): the host registers peer id `starforge-v2-<CODE>` (`PEER_PREFIX`); guests `peer.connect()` to it with JSON serialization on a reliable, ordered data channel. Codes are 5 characters from a 32-symbol alphabet with no 0/O/1/I; on an id collision the host picks a new code.
* **Socket.io** (optional): one `hello` event (with an optional `room`), then `msg` events both ways carrying the same `ClientMsg` / `ServerMsg` shapes.

`PROTOCOL_VERSION` is `2`; a mismatch is refused with `protocol-mismatch` and the guest is told to reload.

### 6.2 Handshake

```
guest                                         host
  │ connect (WebRTC or ws)                      │
  │ hello {protocol, name, role, resume?} ────► │ validate version and capacity (4)
  │                                             │ resume token known? reclaim slot : new player
  │ ◄──── welcome {playerId, resume, code, state}│
  │ ◄──── fx [joined]  (to everyone)            │
```

* **Reconnect:** guests keep the resume token in `sessionStorage` per party code and retry three times with backoff, reclaiming the same player.
* **Host leaves:** a deliberate close sends `error: host-left`; a dropped host is detected by the channel closing. Guests return to the lobby with the reason and can continue solo.
* **Errors:** `protocol-mismatch`, `room-full`, `room-not-found` (server only), `host-left`.

### 6.3 Messages

Client → host (`ClientMsg`): `strike {seq, seamId|null, nodeId|null}`, `press {seq, machine}`, `buy {id, count?}`, `skill {id}`, `toggle {machine, on}`, `overclock {id}`, `role {role}`, `stabilize`, `shield`, `leap`, `vote {yes}`, `emote {id}`.

Host → client (`ServerMsg`): `welcome`, `snap {state}`, `fx {fx: Fx[]}`, `error {error}`.

`Fx` kinds: `strike`, `press`, `stabilize`, `shield`, `overclock`, `buy`, `skill`, `reject`, `joined`, `left`, `vote`, `emote`, and `note` wrapping tick notes (`eventStart`, `eventEnd`, `leap`, `voteFailed`).

### 6.4 Bandwidth

A snapshot is ~3 KB; at 10 Hz to three guests that is ~90 KB/s from the host, well within a home upload. The PeerJS JSON channel caps a single message at 16 KB, which a full four-player state stays far below. Delta snapshots are the next step if rooms grow.

---

## 7. Social layer: friends and party invites

`js/friends.js` is one script shared by the main menu and every multiplayer game (Meat Lad, Beetdown, Alien Attack, Starforge). It uses the Firebase account the site already has, and stores everything on the player's existing `accounts/{uid}` document so it works under the existing Firestore rules:

| Field | Contents |
|---|---|
| `friends` | array of friend emails (the same array Beetdown and Meat Lad already use) |
| `presence` | `{ts, game, name, party}` heartbeat every 30 s; a friend is online if seen < 75 s ago |
| `partyInbox` | invites `{id, from, fromName, game, code, ts}`, valid for 10 minutes |

* **Main menu:** `MLFriends.menu()` shows a side panel with **Add friend** (by username or email), each friend's status ("playing Starforge", "in a Starforge party" with a **Join** button, "online · on the menu", "offline · seen 5m ago") and incoming invites.
* **In a game:** `MLFriends.attach({game, party, join, dock})`. While the player has a party open, a mini list shows friends with online dots and **Invite** buttons. An invite pops up for the friend wherever they are on the site; **Join** either calls the game's `join(code)` (same game) or navigates to `<game>/?join=CODE`.
* **Starforge** reports its party code while hosting or joined, docks the mini list bottom-left, and handles `?join=CODE` by joining as a guest. The lobby pre-fills the player name from the site username.

---

## 8. 3D world and rendering

### 8.1 Scene

* **Sky:** a drifting fbm-noise nebula sphere, stars, and a distant sun that drives the key light. During a Solar Flare the sun swings to the flare direction, swells and turns orange.
* **Asteroid:** a displaced icosphere from the shared `surfaceRadius`, layered vertex colours, a fresnel heat-glow shell that follows the local miner's heat (and flickers on overheat), pooled scorch decals that cool from orange to black, a squash "thunk" on hits, and a cyan rim while the Resonance buff runs.
* **Seams:** emissive crystal clusters that shrink with HP; generous invisible hit spheres for touch.
* **Station:** a hub, rotating ring and four machine modules tinted with their output colour. Unbuilt machines are wireframe ghosts; built ones pulse with production and punch on every press. An ore stream arcs from the rock to the smelter.
* **Automation:** instanced drones that orbit and dive with beams (faster under Drone Surge, dark and sparking when fried), and drill rigs standing on seams.
* **Players:** each teammate has a ship in their colour parked in orbit, with a name tag, role icon and emote bubbles. Their lasers fire from their ship.
* **Events:** quake nodes (unstable red, primed cyan, locked green with a light pillar), periodic shockwave rings and camera rumble; a flare shield bubble whose strength follows the team shield, with flare streaks raining in.
* **Post:** bloom, chromatic aberration that spikes on shockwaves, overclocks and leaps, vignette and subtle noise. A Quantum Leap plays a warp (FOV punch and star streaks) under a white flash.

### 8.2 The asteroid surface

`surfaceRadius(direction, seed)` is a base radius of 2.2 modulated by nine seeded sinusoidal lobes. Seams and quake nodes are sent as unit directions only; every client places them on the same visible surface.

### 8.3 Destructible terrain (later)

A chunked signed-distance voxel field with surface-nets meshing in a worker, host-authoritative carve events, and ore richness as a second channel remains the plan for a later milestone (§18).

---

## 9. Core mining gameplay

| Action | Rule |
|---|---|
| Strike | `strikeBase = (1 + drillBit) × 2^floor(drillBit/25) × (1 + 0.5 × ancestralBits) × 2^seismic × quantumMult` |
| Seam | ×3; the seam loses 1 HP (2 on a crit). Seams have 8 HP; five are on the rock (+1 per Seam Sense). |
| Crack a seam | ×4 jackpot on the final hit; a new seam spawns elsewhere |
| Crit | `min(60%, 5% + 1% × focusLens (+20% Focus Field))`, ×5 |
| Hot drill | heat ≥ `70 − 5 × thermalMastery`: ×2 |
| Heat | +`7 × 0.93^coolant` per strike, vents `18 × (1 + 0.1 × coolant)`/s; at 100 the drill locks for 2 s |
| Sync combo | a strike and a press within 600 ms add +0.1 to the team combo (max `2 + 0.25 × resonantBond`), held 3 s then decaying; it multiplies strikes and presses |
| Rate limit | 20 strikes/s per player, 12.5 presses/s |

**Automation:** Orbital Drones give 0.6 ore/s each (×2 per 25 levels, ×2 per Seismic Charge). Auto Rigs strike seams twice a second at half a seam strike, wearing seams down and earning their jackpots.

---

## 10. Asymmetric roles

Roles are a soft specialisation: anyone can do anything, the camera and default tab follow the role, and players switch any time from the HUD.

* **Miner:** camera on the asteroid; strikes, heat management, quake nodes.
* **Refiner:** camera on the station; presses machines (keys 1–4) for burst output, toggles machines to manage the chain, fires overclocks, and stabilizes quake nodes.

**Refinery:**

| Machine | Input → output | Rate per level | Unlocks after making |
|---|---|---|---|
| Smelter | 10 ore → 1 alloy | 1/s | 2,500 ore |
| Plasma Infuser | 25 alloy → 1 plasma | 0.2/s | 6,000 alloy |
| Dark Compressor | 50 plasma → 1 dark matter | 0.04/s | 1,500 plasma |
| Cosmic Condenser | 100 dark matter → 1 cosmic energy | 0.01/s | 250 dark matter |

Machines process top tier first each tick so a unit is never refined twice. A press yields the machine's base rate × (1 + Hydraulic Press levels) × combo and adds power. A machine must be built before it can be pressed.

**Power and overclocks:** power regenerates at `(0.4 + 0.6 × reactor) × (1 + 0.25 × gridSurplus)`/s plus 1 per press, up to `100 + 25 × reactor`.

| Overclock | Effect | Duration | Cost |
|---|---|---|---|
| Thermal Dump | every miner to 0 heat, unlocks overheated drills | instant | 25 |
| Focus Field | +20% crit for the team | 15 s | 40 |
| Drone Surge | drones ×3 | 15 s | 50 |
| Hyperdrive | every strike ×2 | 10 s | 70 |

---

## 11. Co-op events

Events start once a Smelter exists, every 3.5 to 6 minutes, never during a vote, and only while someone is online.

### 11.1 Seismic Shockwave (25 s)

Three resonance nodes appear on the rock. A miner's strike **primes** a node for 2.5 s; a **Stabilize** press while it is primed locks it. Lock all three to win: every seam refills and ore is ×3 for 30 s. Fail: the quake shakes loose 10% of banked ore and jams every drill for 3 s.

### 11.2 Solar Flare (22 s)

The team shield starts at 60 and drains 7/s; every **Shield** press adds 8, and heat per strike doubles. Keep it above zero until the flare passes: +30 s of plasma income (at least 3) and the refinery runs ×2 for 30 s. Fail: drones are offline for 20 s.

Event Horizon multiplies reward durations and amounts by `1 + 0.5 × level`. All judgement is on the host.

---

## 12. Incremental economy and balance

### 12.1 Resource chain

| Tier | Resource | Produced by | Ratio | Colour |
|---|---|---|---|---|
| 1 | Raw Ore | strikes, drones, rigs | n/a | `#ffb03a` |
| 2 | Refined Alloy | Smelter | 10 ore | `#cfd6e6` |
| 3 | Exotic Plasma | Plasma Infuser | 25 alloy | `#4de8ff` |
| 4 | Dark Matter | Dark Compressor | 50 plasma | `#b07cff` |
| 5 | Cosmic Energy | Cosmic Condenser | 100 dark matter | `#ffe28a` |

### 12.2 Upgrades

`cost(n) = ceil(base × growth^n)`; the HUD offers single and bulk buys (up to 100 at once, `bulkCost` closed form).

| Upgrade | Currency | Base | Growth | Max | Unlock |
|---|---|---|---|---|---|
| Drill Bit | ore | 10 | 1.18 | | |
| Focus Lens | ore | 50 | 1.32 | 40 | |
| Orbital Drone | ore | 25 | 1.16 | | |
| Coolant Loop | alloy | 4 | 1.7 | 12 | 1 alloy |
| Auto Rig | alloy | 25 | 1.4 | 16 | 20 alloy |
| Seismic Charge (×2 all ore) | plasma | 40 | 5 | | 20 plasma |
| Smelter | ore | 600 | 1.2 | | 2,500 ore |
| Plasma Infuser | alloy | 1,000 | 1.25 | | 6,000 alloy |
| Dark Compressor | plasma | 400 | 1.3 | | 1,500 plasma |
| Cosmic Condenser | dark matter | 30 | 1.4 | | 250 dark matter |
| Hydraulic Press | alloy | 15 | 1.7 | 20 | 10 alloy |
| Fusion Reactor | alloy | 30 | 1.55 | 12 | 60 alloy |

Unlocks count what the team **made this run** (`run.made`), so each tier opens as a visible milestone and hides clutter early on. Producers double every 25 levels (`milestoneMult`), giving the classic sawtooth.

### 12.3 Pacing

`npm run balance` plays a greedy bot that strikes seams 4×/s, stays under overheat, presses twice a second and buys everything it can. First run, solo, measured:

| Milestone | Bot time | Target for a human co-op pair |
|---|---|---|
| Smelter / first alloy | ~0:11 | 1 to 2 min |
| First plasma | ~3 min | 5 to 10 min |
| First dark matter | ~10 min | 15 to 25 min |
| First cosmic energy | ~39 min | ~40 to 60 min |
| Leap available (10 CE) | ~1 h 43 min | 1.5 to 2.5 h |

The bot clicks faster than people do, so humans land later; the sync combo and events let a coordinated party beat the bot.

---

## 13. Prestige: the Galactic Quantum Leap

* **Unlock:** 10 Cosmic Energy made this run (`LEAP_THRESHOLD`).
* **Vote:** anyone proposes; it passes as soon as every connected player says yes, or by majority when the 15 s timer ends. Solo, it is instant.
* **Reward:** `QP = floor(sqrt(runCE / 10) × (1 + 0.1 × (players − 1)))`. Square-root scaling rewards longer runs with diminishing returns; a full party earns +30%.
* **Passive:** every unspent QP is +5% to everything (`quantumMult`).
* **Resets** wallet, levels, power, seams and the asteroid seed. **Keeps** QP, skills, lifetime stats, event record.

| Branch | Nodes (cost, max) |
|---|---|
| Excavation | Ancestral Bits +50% strike and rig ore (1, 10) · Thermal Mastery hot band 5 lower (2, 4) · Seam Sense +1 seam (3, 3) |
| Industry | Furnace Soul +50% refinery (1, 10) · Grid Surplus +25% power (1, 5) · Head Start 500 ore + 50 alloy per run (1, 5) |
| Resonance | Resonant Bond +0.25 max combo (2, 4) · Event Horizon +50% event rewards (2, 3) · Shared Wake +10% offline (1, 5) |

---

## 14. Persistence and offline progress

* **Where:** the host's browser saves its expedition to `localStorage` (`starforge_save_v2`): wallet, levels, skills, QP, seams, run and lifetime stats. Players, votes and live events are session-only. A guest plays in the host's world and keeps their own solo save untouched.
* **Migrations:** `fromSave` rebuilds a state from `createRoomState` defaults and overlays the save, so fields added later get sane values. The `v` field gates breaking changes.
* **Offline gains:** on load, `applyOffline` runs the real passive economy (drones, rigs, machines) in 10 s steps for `min(away, 8 h) × (50% + 10% × sharedWake)` and shows a "welcome back" card with the gains per resource.
* **Dedicated server:** `ProgressStore` (`MemoryStore` today) saves rooms every 30 s and on close, using the same save format, and can reload a room by code. Redis and MongoDB adapters slot in behind that interface.

---

## 15. Security and anti-cheat

* **Intents only;** the host validates every payload (unknown ids rejected with `Object.hasOwn`, numbers checked, names clipped to 16 characters) and enforces rate limits inside the rules.
* **Trust model:** in P2P mode the host is trusted. That is acceptable for friends-only co-op; anything competitive (public lobbies, leaderboards) must run on the dedicated server.
* **Resume tokens** are random per join and never derived from player ids.
* `?sfdebug` exposes the local room to automated tests; it only affects a room the player already hosts and could edit through its save anyway.

---

## 16. Performance budgets

| Budget | Target | How |
|---|---|---|
| Frame rate | 60 fps on a mid-range laptop, 45+ on a recent phone | dpr ≤ 1.75, mipmap bloom, no shadows |
| Draw calls | < 80 | instanced drones, rigs, decals; one particle cloud |
| Particles | ~4,000 pooled | ring buffer, no per-burst allocation |
| GC | no allocations in `useFrame` hot paths | reused vectors and matrices |
| Input → feedback | < 16 ms | laser and prediction are local; only yield waits on the host |
| Host tick | < 1 ms | pure functions, no I/O |

---

## 17. Testing and tooling

* `npm test`: node:test over cost curves, unlocks, prestige and voting, offline gains, the asteroid, strikes, crits, seams, overheat, drones, presses, machines, combo, overclocks, both events, saving, and `RoomHost` (join, intents, broadcasts, reconnect, version and capacity checks).
* `npm run typecheck`: strict TypeScript for all packages.
* `npm run balance`: pacing bot (§12.3).
* **End to end (development):** a Playwright script runs a local PeerServer and a faked Firebase, has one player host from the lobby, a friend join through the main menu's friends list, and checks strikes, refiner presses, a flare, a quake, a leap vote and leaving, with screenshots on desktop and phone.

---

## 18. Roadmap

| Milestone | Contents | State |
|---|---|---|
| M0 scaffold | workspaces, rules, R3F scene, offline play | done |
| M1 co-op | refinery tiers and machines, power and overclocks, events, Quantum Leap and skills, host-authoritative PeerJS multiplayer on the live site, saves and offline gains, friends list and invites | **this version** |
| M2 depth | rig loadouts, conveyor routing graph, more event types and mini-bosses, achievements | next |
| M3 scale | dedicated hosting with Redis/Mongo, public lobbies, cloud saves on the site account, `Decimal` numbers, voxel terrain | |

---

## 19. Open questions

1. **Cloud saves:** mirror the expedition to the site account (`games.starforge`) so progress follows the player across devices?
2. **Host migration:** when a host leaves, should the most active guest inherit the room (state is already on every client) instead of everyone returning to the lobby?
3. **Solo balance:** solo players can sync-combo alone by alternating strikes and presses; is that too strong compared with a real pair?
