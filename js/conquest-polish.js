/* Space Conquest: safe UI/input/shipyard polish layer.
 * Loaded after the main game script. Intentionally defensive so it can improve
 * the existing prototype without replacing its systems.
 */
(() => {
  'use strict';

  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('canvas, #game, #gameContainer, .game-ui, .build-menu, .shipyard')) e.preventDefault();
  }, { capture: true });

  // Centralized movement state. The main game can consume window.conquestFlightInput.
  const flight = window.conquestFlightInput = window.conquestFlightInput || {
    forward: false, back: false, left: false, right: false, up: false, down: false,
    boost: false
  };
  const keys = new Set();
  const keyMap = { KeyW:'forward', KeyS:'back', KeyA:'left', KeyD:'right', Space:'up', ShiftLeft:'down', ShiftRight:'down' };
  const clearInput = () => {
    keys.clear();
    Object.keys(flight).forEach(k => flight[k] = false);
    window.dispatchEvent(new CustomEvent('conquest:clear-input'));
  };
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });
  window.addEventListener('keydown', (e) => {
    const action = keyMap[e.code];
    if (!action || e.target.closest('input,textarea,select')) return;
    keys.add(e.code);
    flight[action] = true;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') flight.boost = true;
    e.preventDefault();
  }, { capture: true });
  window.addEventListener('keyup', (e) => {
    const action = keyMap[e.code];
    if (!action) return;
    keys.delete(e.code);
    flight[action] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') flight.boost = false;
    e.preventDefault();
  }, { capture: true });

  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.game-ui, .build-menu, .machine-ui, .inventory-ui, .shipyard-ui, button, input, select, textarea')) e.stopPropagation();
  }, { capture: true });

  // Never animate/recreate a selected build description while it is being hovered.
  document.addEventListener('pointerover', (e) => {
    const item = e.target.closest('[data-building], [data-build-id], [data-shipyard]');
    if (item) item.classList.add('conquest-hover');
  });
  document.addEventListener('pointerout', (e) => {
    const item = e.target.closest('[data-building], [data-build-id], [data-shipyard]');
    if (item && !item.contains(e.relatedTarget)) item.classList.remove('conquest-hover');
  });

  // Shipyard visual construction helper. Call with 0..1 progress from the real job.
  window.conquestShipyardProgress = (el, progress, status) => {
    if (!el) return;
    const pct = Math.max(0, Math.min(100, Number(progress) <= 1 ? Number(progress) * 100 : Number(progress)));
    let wrap = el.querySelector('.conquest-shipyard-progress');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'conquest-shipyard-progress';
      wrap.innerHTML = '<div class="conquest-shipyard-progress-fill"></div><span class="conquest-shipyard-status"></span>';
      el.appendChild(wrap);
    }
    const bar = wrap.querySelector('.conquest-shipyard-progress-fill');
    const label = wrap.querySelector('.conquest-shipyard-status');
    bar.style.width = pct + '%';
    label.textContent = status || (pct >= 100 ? 'COMPLETE' : 'BUILDING');
  };

  // Lightweight frame monitor. If a build/shipyard panel exists, avoid expensive
  // layout work during active rendering and expose a frame budget signal to the game.
  let last = performance.now(), frames = 0, slowFrames = 0;
  const monitor = (now) => {
    const dt = now - last; last = now; frames++;
    if (dt > 33) slowFrames++;
    if (frames >= 30) {
      window.conquestPerformance = { fps: Math.round(1000 / Math.max(16.7, (now - (now - 1000)) / Math.max(1, frames)), slowFrames };
      frames = 0; slowFrames = 0;
    }
    requestAnimationFrame(monitor);
  };
  requestAnimationFrame(monitor);
})();
