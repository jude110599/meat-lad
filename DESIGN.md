# Starforge: Technical Design Specification

**Status:** v0.4, co-op incremental pass: one shared Forge Tree of 30 nodes, optional crew roles and crew contracts. **Owner:** Lead Game Developer / Systems Architect.
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

Up to four players share one **world**: a rotating asteroid with glowing seams. Everyone plays the same game. You tap the rock (seams pay more and break for a bonus), buy your own upgrades from your own wallet, and put ore, alloy and Star Cores into the **Forge Tree**, 30 nodes the whole crew pays for together. A node unlocks for everyone once it is fully paid, and its upgrades and multipliers stay for good. Every couple of minutes a **comet** streaks past and pays the whole crew when someone taps it. Late in the tree each player can take a **Quantum Leap** on their own, restarting their run for Star Cores. Once the crew charters itself, each player can take an optional **role** (Prospector, Engineer or Refiner) that doubles one part of their game and lifts that part for everyone else online, and the crew is offered timed **contracts** that pay everyone and build permanent renown. Crewmates who join a host's world keep their progress there and get it back, plus offline earnings, when they return. The HUD is built for phones first: a slim top bar and four tabs in a bottom sheet.

Design pillars:

| Pillar | What it means in practice |
|---|---|
| **Tactile 3D taps** | Every tap lands on a real point of a real mesh, with a laser, sparks, a scorch mark, a number and a camera kick within one frame. Feedback never waits on the network. |
| **Visible automation** | Passive income is never just a number: drones and harvesters orbit and dive, rigs drill on seams. |
| **One game, shared goals** | Roles are optional. Everyone taps, upgrades and leaps with their own wallet; the crew builds one tree, comets and contracts pay everyone, and Crew Link, roles, Uplinks and Resonance pay more when more people play at once. Crewmates can all do the same thing or split the work. A solo player can do everything. |
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
  src/ui/                  lobby (save slots, host/join), HUD (top bar; Upgrades, Forge Tree, Crew and Menu tabs), friends list
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
| Save | every 10 s, on tab hide and on page hide | `localStorage['starforge_save_v3_slot<n>']` (the slot being played) |

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
* **Host leaves:** a deliberate close sends `error: host-left`; a dropped host is detected by the channel closing. Guests return to the lobby with the reason.
* **Errors:** `protocol-mismatch`, `room-full`, `room-not-found` (server only), `host-left`.

### 6.3 Messages

Client → host (`ClientMsg`): `hello {protocol, name, key, tab?}`, `strike {seq, seamId|null}`, `buy {id, count?}` (1 to 1000 levels, as far as the wallet goes), `fund {node, res, amount}`, `leap`, `comet {id}`, `emote {id}`, `prefs {prefs: {role?, auto?, refine?}}` (role, Foreman auto-buy and Refinery switches; a role change within 2 minutes is rejected with `cooldown`), and `ping {id}` (declared; `RoomHost` ignores it).

Host → client (`ServerMsg`): `welcome {playerId, code, state}`, `snap {state}`, `fx {fx: Fx[]}`, `error {error}`.

