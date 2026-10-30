# Changelog

All notable changes to Space Conquest are documented here.

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
