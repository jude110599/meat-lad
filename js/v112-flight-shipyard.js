/* v1.11.2: deterministic WASD flight + shipyard construction helpers. */
(() => {
  'use strict';
  const keys = new Set();
  const watched = new Set(['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight']);
  const set = e => { if (watched.has(e.code)) { keys.add(e.code); e.preventDefault(); } };
  const clear = e => { if (watched.has(e.code)) keys.delete(e.code); };
  addEventListener('keydown', set, {capture:true});
  addEventListener('keyup', clear, {capture:true});
  addEventListener('blur', () => keys.clear());
  window.conquestFlightInput = () => ({
    forward: keys.has('KeyW'), reverse: keys.has('KeyS'), left: keys.has('KeyA'), right: keys.has('KeyD'),
    up: keys.has('Space'), down: keys.has('ShiftLeft') || keys.has('ShiftRight')
  });

  // Smooth, real-time construction progress. The existing shipyard can call
  // conquestShipBuildProgress(el, startedAt, duration) each animation frame.
  window.conquestShipBuildProgress = (el, startedAt, duration) => {
    if (!el) return 1;
    const p = Math.max(0, Math.min(1, (performance.now() - startedAt) / Math.max(1, duration)));
    let fill = el.querySelector('.v112-ship-progress-fill');
    if (!fill) {
      const wrap = document.createElement('div');
      wrap.className = 'v112-ship-progress';
      wrap.innerHTML = '<div class="v112-ship-progress-fill"></div><span class="v112-ship-progress-label">BUILDING 0%</span>';
      el.appendChild(wrap); fill = wrap.firstElementChild;
    }
    fill.style.transform = `scaleX(${p})`;
    const label = el.querySelector('.v112-ship-progress-label');
    if (label) label.textContent = p >= 1 ? 'COMPLETE' : `BUILDING ${Math.floor(p*100)}%`;
    return p;
  };
})();
