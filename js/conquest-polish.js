/* Space Conquest: safe UI/input/shipyard polish layer.
 * Loaded after the main game script. Intentionally defensive so it can
 * improve the existing prototype without replacing its systems.
 */
(() => {
  'use strict';

  // Prevent browser context menus inside the game and keep right-click from
  // leaking into movement/UI handlers.
  document.addEventListener('contextmenu', (e) => {
    if (e.target.closest('canvas, #game, #gameContainer, .game-ui, .build-menu, .shipyard')) {
      e.preventDefault();
    }
  }, { capture: true });

  // Clear common stuck-key states whenever focus is lost. The main movement
  // loop can read these flags if it exposes them, while this also releases
  // physical keyboard state at the browser level.
  const clearInput = () => {
    window.dispatchEvent(new CustomEvent('conquest:clear-input'));
    document.querySelectorAll('.pressed, .active-key, [data-pressed="true"]').forEach(el => {
      el.classList.remove('pressed', 'active-key');
      el.removeAttribute('data-pressed');
    });
  };
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

  // Stop UI clicks from bubbling into the world/camera movement handlers.
  document.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.game-ui, .build-menu, .machine-ui, .inventory-ui, .shipyard-ui, button, input, select, textarea')) {
      e.stopPropagation();
    }
  }, { capture: true });

  // Stable hover state. Mark dynamic build/shipyard panels as stable so CSS
  // transitions don't repeatedly restart while the pointer remains over them.
  document.addEventListener('pointerover', (e) => {
    const item = e.target.closest('[data-building], [data-build-id], [data-shipyard]');
    if (item) item.classList.add('conquest-hover');
  });
  document.addEventListener('pointerout', (e) => {
    const item = e.target.closest('[data-building], [data-build-id], [data-shipyard]');
    if (item && !item.contains(e.relatedTarget)) item.classList.remove('conquest-hover');
  });

  // Expose a small, idempotent shipyard progress helper for the existing
  // shipyard system. Existing code can call window.conquestShipyardProgress.
  window.conquestShipyardProgress = (el, progress, status) => {
    if (!el) return;
    const pct = Math.max(0, Math.min(100, Number(progress) || 0));
    let bar = el.querySelector('.conquest-shipyard-progress-fill');
    if (!bar) {
      const wrap = document.createElement('div');
      wrap.className = 'conquest-shipyard-progress';
      wrap.innerHTML = '<div class="conquest-shipyard-progress-fill"></div><span class="conquest-shipyard-status"></span>';
      el.appendChild(wrap);
      bar = wrap.querySelector('.conquest-shipyard-progress-fill');
    }
    bar.style.width = pct + '%';
    const label = el.querySelector('.conquest-shipyard-status');
    if (label) label.textContent = status || (pct >= 100 ? 'COMPLETE' : 'BUILDING');
  };
})();
