# Changelog

All notable changes to Space Conquest are documented here.

## [2.10.0] - 2026-10-31 — Logistics

### Added
- Cargo routes: Shipment Launcher loads are flown by a visible hauler with a travel time (same world vs. between worlds) and a per-trip capacity; overflow at a full hub is flown back.
- Hangar ships can be assigned to a route (per-class capacity and speed) and are excluded from sorties.
- Per-route cargo filter, status, items/min, totals, trips and stall/full alerts; routes listed in the Factory overview.
- Robotic Loader and Robotic Unloader buildings (Tier 3) with animated arms.

### Changed
- Shipment Launchers no longer transfer instantly; in-flight cargo is saved back into the launcher.

## [2.9.0] - 2026-10-31 — Exploration & Colonies

### Added
- Points of interest (crashed ship, abandoned facility, research station) on every world and at the colony, placed on dry flat ground in the walkable ring, with light beams, a timed search on E and tiered rewards (resources, alternate recipe, power shard, coupon); explored state is saved.
- One rich deposit per world and at the colony (2.5x mining and hand-gathering), saved with the nodes.
- Colony Core building (one per alien world) and colony levels (Outpost, Settlement +10%, Colony +20% machine speed); the Command Hub is the home colony's core.
- Colonies section in the Factory overview and colony/exploration line in the galaxy map.

## [2.8.0] - 2026-10-31 — Unique Worlds

### Added
- Per-world terrain generators (Vesta terraced ice mesas and spires, Ember volcanoes with calderas and lava channels, Verdance hills with river valleys, Obsidian crater field and crystal ridges, Bastion mesas and dunes), applied over each world's whole terrain plate with the build clearing kept flat.
- Ember volcano smoke plumes; Bastion spire-cacti.

### Changed
- World terrain beyond the playable square uses the world's own generator instead of the colony's.
- Enemy camp structures sit at the lowest point of their footprint.
- Alien world fog starts further out.

### Fixed
- Foliage masking tracked a single hidden flag per item, so the second part of two-part plants (flower bulbs) stayed visible over obstacles.

## [2.7.0] - 2026-10-31 — Landing

### Added
- A built-in landing pad per world and at the colony (position chosen clear of buildings and deposits, saved); player-built Landing Pads also count.
- Hold-over-pad auto-landing: 3-second countdown HUD, then a slide/align/descend animation onto the deck; leaving the pad cancels.
- Atmospheric entry/exit transition tinted by the destination sky, and re-entry heat particles while locking on.
- Approach marker shows landing pad and building counts.

### Changed
- Arrival from space glides in over the world's pad and ends hovering with the throttle cut.
- Ships rest on the pad deck (flight floor and touchdown use the deck height).
- Building placement and foliage keep the built-in pad clear.

## [2.6.0] - 2026-10-30 — Combat

### Added
- Weapon heat with overheat lockout and HUD heat bar; Warhawk missile ammo (8, rearming).
- Per-weapon muzzle flashes and synthesized sounds; hit-marker, impact bursts.
- Damage states: smoke/fire/sparks on damaged enemies and on the player ship; player shield bubble flare and low-shield flicker; hull-hit camera shake and red edge flash; crippled engines below 25% hull with a warning.
- Wave enemies are AI fighters with roles (striker, lancer, raider), two-pass target leading, separation, planet avoidance and a one-time retreat when below 25% hull.

### Fixed
- Player and enemy bolts are hit-tested along their swept path, so fast shots no longer tunnel through ships.

### Changed
- Enemy bolt speeds raised; enemy fighter hit radius 60; player ship hit radius widened to match the model.

## [2.5.1] - 2026-10-30

### Fixed
- The LAND button was always visible: it had no hide rule.

## [2.5.0] - 2026-10-30 — Flight Handling

