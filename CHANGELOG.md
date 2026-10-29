# Changelog

All notable changes to Space Conquest are documented here.

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