`Fx` kinds: `strike`, `buy`, `fund`, `leap`, `comet`, `offline`, `reject`, `joined`, `left`, `emote`, and `note` wrapping tick notes (`comet`, `cometGone`, `surgeEnd`, `contract`, `contractDone`, `contractFailed`).

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
| `joinRequests` | asks to join a party `{id, type, game, from, uid, name, ts, code?}`; `type` is `req` (someone asks to join this player's party) or `ok`/`no` (the answer to one this player sent; `ok` carries the party code), valid for 2 minutes |
| `username` | current username (mirrors `usernames/{name}`) |
| `avatar` | profile picture, a ~128 px JPEG data URL under 30 KB |

* **Friend requests:** **Add friend** writes a `req` into the other player's `friendRequests` and records it in the sender's `sentRequests`. Accepting adds the sender to your own `friends` and writes an `ok` with the same id back; the sender's page adds you only if that id matches one of its `sentRequests`, so nobody can add themselves to a list.
* **Join requests:** a player in Starforge's lobby can ask a friend whose presence shows a Starforge party to let them in: a `req` goes into the friend's `joinRequests`. The friend's page that has that party open shows **Accept / Decline**; Accept writes an `ok` with the party code into the requester's `joinRequests` (the account id comes from the host's own friends list, not from the request), and the requester's page joins only if the id matches the request it sent. Other players may only write `partyInbox`, `friendRequests` and `joinRequests` (all three must be in the Firestore rules' `hasOnly` list).
* **Profile card (main menu):** picture upload (cropped and re-encoded client-side), change username (3-20 of `a-z 0-9 _`; creates the new `usernames` doc, then deletes the old one), per-game stats from `accounts.games`, `quackpot/{uid}` and Starforge's local save, and 24 achievement badges computed from them.

* **Main menu:** `MLFriends.menu()` shows a side panel with **Add friend** (by username or email), each friend's status ("playing Starforge", "in a Starforge party" with a **Join** button, "online · on the menu", "offline · seen 5m ago") and incoming invites.
* **In a game:** `MLFriends.attach({game, party, join, dock})`. While the player has a party open, a mini list shows friends with online dots and **Invite** buttons. An invite pops up for the friend wherever they are on the site; **Join** either calls the game's `join(code)` (same game) or navigates to `<game>/?join=CODE`.
* **Starforge** reports its party code while hosting or joined and handles `?join=CODE` by joining as a guest. It turns the floating mini list off (`dock: "none"`) and draws the list itself from `MLFriends.state()` / `onChange()`: in the Crew tab with **Invite** buttons (inviting while solo opens a party first), and on the lobby's Join page with **Request to join** for friends in a Starforge party. The lobby pre-fills the player name from the site username.

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
* **Tabs:** Upgrades, Forge Tree, Crew, Menu. On phones they sit in a bottom tab bar and open a bottom sheet over 52% of the screen (tap the tab again to close it). At ≥ 900 px the same content is a 380 px side panel on the right. A dot on a tab means something is affordable: an upgrade, or a node you could finish by yourself.
* **Upgrades tab:** ×1 / ×10 / Max buy modes and one row per unlocked upgrade, showing what it does for you right now. Upgrades whose node can be funded appear as locked rows that link to the node; the rest stay hidden. Once the Quantum Leap node is unlocked, a leap card shows this run's ore, the next core and a two-tap leap button.
* **Forge Tree tab:** see §10.
* **Crew tab:** party code, copy invite link and close party (host); the party code (guest); open a party or join by code (solo). Then the online crew with each one's ore/s and cores, a note on absent crewmates, emotes (in a party), and the site friends list with **Invite** buttons.
* **Menu tab:** **Back to main menu** (the site's game select), **Starforge title screen** (saves; leaves or closes any party), the save slot in use, your stats, how to play, the changelog, and **Reset this world** (two taps; solo or host only).
* **Lobby (title screen):** a **Main menu** button back to the game select, the player name, **Singleplayer** (three save slots, each showing your ore and cores, Forge Tree progress, crew size and when it was last played, with Continue / Start new and a two-tap delete) and **Multiplayer** (**Host** picks the slot to open to friends; **Join** takes a code or a request to a friend), plus how to play and the changelog.
* **Overlays:** toasts, one hint at a time for new players (tap, buy a Drill Laser, fund the Forge Core), the "welcome back" offline card and the leap flash.

### 8.4 Destructible terrain (later)

A chunked signed-distance voxel field with surface-nets meshing in a worker, host-authoritative carve events, and ore richness as a second channel remains the plan for a later milestone (§18).

---

## 9. Core mining gameplay

Every player can do everything: tap the asteroid, buy their own upgrades (§12.2) and fund the Forge Tree (§10). Ore goes to the wallet of whoever earned it; nothing is pooled except what players choose to put into nodes, and contracts pay every crewmate online (§12.5). Optional crew roles (§12.4) let a crew split the work without locking anyone out of anything.

| Action | Rule |
|---|---|
| Tap | `tapValue = (1 + drill) × milestoneMult(drill) × (×4 Overdrive) × (×10 Hyperdrill) × prospector × allMult`; a real tap is then × `comboMult` |
| Milestones | Drill Laser, Mining Drone and Harvester ×2 at levels 10, 25, 50 and 100, then every 50 (`milestoneMult`; the Upgrades tab shows `nextMilestone`) |
| All income | `allMult = (×1.5 Forge Core) × crewMult × uplinkMult × coreMult × renownMult × (×3 Singularity) × 1.25^refit × 1.5^mastery × (×2 surge)`, applied to taps, drones, harvesters, rigs, comets and contract pay |
| Crew | `crewMult = 1 + 0.05 × mates` before Crew Link, `1.2 + 0.2 × mates` with it (`0.35` per mate with Hive Mind); `mates` = crewmates online with you. Solo ×1.2, a full crew ×1.8 (×2.25). |
| Streak | a tap within 1.5 s of your last one adds to your streak, otherwise it restarts at 1. `comboMult = 1 + 0.1 × combo × min(streak, 30) / 30` (Combo Coil max 10, so ×2 at a full streak). Rigs don't build streaks. |
| Seam | ×3 (×6 with Deep Scan) × `(1 + 0.25 × scanner)`; the seam loses 1 HP (2 on a crit, +1 for a Prospector). Seams have 8 HP; five are on the rock (seven with Deep Scan). |
| Break a seam | ×5 on the final hit (×10 with Motherlode, `breakMult`); a new seam spawns elsewhere; with Resonance the crew surges (§11.2) |
| Crit | `5% + 1% × lens` (Focus Lens max 35, so up to 40%), ×5 (×10 with Fine Optics). Chain Reactor: a crit that follows `n` crits in a row (up to 5) pays another `1 + 0.1 × chain × n`. |
| Rate limit | 20 taps/s per player |

**Automation** runs only while its owner is online (§14 covers time away):

* **Mining Drones:** 5 ore/s each × milestones, ×3 with Swarm Logic.
* **Harvesters:** 250 ore/s each × milestones. Drones and harvesters both get `(1 + 0.25 × plating)`, ×3 with Drone Overclock, ×10 with Dyson Swarm, and the Engineer role (§12.4).
* **Auto-Rigs:** each level (max 15) taps a random seam once a second for a quarter of a seam tap (base seam bonus, no Scanner bonus, never a crit) and 0.25 HP, so rigs wear seams down, earn the break bonus, count toward seam contracts and can trigger surges.
* **Smelters:** each level also turns 0.25% of all ore you earn (taps, automation, comets, contracts, offline) into alloy without using the ore up; ×2 with Hot Smelting and ×2 for a Refiner. At the 40-level cap that is 10% (20%, 40%).
* **Refinery:** each level (max 10) diverts 5% of your passive ore (drones, harvesters, rigs, offline) into alloy at 1 alloy per 4 ore, with the same ×2s as Smelters. Diverted ore still counts toward your leap. It has an on/off switch (`prefs.refine`).
* **Foreman:** auto-buys your upgrades every tick while you are online, cheapest eligible level first, but only a level that costs at most 10% / 20% / 35% of what you hold (Foreman 1 / 2 / 3), at most 25 levels a tick. Level 1 buys Drills, Drones and Harvesters; level 2 adds Lens, Rigs, Combo, Chain and Smelters; level 3 buys everything else. It has an on/off switch (`prefs.auto`) and never touches the Forge Tree, so saving for a node still works.

---

## 10. The Forge Tree

One tree per world, shared by everyone in it. It is the crew's long-term goal and the only place resources are pooled.

* **Funding:** `fund {node, res, amount}` moves up to `amount` of the player's own `res` into a node, clamped to what is still owed and what they hold. Anyone can fund any node whose prerequisites are all unlocked; a mixed price (ore + alloy, cores + ore) needs every part paid. A Refiner's ore and alloy count ×1.25: the node receives 1.25 for every 1 that leaves the wallet, and **Finish it** only takes what the rest is worth after the bonus.
* **Unlock:** when every part is paid the node unlocks for everyone in the world, for good. Quantum Leaps keep it, and the save stores both unlocked nodes and partial funding.
* **Credits:** each contribution is recorded per player as a share of the node's whole price (`by[playerId]`) and added to their lifetime `stats.funded`, shown as "Funded by" on the node page.
* **Repeatable:** Deep Refit (×8 per level) and Forge Mastery (×10 per level) level up instead of finishing, and their credits start over.
* **Layout:** ten rows, at most four nodes a row at x = −1.5, −0.5, 0.5, 1.5 (rows of three use −1, 0, 1), so labels never overlap on a 356 px panel; a test checks it. Columns run by theme: alloy on the left, then drones and automation, crew, and taps and seams on the right.

| Tier | Node | Cost | Needs | Effect |
|---|---|---|---|---|
| 0 | Forge Core | 5.00K ore |  | Everyone mines ×1.5 ore, and crew contracts start. |
| 1 | Auto-Rigs | 300.0K ore | Forge Core | Unlocks Auto-Rigs: they tap seams for you. |
| 1 | Swarm Logic | 500.0K ore | Forge Core | Everyone’s drones produce ×3. |
| 1 | Crew Charter | 800.0K ore | Forge Core | Unlocks crew roles: Prospector, Engineer or Refiner. Each doubles one part of your game and boosts your crewmates’. |
| 1 | Fine Optics | 1.20M ore | Forge Core | Critical taps pay ×10 instead of ×5, and Chain Reactors unlock. |
| 2 | Smelting | 15.00M ore | Auto-Rigs | Unlocks Smelters and the Refinery, which make alloy. |
| 2 | Foreman Protocol | 25.00M ore | Auto-Rigs, Swarm Logic | Unlocks the Foreman, who auto-buys your upgrades. |
| 2 | Crew Link | 40.00M ore | Swarm Logic, Crew Charter | All income +20%, plus +20% for each crewmate online with you. Unlocks Crew Uplink. |
| 2 | Deep Scan | 60.00M ore | Fine Optics | Seams pay ×6 instead of ×3, two more seams appear, and Seam Scanners unlock. |
| 3 | Hot Smelting | 450.0M ore + 60.00M alloy | Smelting | Smelters and Refineries make twice as much alloy. |
| 3 | Drone Overclock | 700.0M ore + 90.00M alloy | Foreman Protocol, Smelting | Everyone’s drones and harvesters mine ×3. |
| 3 | Guild Hall | 900.0M ore + 120.0M alloy | Crew Link | Contracts pay twice as much, and each point of renown is worth +2% instead of +1%. |
| 3 | Motherlode | 1.20B ore + 150.0M alloy | Deep Scan | Breaking a seam pays ×10 instead of ×5. |
| 4 | Alloy Plating | 4.00B ore + 600.0M alloy | Hot Smelting | Unlocks Alloy Plating for drones and harvesters. |
| 4 | Harvester Fleet | 6.00B ore + 900.0M alloy | Drone Overclock | Unlocks Harvesters: big ships that mine 250 ore/s each. |
| 4 | Comet Lure | 8.00B ore + 1.20B alloy | Guild Hall | Comets come twice as often and pay twice as much. |
| 4 | Overdrive | 12.00B ore + 1.80B alloy | Motherlode | Taps and Auto-Rigs mine ×4. |
| 5 | Night Shift | 150.0B ore + 25.00B alloy | Alloy Plating | Earn 75% instead of 25% while away, for up to 12 hours. |
| 5 | Quantum Leap | 100.0B ore + 15.00B alloy | Harvester Fleet, Hot Smelting | Lets each of you leap: restart your own run for Star Cores. |
| 5 | Deep Refit | 250.0B ore + 40.00B alloy, ×8 per level | Harvester Fleet, Comet Lure | All income ×1.25 per level. Each level costs ×8. |
| 5 | Resonance | 400.0B ore + 60.00B alloy | Overdrive, Comet Lure | Breaking a seam gives the whole crew ×2 ore for 15 s. |
| 6 | Stellar Memory | 3 cores | Quantum Leap | Start every run with 25 Drill and 25 Drone levels. |
| 6 | Starseed | 8 cores | Quantum Leap | Each Star Core you hold gives +20% instead of +10%. |
| 6 | Hyperdrill | 15 cores | Quantum Leap | Taps and Auto-Rigs mine ×10. |
| 6 | Dyson Swarm | 25 cores | Quantum Leap | Drones and Harvesters mine ×10. |
| 7 | Quantum Echo | 40 cores | Stellar Memory, Starseed | Leaps keep every upgrade that has a max level (Lens, Rigs, Smelters, Foreman…). |
| 7 | Core Lens | 60 cores | Starseed, Hyperdrill | Leaps pay ×1.5 Star Cores. |
| 7 | Hive Mind | 80 cores | Hyperdrill, Dyson Swarm | Crew Link pays +35% per crewmate instead of +20%, and role boosts to crewmates double. |
| 8 | Singularity Forge | 150 cores + 50.00Qa ore | Quantum Echo, Core Lens, Hive Mind | All income ×3. |
| 9 | Forge Mastery | 100 cores + 500.0Qa ore, ×10 per level | Singularity Forge | All income ×1.5 per level. Each level costs ×10. |

**In the HUD:** the Forge Tree tab draws the nodes by tier with lines to their prerequisites (lit once a prerequisite is unlocked) and a progress ring on each; locked nodes show a padlock and nodes you could finish alone glow. Tapping a node opens its page: what it does, the upgrade it unlocks, its prerequisites or what it leads to, and for each resource of its price a progress bar with **10% of mine**, **50% of mine** and **All I can** (**Finish it** when your wallet covers the rest), the last needing a second tap. Under the buttons the page says how long the remainder would take at your passive income (for cores, that spent cores stop boosting you; for a Refiner, that their contribution counts ×1.25), and the contributor credits.

---

## 11. Comets and surges

v0.2's quakes and flares are gone. Comets reward paying attention; surges reward a crew that breaks seams together.

### 11.1 Comets

* **Spawn:** the first comet comes 45 s after a world starts or loads, then one every 100 to 200 s (uniform, from the previous spawn), only while someone is online. It can be caught for 12 s, plus 0.5 s of grace for latency. The host sends only `{id, at, until, seed}`; each client flies it from the seed inside its own visible area.
* **Catch:** tapping it sends `comet {id}`; the first catch the host receives wins and later ones are ignored.
* **Reward:** every online crewmate gets `max(40 s × their passive ore/s, 60 × their tap value)` of ore, and the catcher gets double. It counts as mined ore (run total, smelting).
* **Comet Lure** (tier 4 node): comets come twice as often (50 to 100 s apart) and pay double.

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
| Ore | taps, drones, harvesters, rigs, comets, contracts | most upgrades; every tier 0 to 5 node, Singularity and Mastery | `#ffb03a` |
| Alloy | Smelters (a share of all the ore you earn) and the Refinery (converts passive ore) | Seam Scanner, Harvester, Alloy Plating; tier 3 to 5 nodes | `#7fe3ff` |
| Star Cores | Quantum Leap | tier 6 to 9 nodes; each one held is +10% income (+20% with Starseed) | `#ffe28a` |

Two layers sit on top of the wallets: **renown** belongs to the world and grows with every finished contract (§12.5), and **Star Cores** belong to each player (§13). Neither is lost on a leap.

### 12.2 Upgrades

`cost(n) = ceil(base × growth^n)`. The HUD buys ×1, ×10 or Max; the host buys up to 1,000 levels per intent, one at a time, as far as the wallet goes. The Foreman column is the lowest Foreman level that auto-buys it (§9).

| Upgrade | Per level | Currency | Base | Growth | Max | Needs node | Foreman |
|---|---|---|---|---|---|---|---|
| Drill Laser | +1 ore per tap. ×2 at levels 10, 25, 50 and 100, then every 50. | ore | 20 | 1.2 |  |  | 1 |
| Mining Drone | +5 ore/s. ×2 at levels 10, 25, 50 and 100, then every 50. | ore | 25 | 1.14 |  |  | 1 |
| Focus Lens | +1% chance for a critical tap. | ore | 150 | 1.42 | 35 |  | 2 |
| Combo Coil | Keep tapping to build a streak: a full 30-tap streak pays +10% per level. | ore | 2.00K | 1.7 | 10 | Forge Core | 2 |
| Night Beacon | While you’re away: +1 hour of earnings and +2.5% offline rate. | ore | 2.50K | 2.6 | 12 |  | 3 |
| Auto-Rig | Taps a glowing seam for you once a second. | ore | 2.00K | 1.32 | 15 | Auto-Rigs | 2 |
| Chain Reactor | Crits in a row pay +10% more per level for each crit before them (up to 5). | ore | 15.00K | 1.75 | 10 | Fine Optics | 2 |
| Foreman | Auto-buys your upgrades while you play. Each level buys more kinds and spends more. | ore | 40.00K | 15 | 3 | Foreman Protocol | 3 |
| Smelter | Refines 0.25% of all the ore you mine into alloy. | ore | 12.00K | 1.24 | 40 | Smelting | 2 |
| Refinery | Turns 5% of your passive ore into alloy (1 alloy per 4 ore). You can switch it off. | ore | 60.00K | 1.7 | 10 | Smelting | 3 |
| Crew Uplink | +3% to all your income for each crewmate online with you. | ore | 100.0K | 1.9 | 10 | Crew Link | 3 |
| Seam Scanner | Glowing seams pay +25% more. | alloy | 600 | 1.9 | 10 | Deep Scan | 3 |
| Harvester | +250 ore/s. ×2 at levels 10, 25, 50 and 100, then every 50. | alloy | 1.50K | 1.15 |  | Harvester Fleet | 1 |
| Alloy Plating | Drones and Harvesters +25%. | alloy | 3.00K | 1.7 | 20 | Alloy Plating | 3 |

* **Producers** (Drill, Drone, Harvester) are uncapped and double at levels 10, 25, 50 and 100, then every 50; everything else has a max level, so Quantum Echo can keep it across leaps.
* **Why drones got cheaper:** at v0.3 a drone was 0.5 ore/s for 15 ore at ×1.17 per level, so a player tapping three times a second earned ten times more from each Drill level and drones never paid back. Now a drone is 5 ore/s for 25 at ×1.14 (the first one pays for itself in 5 s), drills grow faster (×1.2), Swarm Logic triples drones and Drone Overclock triples them again. For the bot tapping once a second, passive income is 64–79% of its income in the first half hour, dips to about 30% while Deep Scan's seams dominate, and is 85% or more from two hours on (v0.3: 5–48%). At three taps a second taps still lead, as they should.
* **Upgrades with switches** (Foreman, Refinery) and roles go through one intent, `prefs {role?, auto?, refine?}` (§12.4).

### 12.3 Pacing

`npm run balance` (`npx tsx shared/scripts/balance.ts`) simulates a crew of `CREW` bots (default 1) in one world. Each bot taps `TAPS` times a second (half on seams, spread out so its streak holds), catches 70% of comets, buys the upgrade that pays for itself fastest in each currency, and saves for the cheapest open node once no upgrade pays back within a minute and the node takes less than six minutes of the crew's income (or less than the best upgrade's payback). A crew takes Prospector, Engineer, Refiner, Engineer; a solo bot takes whichever role pays it most. It leaps once a leap is worth at least 3 cores and 40% of all the cores it has earned. The bot never buys the Foreman or Night Beacons. It also prints how many purchases bot 0 made in hour 1 and the longest wait between purchases (levels or nodes).

**Before and after** (h:mm, solo, `LEAPS=60 HOURS=24`; "before" is the v0.3 rules played by the same bot):

| Milestone | v0.3, 1 tap/s | v0.4, 1 tap/s | v0.3, 3 taps/s | v0.4, 3 taps/s |
|---|---|---|---|---|
| Forge Core | 0:00 | 0:00 | 0:00 | 0:00 |
| Tier 1 complete | 0:14 | 0:08 | 0:05 | 0:04 |
| Smelting | 0:25 | 0:12 | 0:10 | 0:07 |
| Crew Link | 0:36 | 0:22 | 0:18 | 0:12 |
| Deep Scan | 0:57 | 0:30 | 0:29 | 0:16 |
| New tier 3 complete (Motherlode last) | | 1:22 | | 0:32 |
| Harvester Fleet | 2:03 | 1:54 | 0:58 | 0:51 |
| Overdrive | 7:19 | 1:59 | 3:41 | 0:59 |
| Quantum Leap node, **leap 1** | 6:42 | 2:15 | 3:23 | 1:21 |
| Night Shift | 8:32 | 2:42 | 4:13 | 1:47 |
| Starseed | 9:12 | 3:06 | 4:32 | 1:57 |
| Resonance | 9:26 | 3:38 | 4:41 | 2:25 |
| Hyperdrill | 12:20 | 4:01 | 6:03 | 2:45 |
| Dyson Swarm | 13:05 | 4:59 | 6:23 | 3:09 |
| Quantum Echo, Core Lens, Hive Mind | | 5:43, 7:02, 7:17 | | 3:57, 5:08, 5:24 |
| **Singularity Forge** | not in 24 h | 12:48 | 11:54 | 9:33 |
| Longest wait between purchases, hour 1 | 18 min | 12 min | 9 min | 9 min |
| Longest wait, first 3 h | 18 min | 21 min | 18 min | 17 min |
| Contracts finished in 24 h (= renown) | | 389 | | 468 |

At v0.3 the tree hit two walls for anyone tapping slowly: Deep Scan an hour in, and the Quantum Leap node, which took over four hours of flat income at ~75K ore/s (at 5 taps/s the leap node came at 1:33 and the Singularity at 7:25; v0.4 gives 0:58 and 7:55). Now each early node is a few minutes of saving, the tier 3 and 4 nodes ten to twenty, and the Quantum Leap node about a quarter of an hour after Overdrive, with Harvesters, Overdrive and the Comet Lure lifting income tenfold on the way. The core-priced nodes come one or two per few leaps, Quantum Echo, Core Lens and Hive Mind after about ten leaps, and the Singularity Forge after a long day; Deep Refit (×8 per level) and Forge Mastery (×10) remain as open-ended sinks. The longest waits left are single big saves: 21 minutes at 1 tap/s for Alloy Plating (from 1:23), and 17 minutes at 3 taps/s for the Quantum Leap node (from 0:59).

**Crews** (1 tap/s each, `CREW=2` and `CREW=4`): flat node prices plus pooled funding, crew bonuses and roles make a crew much faster.

| Milestone | Solo | Crew of 2 | Crew of 4 |
|---|---|---|---|
| Crew Link | 0:22 | 0:14 | 0:08 |
| Tier 3 complete | 1:22 | 0:36 | 0:15 |
| Quantum Leap node | 2:15 | 1:04 | 0:24 |
| Dyson Swarm | 4:59 | 2:03 | 0:42 |
| Singularity Forge | 12:48 | 5:29 | 1:37 |

Real crews coordinate less than bots, but the gap is deliberate: playing together is the fastest way through the tree (§19 asks whether a full crew is now too fast).

### 12.4 Crew play: roles and crew bonuses

Playing together pays in four stacking ways, all of which count only crewmates who are **online**, and all of which are off for offline earnings (offline counts as solo):

* **Crew bonus** (`crewMult`, §9): +5% income per crewmate before Crew Link; with it ×1.2 solo and +20% per crewmate (+35% with Hive Mind).
* **Crew Uplink** (personal upgrade, needs Crew Link): +3% income per level per crewmate online, max 10 (×1.9 in a crew of four).
* **Roles** (`ROLES`, Crew Charter node): optional. Set with `prefs {role}`; the first pick is free, then a change waits 2 minutes (`cooldown` reject). A role is ×2 for its owner on one part of the game, and every other online crewmate gets +15% on that part (+30% with Hive Mind) for each crewmate who has that role, so a crew of mixed roles beats four of the same.

| Role | For you | For each crewmate |
|---|---|---|
| ⛏️ Prospector | taps and Auto-Rigs ×2; your taps chip an extra 1 HP off seams, so you break more seams (more break bonuses, more Resonance surges, faster seam contracts) | taps +15% |
| 🛰️ Engineer | drones and harvesters ×2; offline earnings ×1.25 | drones and harvesters +15% |
| 🔥 Refiner | Smelter and Refinery alloy ×2; ore and alloy you put into the Forge Tree count ×1.25 | alloy +15% |

* **Contracts** (§12.5) pay every crewmate online, and their goals grow by only +60% per extra crewmate, so a crew finishes them faster.

So one player can tap seams as a Prospector while another runs the fleet as an Engineer and a third refines alloy and banks it into the tree as a Refiner; or everyone can do the same thing; or a solo player takes whichever role suits them.

### 12.5 Crew contracts and renown

Once the Forge Core is unlocked, the world always has a contract on offer while someone is online: the first one 60 s after the core (or after a load), each one open for 8 minutes, and the next 90 s after one ends. `startContract` picks a kind with the host's roll and sizes it for the crew online and the contracts finished so far: goals × `(1 + 0.6 × (online − 1)) × (1 + 0.04 × min(done, 50))`.

| Kind | Goal (solo, first) | Counts |
|---|---|---|
| 💎 seams | 12 | seams broken by anyone's taps or Auto-Rigs |
| ✴️ crits | 30 | critical taps |
| ⛏️ ore | 200 s of income | ore mined live (not offline earnings or contract pay) |
| 🌳 fund | 90 s of income | ore put into the Forge Tree (offered only while an open node takes ore) |
| ☄️ comets | 2 | comets caught |
| 👊 streak | 40 taps, +2 per contract (max 100) | anyone's best tap streak |

"Income" is `contractIncome = passive ore/s + 2 × tapValue`, averaged over the crew online. Progress per player is kept in `contract.by` for the credits. When the goal is met, the next tick pays every online crewmate `120 s × their contractIncome` (×2 with Guild Hall), adds a point of **renown** to the world, and sends a `contractDone` note; a contract that runs out sends `contractFailed` and costs nothing. A new contract sends a `contract` note. The Upgrades tab shows the running contract, its progress, time left and pay.

**Renown** is the world's own incremental layer: every point is +1% income for everyone who plays in that world (+2% with Guild Hall), and it is saved with the world and kept through every leap. The bot finishes about 17 contracts an hour, so a long session builds a steady multiplier that a crew shares.

---

## 13. Prestige: the Quantum Leap

* **Unlock:** the crew funds the Quantum Leap node (tier 5). After that, each player leaps on their own whenever their run is big enough; there is no vote and crewmates are unaffected.
* **Reward:** `cores = floor(3 × lens × cbrt(runOre / 100B))`, paid only once `runOre` ≥ 100B (`LEAP_MIN_ORE`), so the first leap is worth at least 3; `lens` is 1.5 with Core Lens. `oreForCores(n, lens)` is the inverse the HUD uses for "next core at". Cube-root scaling means ten times the ore pays a bit over twice the cores, which keeps late leaps from snowballing.
* **Passive:** every Star Core you hold is +10% to all your income (+20% with Starseed). Cores are also the currency of tier 6 to 9 nodes, so funding one lowers your own multiplier; the node page says so.
* **Resets** your ore, alloy, upgrade levels and run total. Stellar Memory starts you at Drill 25 and Drone 25 (past their first two milestones); Quantum Echo keeps every upgrade with a max level (Lens, Combo, Beacon, Rigs, Chain, Foreman, Smelters, Refinery, Uplink, Scanner, Plating). **Keeps** your cores, lifetime stats, your role, the whole Forge Tree and the world's renown.
* The leap button needs a second tap, and a leap plays the warp.

---

## 14. Persistence and offline progress

* **Where:** the solo player's or host's browser saves its world to one of three `localStorage` save slots (`starforge_save_v3_slot1` to `_slot3`; the last one picked is remembered in `starforge_slot`). The pre-slot single save, `starforge_save_v3`, moves into slot 1 the first time the new lobby loads (only if slot 1 is empty, and the old key is removed only once the copy reads back). A slot holds the seed, seams, the Forge Tree (levels, partial funding, credits) and every crewmate who has played in it, keyed by their browser key (wallet, levels, run, stats, last seen). Comets and surges are not saved, and everyone is saved as offline. A guest's progress in a party lives in the host's world; their own solo world is untouched.
* **Returning crewmates:** when a key the world knows joins again, that player gets their id, wallet, upgrades and credits back plus offline earnings since they were last seen. The host is the first returning key when its save loads.
* **Migrations:** `fromSave` accepts only `v: 3`, rebuilds a state from `createRoomState` defaults and overlays the save. Each player is built from `freshPlayer` first, so fields added later (role, auto-buy and Refinery switches, contract stats, new upgrade levels) get their defaults; streaks and chains start at zero. The running contract is never saved (the next one is offered a minute after load), while `renown` and `contractsDone` are kept. `settleTree` then drops unknown nodes, clamps funding to the current prices and unlocks any node that is already fully paid under them. v0.4 needed no version bump: v0.3 saves load as they are. v0.2 saves (`starforge_save_v2`) are not carried over.
* **Offline gains:** `applyOffline` pays drones, harvesters and rigs at their passive rate (as if solo, no surge) for `min(away, 8 h)` at 25%; Night Shift raises that to 75% for up to 12 h. Each Night Beacon adds 1 h and 2.5 points, an Engineer gets ×1.25 on top, and the rate never passes 100%. Refineries take their share of offline ore as they do online. Smelters take their alloy share as usual. A "welcome back" card shows the gains when the player was away at least a minute.
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

* `npm test`: node:test over taps, rate limits, seams and break bonuses, crits, personal upgrades (own wallet, bulk buys, locks, max levels, cost curves), the Forge Tree (several funders, prerequisites, refusals, mixed prices, repeatable nodes, reachability, Crew Link, Deep Scan, Resonance), Quantum Leap and its core curve, v0.4's rules (producer milestones and drone payback, tap streaks and crit chains, Refinery, Night Beacon, Uplink, Foreman auto-buy, roles and auras, contracts and renown, the new nodes and the tree layout, migrating a v0.3 save, the `prefs` intent), returning crewmates and offline caps, comets, saves, `RoomHost` (capacity, returning keys, second tabs, keys never sent to the crew, intents to state and effects), number formatting and the asteroid.
* `npm run typecheck`: strict TypeScript for all packages.
* `npm run balance`: pacing bot (§12.3); `CREW=2` or `CREW=4` runs a crew with mixed roles.
* **End to end (development):** a Playwright script runs a local PeerServer and a faked Firebase, has one player host from the lobby and a friend join through the main menu's friends list, with screenshots on desktop and phone. Its v0.2 checks (refiner presses, flare, quake, leap vote) need replacing with v0.3 ones: buying, funding a node from two wallets, a comet, a leap, and leaving and rejoining with progress restored.

---

## 18. Roadmap

| Milestone | Contents | State |
|---|---|---|
| M0 scaffold | workspaces, rules, R3F scene, offline play | done |
| M1 co-op | host-authoritative PeerJS multiplayer on the live site, saves and offline gains, friends list and invites (v0.2; its roles, refinery, events and votes were replaced in M2) | done |
| M2 redesign | shared Forge Tree, personal upgrades and leaps, comets and surges, per-browser progress in a host's world, phone-first HUD | **this version** |
| M3 depth | 30-node tree, milestones, streaks and chains, roles, contracts and renown, auto-buy, Refinery (v0.4); rig loadouts, comet variants, achievements | in progress |
| M4 scale | dedicated hosting with Redis/Mongo, public lobbies, cloud saves on the site account, `Decimal` numbers, voxel terrain | |

---

## 19. Open questions

1. **Cloud saves:** mirror the world to the site account (`games.starforge`) so progress follows the player across devices? Today a guest's progress exists only in the host's browser.
2. **Host migration:** when a host leaves, should the most active guest inherit the room (state is already on every client) instead of everyone returning to the lobby?
3. **Crew size:** node prices are still flat. With Crew Link, roles and Uplinks, a crew of two reaches the Quantum Leap node in about 1:04 and the Singularity Forge in 5:29 (solo: 2:15 and 12:48 at 1 tap/s), and a crew of four in 0:24 and 1:37. Should late node prices scale with the number of crewmates who funded them, or is a much faster tree the reward for playing together?
4. **Late-game pacing:** the core-priced nodes now come every leap or two until Dyson, then Echo, Core Lens and Hive Mind after about ten leaps and the Singularity Forge after a long session (§12.3). Deep Refit and Forge Mastery are the open-ended sinks; whether they are enough for week-long play needs real players.
5. **Protocol version:** v0.4 added the `prefs` intent without bumping `PROTOCOL_VERSION` (still 3), because a test elsewhere hardcodes `protocol: 3`. An older client simply never sends `prefs`, but bumping to 4 once that test uses the constant would keep mixed versions out of one room.