### Added
- Per-class ship handling (turn rate, turn response, acceleration time, lateral grip, bank, camera distance).
- Heading-relative momentum: forward speed ramps per class, lateral velocity decays by grip; turn inertia via a smoothed yaw rate.
- Chase camera on a smoothed heading with exact placement (no positional lag), speed pull-back and per-class distance, for space and surface flight.
- Ship turning and camera look sensitivity sliders in the pause menu (saved).

### Changed
- Banking follows the actual yaw rate and slip.
- Ship tail fins are swept, tapered extrusions; the Bomber's tail booms, fins and tailplane are rebuilt.

## [2.4.0] - 2026-10-30 — Conveyors Rebuilt

### Added
- Swept conveyor model: channel frame, rounded rails, belt surface, legs, end drums, drive motor and port collars; tier-specific styling (Mk.3 side guards and braces).
- Belt routing that compares direct, L-shaped and sideways-detour runs and avoids buildings; corners are filleted into curves.
- Instanced belt items resting on the belt surface, oriented along it, moving at a per-tier speed synced to the scrolling chevrons.
- Belt placement preview: valid destinations ringed, ghost belt and an info label (item, tier, rate, length, cost, obstruction warning).
- Auto-belt toggle in the Build menu (saved) that connects a newly placed machine to the nearest compatible one.

### Fixed
- Port arrows now show for Mk.2 and Mk.3 belt tools.

## [2.3.2] - 2026-10-30

### Fixed
- The ground and buildings turned black when standing near a Constructor (the local-light table lookup inherited `constructor` from Object.prototype and produced a NaN light).

## [2.3.1] - 2026-10-30

### Fixed
- Ships could not land: touchdown altitude is now measured from the bottom of the landing gear (the flight floor is ground + gear clearance, which sat above the old fixed touchdown height).

### Added
- Auto-land: L key or the on-screen LAND button while flying over a world.

### Changed
- Touchdown speed threshold raised from 3 to 8.

## [2.3.0] - 2026-10-30 — Light & Atmosphere

### Added
- Per-world lighting profiles: near-neutral sun, hemisphere sky/ground fill, low flat ambient, rim light, exposure and grade per world.
- Brightness setting in the pause menu (50–160%), saved to localStorage.
- Colour-grading pass on High graphics (HDR render target, white balance, saturation, ACES, shadow lift, contrast, vignette).
- Pooled local point lights (4) assigned to the nearest lamps, interiors and active furnaces, generators and refinery.
- Contact shadow decal under every machine.
- Sky dome, stars, moon, gas giant and a sun glow that follow the camera onto every world; star visibility per world.
- Two distant mountain-range bands on every horizon; clouds on every world.
- Weather particles per world (dust, snow, embers, spores, void motes, ash) with wind gusts.

### Changed
- Shadows use PCF with a blur radius; the surface shadow map updates every other frame on foot.
- Reflection maps are painted from each world's lighting profile, and stay on in Low graphics.
- Glass and water are dielectric materials; metal reflection strength raised.
- Cloud sprites use a soft multi-blob texture.

### Fixed
- Foliage no longer spawns through ore deposits, enemy camp structures or the lander.
- Worlds other than the colony had no sky dome, stars or moon.

## [2.2.0] - 2026-10-29 — The Factory Update

### Added
- New deposits: Limestone, Caterium Ore, Raw Quartz, Bauxite and Crude Oil at the colony and on other worlds (added to existing saves); Water from a Water Extractor.
- 30 new items with Constructor, Smelter, Foundry, Assembler, Manufacturer and Oil Refinery recipes, from Iron Plates and Screws up to Computers, Heavy Modular Frames and Adaptive Control Units.
- Buildings: Manufacturer, Oil Extractor, Water Extractor, Oil Refinery, Fuel Generator, Power Storage, Industrial Storage, AWESOME Sink, Space Elevator, Research Lab, Conveyor Belt Mk.3 and Golden Nut Statue, each with an animated model.
- Space Elevator with three delivery phases; phases 1 and 2 open Hub Tiers 5 and 6.
- AWESOME Sink points and coupons, and a shop with Power Shards, a jetpack, gold paint and the statue.
- Clock-speed control (10–250%) on production machines and extractors, with Power Shards for overclocking and power draw scaling with clock.
- Eight alternate recipes discovered at the Research Lab.
- Factory overview (O): power, battery charge, machine counts and per-minute production and consumption over the last minute.
- Per-minute input and output rates in machine panels.

