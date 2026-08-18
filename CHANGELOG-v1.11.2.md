# v1.11.2

## Space Flight
- Added deterministic WASD flight input: W/S forward and reverse, A/D turn, Space up, Shift down.
- Clears flight keys when the browser loses focus to prevent stuck movement.

## Shipyard
- Added smooth real-time construction progress helpers.
- Progress display updates continuously instead of relying on a delayed visual jump.
- Added a clear BUILDING percentage and COMPLETE state.

## Build UI
- Disabled selection pulsing/animation for building cards.
- Increased build-button touch target size.
- Added mobile-friendly build button sizing.

> Note: these helpers are committed separately and must be loaded by `conquest.html` to affect the live game.
