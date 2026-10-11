# Starforge: Technical Design Specification

**Status:** v0.3, co-op redesign: one shared Forge Tree, no roles. **Owner:** Lead Game Developer / Systems Architect.
**Scope:** a 3D multiplayer incremental mining game in which a crew of up to four taps one asteroid, buys personal upgrades and pays together into a shared Forge Tree, with host-authoritative networking that runs on static hosting, comets and surges that pay the whole crew, and a personal prestige layer.

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
8. [3D world, rendering and HUD](#8-3d-world-rendering-and-hud)
9. [Core mining gameplay](#9-core-mining-gameplay)
10. [The Forge Tree](#10-the-forge-tree)
11. [Comets and surges](#11-comets-and-surges)
12. [Incremental economy and balance](#12-incremental-economy-and-balance)
13. [Prestige: the Quantum Leap](#13-prestige-the-quantum-leap)
14. [Persistence and offline progress](#14-persistence-and-offline-progress)
15. [Security and anti-cheat](#15-security-and-anti-cheat)
16. [Performance budgets](#16-performance-budgets)
17. [Testing and tooling](#17-testing-and-tooling)
18. [Roadmap](#18-roadmap)
19. [Open questions](#19-open-questions)

---

## 1. Product summary

Up to four players share one **world**: a rotating asteroid with glowing seams. Everyone plays the same game. You tap the rock (seams pay more and break for a bonus), buy your own upgrades from your own wallet, and put ore, alloy and Star Cores into the **Forge Tree**, 20 nodes the whole crew pays for together. A node unlocks for everyone once it is fully paid, and its upgrades and multipliers stay for good. Every couple of minutes a **comet** streaks past and pays the whole crew when someone taps it. Late in the tree each player can take a **Quantum Leap** on their own, restarting their run for Star Cores. Crewmates who join a host's world keep their progress there and get it back, plus offline earnings, when they return. The HUD is built for phones first: a slim top bar and three tabs in a bottom sheet.

Design pillars:

| Pillar | What it means in practice |
|---|---|
| **Tactile 3D taps** | Every tap lands on a real point of a real mesh, with a laser, sparks, a scorch mark, a number and a camera kick within one frame. Feedback never waits on the network. |
| **Visible automation** | Passive income is never just a number: drones and harvesters orbit and dive, rigs drill on seams. |
| **One game, shared goals** | No roles. Everyone taps, upgrades and leaps with their own wallet; the crew builds one tree, comets pay everyone, and Crew Link and Resonance pay more when more people play at once. A solo player can do everything. |
| **Spend with intent** | Tree nodes cost real saving, and every contribution is ore that did not go into your own upgrades. The node page says how long the rest would take, so players talk before they spend. |
| **Numbers go up** | Geometric costs, 25-level doublings, tree multipliers and a repeatable personal prestige. |
| **One rules implementation** | Every outcome is computed by pure functions in `/shared`, run by whoever hosts the room: a player's browser or the optional server. |

---

## 2. Relationship to the rest of this repository

This repo is an arcade of browser games (`index.html` menu plus one HTML file per game, deployed to GitHub Pages from `main`). **Deepcore** (`deepcore.html`) is a same-device co-op mining incremental; Starforge is its larger, networked successor. Deepcore stays as it is.

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
  src/resources.ts         the three resources (ore, alloy, Star Cores) and their colours
  src/economy.ts           upgrades, Forge Tree nodes, cost curves, tap/comet/surge/leap/offline constants
  src/asteroid.ts          seeded PRNG + deterministic asteroid surface
  src/sim.ts               RoomState and every rule: taps, upgrades, tree funding, leaps, comets, tick
  src/host.ts              RoomHost: one authoritative room, transport-agnostic
  src/protocol.ts          wire messages (Hello, ClientMsg, ServerMsg, Fx), PROTOCOL_VERSION
  src/save.ts              save format, load with defaults for missing fields
  src/economy.test.ts      unit tests
  scripts/balance.ts       headless pacing bot
/server/                   optional dedicated host (Socket.io), wraps RoomHost
/client/                   Vite + React + R3F
  src/net/session.ts       solo / host (PeerJS) / guest (PeerJS) / server (Socket.io) sessions, saving
  src/net/dispatch.ts      applies host messages to the store and turns Fx into effects and toasts
  src/net/actions.ts       every player intent (strike, buy, fund, leap, comet, emote)
  src/state/               Zustand store, FX bus, shared world-space refs
  src/scene/               3D scene: sky, asteroid, seams, rigs, drones, ships, comet, effects
  src/ui/                  lobby, HUD (top bar; Upgrades, Forge Tree and Crew tabs), friends hook-up
/starforge/                committed production build served by GitHub Pages
/js/friends.js             site-wide friends list and party invites (§7)
```

### 4.2 Running locally

```bash
npm install
npm run dev:client   # http://localhost:5173 — solo, host and join all work in the browser
npm test             # shared rules tests
npm run typecheck    # all three packages
npm run balance      # pacing bot (HOURS, LEAPS, TAPS, SAVE_FOR env vars)
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
 │ scene + HUD  │ ◄──────────────────── │   handle(): applyStrike, buyUpgrade,│
 └──────────────┘  snap 10 Hz + fx      │   fundNode, leap, catchComet        │
                                        │   tick() 20 Hz: tickRoom()          │
 host's own UI ◄── same messages ────── │   save to localStorage every 10 s   │
                                        └─────────────────────────────────────┘
```

* Clients send **intents only** (`{t:'strike', seq, seamId}`), never outcomes or rolls. A `fund` names how much the player wants to put in; the host clamps it to what is owed and what they hold. The host owns all randomness.
* `RoomHost` takes a `send(to, msg)` callback, so the PeerJS host, the Socket.io server and solo play all wrap the same class. Solo is simply a host with no peers.
* The host's own UI receives the same `welcome` / `snap` / `fx` messages as guests (deep-cloned), so there is a single client code path.

### 5.2 Host loop

| Loop | Rate | Work |
|---|---|---|
| Simulation | 20 Hz | `tickRoom`: drones, harvesters and rigs of online players, smoothed rates, surge end, comet spawn and expiry. Background tabs are throttled by the browser, so the host catches up in 1 s steps (up to 5 min) when its timer fires late. |
| Snapshot | 10 Hz + immediately after purchases, funding, leaps and comet catches | full `RoomState` (~4 KB JSON with four players) |
| Fx | after every intent and tick | batched `Fx[]`: strikes, buys, funding, comets, joins, notes… |
| Save | every 10 s, on tab hide and on page hide | `localStorage['starforge_save_v3']` |

### 5.3 Client replica and prediction

* **Counters** interpolate `wallet + rates × (now − snapAt)` between snapshots.
* **Strikes** fire the laser immediately and remember `{seq → point, normal}`; the host's `strike` fx with the same `seq` plays the burst, scorch, floater and shake at that exact point. The ore counter and seam HP are patched from the fx so the HUD reacts before the next snapshot.
* **Other players' strikes** are drawn from their ship to the struck seam (or a random point on the rock for a plain tap), transformed through the rock's current matrix (`rockPoint`).
* **Clock skew:** surge and comet deadlines are host-epoch. The client keeps `skew = state.now − Date.now()` (smoothed) and compares deadlines against `hostNow()`.

### 5.4 Two kinds of client state

| Kind | Where | Examples | Re-renders React? |
|---|---|---|---|
| Replicated game state | `state/store.ts` | the RoomState replica, session, tab, sheet, open node, buy mode, toasts | Yes, via selectors |
| Transient effects | `state/fx.ts` | laser, burst, scorch, float, shake, shockwave, flash, comet caught, leap | No; scene components animate in `useFrame` |

---

## 6. Network protocol

### 6.1 Transports

* **PeerJS** (default): the host registers peer id `starforge-v3-<CODE>` (`PEER_PREFIX`); guests `peer.connect()` to it with JSON serialization on a reliable, ordered data channel. Codes are 5 characters from a 32-symbol alphabet with no 0/O/1/I; on an id collision the host picks a new code.
* **Socket.io** (optional): one `hello` event (with an optional `room`), then `msg` events both ways carrying the same `ClientMsg` / `ServerMsg` shapes.

`PROTOCOL_VERSION` is `3`; a mismatch is refused with `protocol-mismatch` and the guest is told to reload.

### 6.2 Handshake

```
guest                                         host
  │ connect (WebRTC or ws)                      │
  │ hello {protocol, name, key, tab} ─────────► │ validate version
  │                                             │ key online from another tab? derive a new key
  │                                             │ 4 online and this key isn't one? room-full
  │                                             │ known key? same player + offline pay : new player
  │ ◄──── welcome {playerId, code, state}       │
  │ ◄──── fx [joined, offline?]  (to everyone)  │
```

* **Identity:** `key` is stable per browser (`localStorage['starforge_key']`, 16 random characters) and `tab` is random per tab (`sessionStorage`). The host matches the key against every crewmate the world has saved, online or not, so there is no resume token.
* **Second tab:** if the key's player is already online from a different tab, `RoomHost.join` uses `key[0..27] + '~' + tab` instead, so the second tab plays as its own crewmate (and is saved under that key). A reconnecting tab sends the same tab id and reclaims its player.
* **Room full:** at most 4 players online (`MAX_PLAYERS_PER_ROOM`). A player who is still online (a reconnect) is always readmitted; anyone else is refused while four are online. The world remembers up to 16 crewmates (`MAX_SAVED_PLAYERS`) and forgets the longest-absent beyond that.
* **Reconnect:** guests retry three times with backoff (1, 2, 3 s); the same key and tab reclaim the same player.
* **Host leaves:** a deliberate close sends `error: host-left`; a dropped host is detected by the channel closing. Guests return to the lobby with the reason and can continue solo.
* **Errors:** `protocol-mismatch`, `room-full`, `room-not-found` (server only), `host-left`.

### 6.3 Messages

Client → host (`ClientMsg`): `hello {protocol, name, key, tab?}`, `strike {seq, seamId|null}`, `buy {id, count?}` (1 to 1000 levels, as far as the wallet goes), `fund {node, res, amount}`, `leap`, `comet {id}`, `emote {id}`, and `ping {id}` (declared; `RoomHost` ignores it).

Host → client (`ServerMsg`): `welcome {playerId, code, state}`, `snap {state}`, `fx {fx: Fx[]}`, `error {error}`.

`Fx` kinds: `strike`, `buy`, `fund`, `leap`, `comet`, `offline`, `reject`, `joined`, `left`, `emote`, and `note` wrapping tick notes (`comet`, `cometGone`, `surgeEnd`).

### 6.4 Bandwidth

A snapshot is ~4 KB with four players online; at 10 Hz to three guests that is ~120 KB/s from the host, well within a home upload. Each absent crewmate the world remembers adds ~0.4 KB, so a full 16-player roster is ~9 KB, still under the 16 KB the PeerJS JSON channel allows per message. Delta snapshots (or leaving absent crewmates out) are the next step if rooms grow.

---

## 7. Social layer: friends and party invites

`js/friends.js` is one script shared by the main menu and every multiplayer game (Meat Lad, Beetdown, Alien Attack, Starforge). It uses the Firebase account the site already has, and stores everything on the player's existing `accounts/{uid}` document so it works under the existing Firestore rules:

| Field | Contents |
|---|---|
| `friends` | array of friend emails (the same array Beetdown and Meat Lad already use) |
| `presence` | `{ts, game, name, party}` heartbeat every 30 s; a friend is online if seen < 75 s ago |
| `partyInbox` | invites `{id, from, fromName, game, code, ts}`, valid for 10 minutes |
| `friendRequests` | incoming `{id, type, from, uid, name, ts}`; `type` is `req` (a request) or `ok`/`no` (the answer to one this player sent) |
| `sentRequests` | own outgoing requests `{id, to, uid, name, ts, req}` |
| `username` | current username (mirrors `usernames/{name}`) |
| `avatar` | profile picture, a ~128 px JPEG data URL under 30 KB |

* **Friend requests:** **Add friend** writes a `req` into the other player's `friendRequests` and records it in the sender's `sentRequests`. Accepting adds the sender to your own `friends` and writes an `ok` with the same id back; the sender's page adds you only if that id matches one of its `sentRequests`, so nobody can add themselves to a list. Other players may only write `partyInbox` and `friendRequests`.
* **Profile card (main menu):** picture upload (cropped and re-encoded client-side), change username (3-20 of `a-z 0-9 _`; creates the new `usernames` doc, then deletes the old one), per-game stats from `accounts.games`, `quackpot/{uid}` and Starforge's local save, and 24 achievement badges computed from them.

* **Main menu:** `MLFriends.menu()` shows a side panel with **Add friend** (by username or email), each friend's status ("playing Starforge", "in a Starforge party" with a **Join** button, "online · on the menu", "offline · seen 5m ago") and incoming invites.
* **In a game:** `MLFriends.attach({game, party, join, dock})`. While the player has a party open, a mini list shows friends with online dots and **Invite** buttons. An invite pops up for the friend wherever they are on the site; **Join** either calls the game's `join(code)` (same game) or navigates to `<game>/?join=CODE`.
* **Starforge** reports its party code while hosting or joined, docks the mini list bottom-left (hidden on phones while the bottom sheet is open), and handles `?join=CODE` by joining as a guest. The lobby pre-fills the player name from the site username.

---

## 8. 3D world, rendering and HUD

### 8.1 Scene

The scene is being reworked alongside v0.3; this list says what is in it, and the components in `client/src/scene` are the reference for details.

* **Sky:** a drifting nebula sphere, stars, and a distant sun that drives the key light.
* **Asteroid:** a displaced icosphere from the shared `surfaceRadius`, layered vertex colours, pooled scorch decals, a squash "thunk" on hits, and a glow while a Resonance surge runs.
* **Seams:** emissive crystal clusters that shrink with HP; generous invisible hit spheres for touch.
* **Automation:** instanced drones and harvesters of every online player in their owner's colour, orbiting and diving with beams, and Auto-Rigs standing on seams.
* **Players:** each crewmate has a ship in their colour beside the rock, with a name tag and emote bubbles. Their lasers fire from their ship.
* **Comet:** streaks across the part of the screen the HUD leaves visible (§11.1); tapping it catches it.
* **Feedback:** pooled particles, floating numbers, shockwave rings and flashes (node unlocks, surges, comet catches), camera shake.
* **Post:** bloom, chromatic aberration, vignette and subtle noise. A Quantum Leap plays a warp (FOV punch and star streaks).

The camera keeps the rock centred in the visible area: below the top bar, left of the side panel on wide screens, above the tab bar or open sheet on phones. v0.2's refinery station, ore streams, flare shield and quake nodes are gone.

### 8.2 The asteroid surface

`surfaceRadius(direction, seed)` is a base radius of 2.2 modulated by nine seeded sinusoidal lobes. Seams are sent as unit directions only; every client places them on the same visible surface.

### 8.3 HUD

* **Top bar** (every screen): ore and ore/s; alloy once Smelting is unlocked or you hold some; Star Cores once you hold any; a surge chip (⚡ ×2 and seconds left); "Reconnecting…" when the link drops; and a crew pill (a dot per online crewmate, "Solo" or "n/4") that opens the Crew tab.
* **Tabs:** Upgrades, Forge Tree, Crew. On phones they sit in a bottom tab bar and open a bottom sheet over 52% of the screen (tap the tab again to close it). At ≥ 900 px the same content is a 380 px side panel on the right. A dot on a tab means something is affordable: an upgrade, or a node you could finish by yourself.
* **Upgrades tab:** ×1 / ×10 / Max buy modes and one row per unlocked upgrade, showing what it does for you right now. Upgrades whose node can be funded appear as locked rows that link to the node; the rest stay hidden. Once the Quantum Leap node is unlocked, a leap card shows this run's ore, the next core and a two-tap leap button.
* **Forge Tree tab:** see §10.
* **Crew tab:** party code, copy invite link and close party (host); leave and play solo (guest); open a party or join by code (solo). Then the online crew with each one's ore/s and cores, a note on absent crewmates, emotes (in a party), your stats, how to play, the changelog, and **Reset my world** (two taps; solo or host only).
* **Overlays:** toasts, one hint at a time for new players (tap, buy a Drill Laser, fund the Forge Core), the "welcome back" offline card and the leap flash.

### 8.4 Destructible terrain (later)

A chunked signed-distance voxel field with surface-nets meshing in a worker, host-authoritative carve events, and ore richness as a second channel remains the plan for a later milestone (§18).

---

## 9. Core mining gameplay

Every player does the same three things: tap the asteroid, buy their own upgrades (§12.2) and fund the Forge Tree (§10). Ore goes to the wallet of whoever earned it; nothing is pooled except what players choose to put into nodes.

| Action | Rule |
|---|---|
| Tap | `tapValue = (1 + drill) × 2^floor(drill/25) × (×4 Overdrive) × (×10 Hyperdrill) × allMult` |
| All income | `allMult = (×1.5 Forge Core) × crewMult × (1 + 0.1 × cores, or 0.2 with Starseed) × (×3 Singularity) × 1.5^mastery × (×2 surge)`, applied to taps, drones, harvesters, rigs and comets |
| Crew Link | `crewMult = 1 + 0.25 × max(1, online − 1)`: ×1.25 solo or in a pair, ×1.5 with three, ×1.75 with four |
| Seam | ×3 (×6 with Deep Scan) × `(1 + 0.25 × scanner)`; the seam loses 1 HP (2 on a crit). Seams have 8 HP; five are on the rock (seven with Deep Scan). |
| Break a seam | ×5 on the final hit (`BREAK_MULT`); a new seam spawns elsewhere; with Resonance the crew surges (§11.2) |
| Crit | `5% + 1% × lens` (Focus Lens max 35, so up to 40%), ×5 (×10 with Fine Optics) |
| Rate limit | 20 taps/s per player |

**Automation** runs only while its owner is online (§14 covers time away):

* **Mining Drones:** 0.5 ore/s each, ×2 per 25 levels, ×2 with Swarm Logic.
* **Harvesters:** 40 ore/s each, ×2 per 25 levels. Drones and harvesters both get `(1 + 0.25 × plating)` and ×10 with Dyson Swarm.
* **Auto-Rigs:** each level taps a random seam once a second for a quarter of a seam tap (base seam bonus, no Scanner bonus, never a crit) and 0.25 HP, so rigs wear seams down, earn the break bonus and can trigger surges.
* **Smelters:** each level also turns 0.25% of all ore you earn (taps, automation, comets, offline) into alloy without using the ore up; ×2 with Hot Smelting. At the 40-level cap that is 10% (20%).

---

## 10. The Forge Tree

One tree per world, shared by everyone in it. It is the crew's long-term goal and the only place resources are pooled.

* **Funding:** `fund {node, res, amount}` moves up to `amount` of the player's own `res` into a node, clamped to what is still owed and what they hold. Anyone can fund any node whose prerequisites are all unlocked; a mixed price (ore + alloy, cores + ore) needs every part paid.
* **Unlock:** when every part is paid the node unlocks for everyone in the world, for good. Quantum Leaps keep it, and the save stores both unlocked nodes and partial funding.
* **Credits:** each contribution is recorded per player as a share of the node's whole price (`by[playerId]`) and added to their lifetime `stats.funded`, shown as "Funded by" on the node page.
* **Repeatable:** Forge Mastery levels up instead of finishing; each level costs ×10 the last, and its credits start over.

| Tier | Node | Cost | Needs | Effect |
|---|---|---|---|---|
| 0 | Forge Core | 3,000 ore | | everyone mines ×1.5 |
| 1 | Auto-Rigs | 60K ore | Forge Core | unlocks Auto-Rig |
| 1 | Swarm Logic | 120K ore | Forge Core | drones ×2 |
| 1 | Fine Optics | 250K ore | Forge Core | crits ×10 instead of ×5 |
| 2 | Smelting | 2.5M ore | Auto-Rigs | unlocks Smelter |
| 2 | Crew Link | 6M ore | Swarm Logic | `crewMult` (§9) |
| 2 | Deep Scan | 15M ore | Fine Optics | seams ×6 instead of ×3, seven seams, unlocks Seam Scanner |
| 3 | Hot Smelting | 120M ore + 300K alloy | Smelting | Smelters ×2 |
| 3 | Alloy Plating | 60M ore + 150K alloy | Smelting | unlocks Alloy Plating |
| 3 | Harvester Fleet | 120M ore + 400K alloy | Smelting, Crew Link | unlocks Harvester |
| 3 | Overdrive | 400M ore + 1M alloy | Deep Scan | taps and rigs ×4 |
| 4 | Night Shift | 4B ore + 15M alloy | Harvester Fleet | 75% offline earnings for up to 12 h (§14) |
| 4 | Quantum Leap | 2B ore + 8M alloy | Harvester Fleet, Hot Smelting | each player may leap (§13) |
| 4 | Resonance | 6B ore + 25M alloy | Overdrive, Alloy Plating | broken seams surge the crew (§11.2) |
| 5 | Stellar Memory | 4 cores | Quantum Leap | runs start at Drill 10 and Drone 10 |
| 5 | Starseed | 12 cores | Quantum Leap | +20% per held core instead of +10% |
| 5 | Hyperdrill | 25 cores | Quantum Leap | taps and rigs ×10 |
| 5 | Dyson Swarm | 40 cores | Quantum Leap | drones and harvesters ×10 |
| 6 | Singularity Forge | 100 cores + 50T ore | Starseed, Hyperdrill, Dyson Swarm | all income ×3 |
| 7 | Forge Mastery | 60 cores + 500T ore, ×10 per level | Singularity Forge | all income ×1.5 per level, repeatable |

**In the HUD:** the Forge Tree tab draws the nodes by tier with lines to their prerequisites (lit once a prerequisite is unlocked) and a progress ring on each; locked nodes show a padlock and nodes you could finish alone glow. Tapping a node opens its page: what it does, the upgrade it unlocks, its prerequisites or what it leads to, and for each resource of its price a progress bar with **10% of mine**, **50% of mine** and **All I can** (**Finish it** when your wallet covers the rest), the last needing a second tap. Under the buttons the page says how long the remainder would take at your passive income (for cores, that spent cores stop boosting you), and the contributor credits.

---

## 11. Comets and surges

v0.2's quakes and flares are gone. Comets reward paying attention; surges reward a crew that breaks seams together.

### 11.1 Comets

* **Spawn:** the first comet comes 45 s after a world starts or loads, then one every 100 to 200 s (uniform, from the previous spawn), only while someone is online. It can be caught for 12 s, plus 0.5 s of grace for latency. The host sends only `{id, at, until, seed}`; each client flies it from the seed inside its own visible area.
* **Catch:** tapping it sends `comet {id}`; the first catch the host receives wins and later ones are ignored.
* **Reward:** every online crewmate gets `max(40 s × their passive ore/s, 60 × their tap value)` of ore, and the catcher gets double. It counts as mined ore (run total, smelting).

### 11.2 Resonance surges

* With the Resonance node, every broken seam (by anyone's tap or Auto-Rig) puts the whole crew on ×2 income for 15 s. Further breaks add 15 s each, up to 60 s ahead.
* The ×2 is part of `allMult`, so it covers taps, drones, harvesters, rigs and comet rewards, but not offline earnings.
* The strike that starts a surge carries `surge: true` (shockwave, flash, toast); a `surgeEnd` note marks the end. Surges are not saved.

---

## 12. Incremental economy and balance

### 12.1 Resources

Every wallet is personal.

| Resource | Earned by | Spent on | Colour |
|---|---|---|---|
| Ore | taps, drones, harvesters, rigs, comets | most upgrades; every tier 0 to 4 node, Singularity and Mastery | `#ffb03a` |
| Alloy | Smelters, from a share of the ore you earn | Seam Scanner, Harvester, Alloy Plating; tier 3 and 4 nodes | `#7fe3ff` |
| Star Cores | Quantum Leap | tier 5 to 7 nodes; each one held is +10% income | `#ffe28a` |

### 12.2 Upgrades

`cost(n) = ceil(base × growth^n)`. The HUD buys ×1, ×10 or Max; the host buys up to 1,000 levels per intent, one at a time, as far as the wallet goes.

| Upgrade | Effect per level | Currency | Base | Growth | Max | Needs node |
|---|---|---|---|---|---|---|
| Drill Laser | +1 ore per tap | ore | 12 | 1.18 | | |
| Mining Drone | +0.5 ore/s | ore | 15 | 1.17 | | |
| Focus Lens | +1% crit | ore | 120 | 1.45 | 35 | |
| Auto-Rig | 1 seam tap/s at 25% | ore | 5,000 | 1.4 | 10 | Auto-Rigs |
| Smelter | 0.25% of ore also becomes alloy | ore | 30,000 | 1.3 | 40 | Smelting |
| Seam Scanner | seams +25% | alloy | 2,000 | 2 | 10 | Deep Scan |
| Harvester | +40 ore/s | alloy | 20,000 | 1.22 | | Harvester Fleet |
| Alloy Plating | drones and harvesters +25% | alloy | 10,000 | 1.9 | 15 | Alloy Plating |

Drill Laser, Mining Drone and Harvester double every 25 levels (`milestoneMult`), giving the classic sawtooth.

### 12.3 Pacing

`npm run balance` (`npx tsx shared/scripts/balance.ts`) simulates one solo player who taps 5 times a second (half on seams), buys the upgrade that pays back fastest, saves for the cheapest open node whenever it costs under 6 minutes of income (it always saves for the Quantum Leap node), funds core-priced nodes as soon as it holds the cores, and leaps once a leap is worth at least 4 cores and 40% of all the cores it has earned so far. Measured with `LEAPS=60 HOURS=24` (h:mm):

| Milestone | Bot time | Bot income after |
|---|---|---|
| Forge Core | 0:02 | 24 ore/s |
| Auto-Rigs | 0:06 | 273 ore/s |
| Swarm Logic | 0:11 | 401 ore/s |
| Fine Optics | 0:13 | 1.96K ore/s |
| Smelting | 0:18 | 13.8K ore/s |
| Crew Link | 0:23 | 21.1K ore/s |
| Deep Scan | 0:44 | 129K ore/s |
| Alloy Plating | 0:46 | 378K ore/s |
| Hot Smelting | 0:49 | 381K ore/s |
| Harvester Fleet | 0:52 | 381K ore/s |
| Quantum Leap node, **leap 1** (+4 cores, 2.37B ore this run), Stellar Memory | 1:48 | |
| Leaps 2 and 3 (+4 each) | 2:40, 3:16 | |
| Overdrive, leap 4 (+5), Starseed | 3:46–3:49 | 4.2M ore/s |
| Night Shift, leaps 5–6, Resonance | 4:19–4:58 | 22M ore/s |
| Hyperdrill, leaps 7–9, Dyson Swarm | 5:18–5:33 | |
| Leaps 10–15 (+39 to +208 cores) | 5:58–12:43 | |
| **Singularity Forge** | 14:03 | 440B ore/s |

Each early node is a few minutes of saving, the tier 2 and 3 nodes up to about twenty, and the Quantum Leap node about an hour, during which the bot's income stays flat near 0.4M ore/s because it is saving instead of upgrading. The core-priced tier 5 nodes take a few leaps each, and the Singularity Forge (100 cores and 50T ore) takes most of a day of active play. Forge Mastery is left as an open-ended sink. Leaps 7–9 come only minutes apart right after Hyperdrill lands; past that, runs stretch to an hour or more because leap cores grow with the cube root of a run's ore (§13).

The bot taps faster than people and spends cores on nodes the moment it can, so humans land later; but tree prices do not scale with crew size, so a crew pooling into the tree will unlock it well ahead of the solo bot.

---

## 13. Prestige: the Quantum Leap

* **Unlock:** the crew funds the Quantum Leap node (tier 4). After that, each player leaps on their own whenever their run is big enough; there is no vote and crewmates are unaffected.
* **Reward:** `cores = floor(3 × cbrt(runOre / 1B))`, paid only once `runOre` ≥ 1B (`LEAP_MIN_ORE`), so the first leap is worth at least 3. `oreForCores(n)` is the inverse the HUD uses for "next core at". Cube-root scaling means ten times the ore pays a bit over twice the cores, which keeps late leaps from snowballing.
* **Passive:** every Star Core you hold is +10% to all your income (+20% with Starseed). Cores are also the currency of tier 5 to 7 nodes, so funding one lowers your own multiplier; the node page says so.
* **Resets** your ore, alloy, upgrade levels and run total (Stellar Memory starts you at Drill 10 and Drone 10). **Keeps** your cores, lifetime stats and the whole Forge Tree.
* The leap button needs a second tap, and a leap plays the warp.

---

## 14. Persistence and offline progress

* **Where:** the solo player's or host's browser saves its world to `localStorage` (`starforge_save_v3`): the seed, seams, the Forge Tree (levels, partial funding, credits) and every crewmate who has played in it, keyed by their browser key (wallet, levels, run, stats, last seen). Comets and surges are not saved, and everyone is saved as offline. A guest's progress in a party lives in the host's world; their own solo world is untouched.
* **Returning crewmates:** when a key the world knows joins again, that player gets their id, wallet, upgrades and credits back plus offline earnings since they were last seen. The host is the first returning key when its save loads.
* **Migrations:** `fromSave` accepts only `v: 3`, rebuilds a state from `createRoomState` defaults and overlays the save, filling any player field added later. v0.2 saves (`starforge_save_v2`) are not carried over.
* **Offline gains:** `applyOffline` pays drones, harvesters and rigs at their passive rate (as if solo, no surge) for `min(away, 8 h)` at 25%; Night Shift raises that to 75% for up to 12 h. Smelters take their alloy share as usual. A "welcome back" card shows the gains when the player was away at least a minute.
* **Dedicated server:** `ProgressStore` (`MemoryStore` today) saves rooms every 30 s and on close, using the same save format, and can reload a room by code. Redis and MongoDB adapters slot in behind that interface.

---

## 15. Security and anti-cheat

* **Intents only;** the host validates every payload (unknown upgrade and node ids rejected with `Object.hasOwn`, resources checked against the list, numbers checked and clamped, names clipped to 16 characters, keys to 40) and enforces the tap rate limit inside the rules.
* **Trust model:** in P2P mode the host is trusted. That is acceptable for friends-only co-op; anything competitive (public lobbies, leaderboards) must run on the dedicated server.
* **Player keys** replace v0.2's resume tokens. A key is random per browser and never derived from a player id. It stays on the host: `RoomHost` blanks every key in the welcome and in snapshots, so a crewmate can't learn another player's key and join as them. A second tab of the same browser (a different `tab` id with an online key) joins as its own crewmate.
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

* `npm test`: node:test over taps, rate limits, seams and break bonuses, crits, personal upgrades (own wallet, bulk buys, locks, max levels, cost curves), the Forge Tree (several funders, prerequisites, refusals, mixed prices, repeatable nodes, reachability, Crew Link, Deep Scan, Resonance), Quantum Leap and its core curve, returning crewmates and offline caps, comets, saves, `RoomHost` (capacity, returning keys, second tabs, keys never sent to the crew, intents to state and effects), number formatting and the asteroid.
* `npm run typecheck`: strict TypeScript for all packages.
* `npm run balance`: pacing bot (§12.3).
* **End to end (development):** a Playwright script runs a local PeerServer and a faked Firebase, has one player host from the lobby and a friend join through the main menu's friends list, with screenshots on desktop and phone. Its v0.2 checks (refiner presses, flare, quake, leap vote) need replacing with v0.3 ones: buying, funding a node from two wallets, a comet, a leap, and leaving and rejoining with progress restored.

---

## 18. Roadmap

| Milestone | Contents | State |
|---|---|---|
| M0 scaffold | workspaces, rules, R3F scene, offline play | done |
| M1 co-op | host-authoritative PeerJS multiplayer on the live site, saves and offline gains, friends list and invites (v0.2; its roles, refinery, events and votes were replaced in M2) | done |
| M2 redesign | shared Forge Tree, personal upgrades and leaps, comets and surges, per-browser progress in a host's world, phone-first HUD | **this version** |
| M3 depth | rig loadouts, more Forge Tree nodes, comet variants, achievements | next |
| M4 scale | dedicated hosting with Redis/Mongo, public lobbies, cloud saves on the site account, `Decimal` numbers, voxel terrain | |

---

## 19. Open questions

1. **Cloud saves:** mirror the world to the site account (`games.starforge`) so progress follows the player across devices? Today a guest's progress exists only in the host's browser.
2. **Host migration:** when a host leaves, should the most active guest inherit the room (state is already on every client) instead of everyone returning to the lobby?
3. **Crew size:** node prices are flat and tuned on a solo bot, so a full crew funds the tree several times faster. Should prices scale with the crew, or is a faster tree the reward for playing together?
4. **Late-game pacing:** the bot still takes three quick leaps right after Hyperdrill lands (§12.3). Worth watching with real players before touching prices again.