### Changed
- Smelters and Constructors send output with no belt attached straight to the stockpile.
- Miners can't be placed on oil, and each deposit takes one extractor.
- Hub milestones are listed in tier order.

## [2.1.0] - 2026-10-29

### Added
- Terrain shader that blends soil and triplanar rock by slope, with large-scale colour variation and biome-coloured peaks; terrain heightfield with fbm hills and ridged mountains.
- Lakes on every world (water, ice, lava, swamp, void liquid, oil).
- Instanced, wind-animated foliage with a plant set per biome (grass, trees, shrubs, ferns, flowers, crystals, rocks, wreckage), clumped naturally, chunked for culling, built per world on first visit, and hidden under buildings.
- A model kit (rounded panels, lathed parts, pipes, vents, screens, ladders, rails, trusses) and new models for every building, ship, the player, enemies, ore deposits, the lander, enemy camps and the orbital station.

### Changed
- Static parts of each model are merged by material to keep draw calls low.
- Painting a building gives the painted parts their own materials.
- Landed ship height is measured from each ship model.

## [2.0.0] - 2026-10-29 — The Armada Update

### Added
- Realistic graphics: procedurally generated PBR metal and ground textures (albedo, normal and roughness maps), image-based reflections, real-time sun shadows, rebuilt planets with continents, mountains, craters and fresnel atmospheres, a visible sun, and new explosions (fireballs, shockwaves, smoke, debris, light flashes, camera shake). A Graphics High/Low toggle in the pause menu.
- Production chain: Coal Generator, Foundry (steel), Assembler (wire, circuit boards, motors, hull plating), Robotics Bay (robot pilots), with new resources, belt items and icons.
- Milestone tiers at the Command Hub (Foundations, Industrialization, Fleet Logistics, Armada).
- Hangar (four ship berths) and Fleet Command: assign robot pilots, choose sortie ships and formation (Vee, Line, Column, Ring).
- Sortie launch animation from the Hangar and from the Shipyard, formation flying, and the RELEASE button (X) to let wingmen break formation and attack on their own.
- Warhawk Gunship: twin plasma cannons and homing missiles (F).
- Bastion Prime: a giant fortress world behind a planetary shield, an orbital gun ring with 40 turrets and 8 reactor cores, and three carriers that launch fighters. Destroying every reactor collapses the ring and drops the shield so the planet can be landed on.
- Advanced fighter AI (target leading, bracketing, overshoot-and-reverse, evasive jinks).
- Alien garrisons on every world with squad AI: patrols, alerts, cover, flanking, heavies, stalker drones, a laser-sighted sniper, retreating to heal, and barracks reinforcements.
- A default sidearm, ship guns for strafing runs over worlds, an objective tracker, a squadron HUD, navigation markers in space, a real galaxy map and a mobile FIRE button.

### Fixed
- Machine panel buttons and notes rendered as unstyled browser elements.

## [1.11.1] - 2026-08-16

### Changed
- Improved the shipyard construction experience and status feedback.
- Improved the build menu interaction and placement experience.
- Increased the visibility and usability of the Build button.
- Improved build-menu hover and selection behavior.
- Added UI/input polish to prevent browser interactions from interfering with gameplay.

### Fixed
- Fixed shipyard construction getting stuck after starting a ship build.
- Fixed shipyard progress/status handling.
- Fixed build-menu hover/selection flickering and pulsing.
- Fixed right-click browser context-menu behavior inside the game.
- Fixed UI clicks leaking into gameplay input.
- Added protection against stuck movement input when browser focus changes.

### Added
- Added a dedicated UI polish layer for safer input and shipyard progress feedback.
- Added clearer shipyard construction states such as building, complete, and unavailable states.
