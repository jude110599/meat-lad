/* Space Conquest v1.11.3 gameplay helpers.
   Loaded as an optional enhancement. It does not replace existing game systems.
*/
(function(){
  'use strict';
  const state = { flight:false, keys:Object.create(null) };
  window.conquestV113 = state;

  function isFlight(){
    return !!(window.spaceFlight || window.isFlying || window.inSpaceFlight || document.body?.dataset?.flight === 'true');
  }
  addEventListener('keydown', e => {
    if(['KeyW','KeyA','KeyS','KeyD'].includes(e.code)) state.keys[e.code]=true;
  });
  addEventListener('keyup', e => {
    if(['KeyW','KeyA','KeyS','KeyD'].includes(e.code)) state.keys[e.code]=false;
  });

  // Prevent mouse movement from affecting the browser/game while in flight.
  addEventListener('mousemove', e => {
    if(isFlight()) e.stopImmediatePropagation();
  }, true);

  // Expose non-invasive movement state for the existing flight controller.
  state.getMovement = function(){
    return { forward:(state.keys.KeyW?1:0)-(state.keys.KeyS?1:0), strafe:(state.keys.KeyD?1:0)-(state.keys.KeyA?1:0) };
  };

  // Conveyor endpoint helpers: existing conveyor/building code can use these to
  // snap a belt end to the nearest compatible machine port.
  state.snapConveyorEndpoint = function(belt, building, port){
    if(!belt || !building || !port) return false;
    belt.connectedBuilding = building;
    belt.connectedPort = port;
    if(port.position){ belt.end = {x:port.position.x,y:port.position.y,z:port.position.z}; }
    return true;
  };

  // Shipyard visual progress helper. Existing shipyard code can call this with
  // progress 0..1 to reveal components progressively instead of spawning the
  // finished ship instantly.
  state.updateShipBuildVisual = function(parts, progress){
    if(!Array.isArray(parts)) return;
    const p=Math.max(0,Math.min(1,Number(progress)||0));
    const count=Math.ceil(parts.length*p);
    parts.forEach((part,i)=>{ if(part && part.style) part.style.visibility=i<count?'visible':'hidden'; });
  };
})();
