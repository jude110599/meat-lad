from pathlib import Path
import re

p = Path('conquest.html')
s = p.read_text(encoding='utf-8')

MARK = '/* CONQUEST POLISH PATCH 2026-08-16 */'
if MARK in s:
    raise SystemExit(0)

# Prevent the shipyard from silently consuming parts and then appearing frozen.
s = s.replace(
'''function commissionShip(modelKey){\n  var b=shipyard(); if(!b){ toast("Build a Shipyard first"); return; }\n  if(b.job){ toast("Shipyard is already busy"); return; }\n  var m=SHIP_MODELS.filter(function(x){return x.key===modelKey;})[0];\n  if(stock.parts<m.partsCost){ toast("Not enough parts"); return; }\n  stock.parts-=m.partsCost;\n  b.job={model:modelKey,timeLeft:m.buildTime,total:m.buildTime};\n  sfx.build(); toast("Designing "+m.nm+"...");\n}''',
'''function commissionShip(modelKey){\n  var b=shipyard(); if(!b){ toast("Build a Shipyard first"); return; }\n  if(b.job){ toast("Shipyard is already busy"); return; }\n  var m=SHIP_MODELS.filter(function(x){return x.key===modelKey;})[0];\n  if(stock.parts<m.partsCost){ toast("Not enough parts"); return; }\n  computePowerNetworks();\n  if(!b.powered){ toast("Shipyard needs power before construction can start"); return; }\n  stock.parts-=m.partsCost;\n  b.job={model:modelKey,timeLeft:m.buildTime,total:m.buildTime,started:true};\n  sfx.build(); toast("Building "+m.nm+" — "+m.buildTime+"s");\n  saveGame();\n}''')

# Give the completed ship a physical docked model in the shipyard.
s = s.replace(
'''function completeShip(b){\n  shipModelKey=b.job.model; shipBuilt=true; b.job=null;\n  toast("SHIP COMPLETE — "+SHIP_MODELS.filter(function(x){return x.key===shipModelKey;})[0].nm+" ready to launch");\n  sfx.build();\n}''',
'''function mountDockedShip(b){\n  if(!b||!shipModelKey)return;\n  if(b.dockedShipMesh){ try{surfaceScene.remove(b.dockedShipMesh);}catch(e){} }\n  try{\n    var m=buildShipMesh(shipModelKey);\n    m.scale.setScalar(.62);\n    m.position.copy(b.mesh.position);\n    m.position.y+=3.2;\n    m.rotation.y=b.mesh.rotation.y;\n    b.dockedShipMesh=m;\n    surfaceScene.add(m);\n  }catch(e){}\n}\nfunction completeShip(b){\n  if(!b||!b.job)return;\n  shipModelKey=b.job.model; shipBuilt=true; b.job=null;\n  mountDockedShip(b);\n  toast("SHIP COMPLETE — "+SHIP_MODELS.filter(function(x){return x.key===shipModelKey;})[0].nm+" ready to launch");\n  sfx.build();\n  saveGame();\n}''')

# Remove the docked model when the ship launches.
s = s.replace(
'''function launchShip(){\n  if(!shipBuilt){ toast("No ship ready — commission one at the Shipyard"); return; }''',
'''function launchShip(){\n  if(!shipBuilt){ toast("No ship ready — commission one at the Shipyard"); return; }\n  var sy=shipyard();\n  if(sy&&sy.dockedShipMesh){ try{surfaceScene.remove(sy.dockedShipMesh);}catch(e){} sy.dockedShipMesh=null; }''')

# Persist an active shipyard job.
s = s.replace(
'''targetMode:b.targetMode,targetQty:b.targetQty,producedCount:b.producedCount};''',
'''targetMode:b.targetMode,targetQty:b.targetQty,producedCount:b.producedCount,\n          job:b.job?{model:b.job.model,timeLeft:b.job.timeLeft,total:b.job.total,started:!!b.job.started}:null};''', 1)

# Restore active jobs when loading.
s = s.replace(
'''if(bd.targetMode)b.targetMode=bd.targetMode; if(bd.targetQty)b.targetQty=bd.targetQty; if(bd.producedCount)b.producedCount=bd.producedCount;\n    buildings.push(b);''',
'''if(bd.targetMode)b.targetMode=bd.targetMode; if(bd.targetQty)b.targetQty=bd.targetQty; if(bd.producedCount)b.producedCount=bd.producedCount;\n    if(bd.job)b.job=bd.job;\n    buildings.push(b);''')

# Restore a completed docked ship after loading.
s = s.replace(
'''shipBuilt=!!data.shipBuilt; shipModelKey=data.shipModelKey||null;\n  return true;''',
'''shipBuilt=!!data.shipBuilt; shipModelKey=data.shipModelKey||null;\n  var loadedSy=shipyard();\n  if(loadedSy&&shipBuilt)mountDockedShip(loadedSy);\n  return true;''')

# Replace the silent shipyard tick with an explicit powered/waiting state.
s = s.replace(
'''    } else if(b.type==="shipyard"&&b.job&&b.powered){\n      b.job.timeLeft-=dt;\n      if(b.job.timeLeft<=0)completeShip(b);''',
'''    } else if(b.type==="shipyard"&&b.job){\n      if(b.powered){\n        b.job.timeLeft=Math.max(0,b.job.timeLeft-dt);\n        if(b.job.timeLeft<=0)completeShip(b);\n      }''')

# Give the shipyard a proper live progress/status card.
old = '''  if(b.job){\n    var m2=SHIP_MODELS.filter(function(x){return x.key===b.job.model;})[0];\n    var pc=1-clamp(b.job.timeLeft/b.job.total,0,1);\n    html+='<div class="upg"><div class="top"><span class="nm">Building '+m2.nm+'</span></div>'+\n      '<div class="stat">'+Math.ceil(b.job.timeLeft)+'s remaining</div></div>';\n  } else if(shipBuilt){'''
new = '''  if(b.job){\n    var m2=SHIP_MODELS.filter(function(x){return x.key===b.job.model;})[0];\n    var pc=1-clamp(b.job.timeLeft/b.job.total,0,1);\n    var syStatus=b.powered?('BUILDING — '+Math.ceil(b.job.timeLeft)+'s remaining'):'WAITING FOR POWER';\n    html+='<div class="upg sy-progress-card"><div class="top"><span class="nm">Building '+m2.nm+'</span><span class="stat">'+Math.round(pc*100)+'%</span></div>'+\n      '<div class="conquest-shipyard-progress"><div class="conquest-shipyard-progress-fill" style="width:'+(pc*100)+'%"></div></div>'+\n      '<div class="conquest-shipyard-status">'+syStatus+'</div></div>';\n  } else if(shipBuilt){'''
if old not in s:
    raise SystemExit('shipyard render block not found')
s = s.replace(old,new)

# Make build placement much clearer without changing the underlying placement logic.
s = s.replace(
'''toast("Aim and confirm to place it");''',
'''toast("Place "+d.nm+" — click to build • R to rotate • right-click to cancel");''')

# Insert a single marker plus external polish assets.
injection = '''\n<!-- CONQUEST POLISH ASSETS -->\n<link rel="stylesheet" href="css/conquest-polish.css">\n<script src="js/conquest-polish.js"></script>\n'''
s = s.replace('</body>', injection + '</body>')
s = s.replace('<script type="module">', '<script type="module">\n' + MARK, 1)
p.write_text(s, encoding='utf-8')
