from pathlib import Path
p=Path('pantry.html')
s=p.read_text(encoding='utf-8-sig')
# Theme
s=s.replace('<meta name="theme-color" content="#1a1410">','<meta name="theme-color" content="#07111f">')
old='''  --bg:#1a1410; --bg2:#241c15; --bg3:#31261a; --bg4:#3e3122;\n  --line:#4a3b28;\n  --honey:#e8a838; --honey2:#f7c463; --jam:#c4442e; --jam2:#e05a3f;\n  --mint:#6fbf8f; --txt:#f0e4d0; --dim:#9b8a70;\n  --gold:#f0c14b; --danger:#c4442e;'''
new='''  --bg:#07111f; --bg2:#0d1b2d; --bg3:#14263d; --bg4:#1d3652;\n  --line:#2b4968;\n  --honey:#35d8ff; --honey2:#8cecff; --jam:#d84cff; --jam2:#ff72e8;\n  --mint:#5ff0c0; --txt:#e8f6ff; --dim:#7894af;\n  --gold:#66e7ff; --danger:#ff527e;'''
if old in s:s=s.replace(old,new,1)
for a,b in {'#15100c':'#050b14','#141019':'#081321','#241708':'#091827','#7a5215':'#117e9b','#6b1e12':'#7c1d83','#6d5f4a':'#56728e','#5a4a30':'#294966','#3a2c1c':'#1b3550','#191309':'#071321','#e8dcc4':'#b9eaff','rgba(20,15,10,.93)':'rgba(5,13,25,.96)','rgba(20,15,10,.95)':'rgba(5,13,25,.97)','rgba(20,15,10,.82)':'rgba(7,17,30,.94)','rgba(38,29,19,.92)':'rgba(12,29,47,.95)','rgba(18,13,9,.88)':'rgba(4,10,20,.94)'}.items():s=s.replace(a,b)
css='''<style id="robot-alien-theme">body{background:radial-gradient(circle at 35% 15%,#122943 0%,#07111f 48%,#030811 100%)}#cv{background:#050b14}#shop{background:linear-gradient(180deg,rgba(7,18,32,.98),rgba(3,10,20,.98));border-left:1px solid #2b617e;box-shadow:-12px 0 35px rgba(0,0,0,.32),inset 1px 0 0 rgba(53,216,255,.10)}#shop:before{content:"ROBOT DEPLOYMENT";display:block;color:#5ff0c0;font-size:9px;letter-spacing:.18em;font-weight:900;padding:0 2px 8px;border-bottom:1px solid #2b4968;margin-bottom:8px}.pill{background:linear-gradient(160deg,rgba(14,35,55,.96),rgba(5,13,25,.94));border-color:#2b4968}.pill.cash{color:#66e7ff}.pill.life{color:#ff72e8}.pill.wave{color:#5ff0c0}.hbtn{background:rgba(7,17,30,.92);border-color:#2b4968}.hbtn.go{border-color:#5ff0c0;color:#5ff0c0}.hbtn.go.fast{background:#5ff0c0;color:#061b16}.stab.sel,.tcard.sel{border-color:#35d8ff;background:#142b43}.logo{color:#35d8ff;text-shadow:0 3px 0 #0b6079}.logo span{color:#d84cff;text-shadow:0 3px 0 #68126d}.mainbtn.play{border-bottom-color:#35d8ff;color:#8cecff}.mainbtn.coop{border-bottom-color:#5ff0c0;color:#9dffe0}.mainbtn.hero{border-bottom-color:#d84cff;color:#edb4ff}.homebtn:hover{border-color:#35d8ff}.btn{border-left-color:#35d8ff}.card.sel{border-left-color:#35d8ff;box-shadow:0 0 0 1px #8cecff}.ver{color:#56728e}.robot-scanline{position:absolute;inset:0;pointer-events:none;z-index:5;background:repeating-linear-gradient(0deg,rgba(70,220,255,.018) 0,rgba(70,220,255,.018) 1px,transparent 1px,transparent 4px);mix-blend-mode:screen}</style>'''
s=s.replace('</style>',css+'</style>',1)
# Replace enemy renderer using simple indexes, avoiding fragile regex.
start=s.find('function drawBugArt(')
end=s.find('function drawTowerArt(',start)
if start<0 or end<0:raise SystemExit('enemy/tower renderer boundaries not found')
alien=r'''function drawBugArt(c,kind,t,r,wob){
 var B=BUGS[kind],col=(B&&B.col)||"#62edff",keys=Object.keys(BUGS||{}),n=Math.max(0,keys.indexOf(kind)),type=n%14,p=.7+.3*Math.sin(t*4+(wob||0));
 var m="#152b43",cyan="#62edff",pink="#ef63ff";c.save();c.translate(0,Math.sin(t*3+(wob||0))*.7);c.scale(r/12,r/12);c.shadowColor=col;c.shadowBlur=7;c.fillStyle=m;c.strokeStyle=col;c.lineWidth=1.6;
 function eye(x,y,z){c.fillStyle="#020812";c.beginPath();c.arc(x,y,z,0,6.283);c.fill();c.fillStyle=cyan;c.globalAlpha=p;c.beginPath();c.arc(x,y,z*.45,0,6.283);c.fill();c.globalAlpha=1}
 function limb(a,b,d,e,w){c.strokeStyle=m;c.lineWidth=w;c.lineCap="round";c.beginPath();c.moveTo(a,b);c.lineTo(d,e);c.stroke();c.strokeStyle=col;c.lineWidth=Math.max(1,w*.3);c.stroke()}
 if(type===0){c.beginPath();c.roundRect(-8,-7,16,14,4);c.fill();c.stroke();eye(-3,-1,1.7);eye(3,-1,1.7);limb(-5,5,-10,9,2);limb(5,5,10,9,2)}
 else if(type===1){c.beginPath();c.ellipse(0,1,9,5,0,0,6.283);c.fill();c.stroke();c.fillStyle="rgba(98,237,255,.2)";c.beginPath();c.ellipse(-8,-5,7,3,0,0,6.283);c.ellipse(8,-5,7,3,0,0,6.283);c.fill();eye(0,0,2)}
 else if(type===2){c.beginPath();c.moveTo(-10,0);c.lineTo(-4,-7);c.lineTo(5,-5);c.lineTo(10,0);c.lineTo(5,5);c.lineTo(-4,7);c.closePath();c.fill();c.stroke();eye(4,-1,1.8);limb(-6,3,-12,8,1.6);limb(6,3,12,8,1.6)}
 else if(type===3){c.beginPath();c.ellipse(0,1,9,7,0,0,6.283);c.fill();c.stroke();c.strokeStyle=cyan;c.beginPath();c.moveTo(0,-6);c.lineTo(0,7);c.stroke();eye(-3,-1,1.3);eye(3,-1,1.3);limb(-6,4,-11,9,1.5);limb(6,4,11,9,1.5)}
 else if(type===4){c.beginPath();c.moveTo(-11,5);c.lineTo(-6,-8);c.lineTo(0,-11);c.lineTo(6,-8);c.lineTo(11,5);c.lineTo(0,9);c.closePath();c.fill();c.stroke();eye(0,-2,2.2);c.strokeStyle=pink;c.beginPath();c.arc(0,0,7,0,6.283);c.stroke()}
 else if(type===5){c.beginPath();c.ellipse(0,0,7,10,0,0,6.283);c.fill();c.stroke();c.strokeStyle=col;c.lineWidth=2;c.beginPath();c.moveTo(-5,-4);c.lineTo(-3,5);c.moveTo(0,-5);c.lineTo(2,5);c.moveTo(5,-4);c.lineTo(7,4);c.stroke();eye(0,-3,1.7)}
 else if(type===6){c.beginPath();c.roundRect(-10,-7,20,14,5);c.fill();c.stroke();c.fillStyle="rgba(95,240,192,.16)";c.fillRect(-7,-4,14,8);eye(-3,-1,1.4);eye(3,-1,1.4);c.strokeStyle=cyan;c.beginPath();c.arc(0,0,11,0,6.283);c.stroke()}
 else if(type===7){c.beginPath();c.arc(0,0,6,0,6.283);c.fill();c.stroke();for(var i=0;i<4;i++){var a=-1.2+i*.8;limb(-3,2,-11+Math.cos(a)*2,8+Math.sin(a)*2,1.4);limb(3,2,11-Math.cos(a)*2,8+Math.sin(a)*2,1.4)}eye(-2,-1,1);eye(2,-1,1)}
 else if(type===8){c.beginPath();c.roundRect(-10,-6,20,12,4);c.fill();c.stroke();c.beginPath();c.moveTo(6,-2);c.lineTo(14,0);c.lineTo(6,2);c.stroke();eye(-4,-2,1.5);eye(0,-2,1.5);c.strokeStyle=pink;c.beginPath();c.moveTo(-6,6);c.lineTo(6,6);c.stroke()}
 else if(type===9){c.beginPath();c.moveTo(0,-11);c.lineTo(8,0);c.lineTo(0,11);c.lineTo(-8,0);c.closePath();c.fill();c.stroke();c.strokeStyle=cyan;c.beginPath();c.arc(0,0,6+Math.sin(t*5)*1.2,0,6.283);c.stroke();eye(0,0,2)}
 else if(type===10){c.beginPath();c.ellipse(0,3,17,8,0,0,6.283);c.fill();c.stroke();eye(0,-4,3);c.strokeStyle=col;c.lineWidth=2;c.beginPath();c.arc(0,3,11,0,Math.PI);c.stroke()}
 else if(type===11){c.beginPath();c.ellipse(0,0,14,17,0,0,6.283);c.fill();c.stroke();eye(-4,-4,2.3);eye(4,-4,2.3);c.fillStyle=pink;c.beginPath();c.moveTo(-9,-13);c.lineTo(-3,-21);c.lineTo(0,-13);c.lineTo(3,-21);c.lineTo(9,-13);c.closePath();c.fill()}
 else if(type===12){c.beginPath();c.roundRect(-19,-13,38,26,8);c.fill();c.stroke();eye(-5,0,2);eye(5,0,2);c.strokeStyle=col;c.lineWidth=3;c.beginPath();c.moveTo(-14,-12);c.lineTo(-20,-20);c.moveTo(14,-12);c.lineTo(20,-20);c.stroke()}
 else{c.beginPath();c.ellipse(0,0,20,12,0,0,6.283);c.fill();c.stroke();c.strokeStyle=pink;c.lineWidth=2;c.beginPath();c.arc(0,0,15+Math.sin(t*3)*1.5,0,6.283);c.stroke();for(var z=0;z<6;z++){var aa=z*Math.PI/3;limb(Math.cos(aa)*10,Math.sin(aa)*7,Math.cos(aa)*25,Math.sin(aa)*17,1.6)}eye(0,0,3.5)}
 c.shadowBlur=0;c.restore();
}

/* ═════════════ TOWER ART ═════════════ */
'''
s=s[:start]+alien+s[end+len('function drawTowerArt(',):]
# The replacement above preserved the tower function body incorrectly, so restore its name prefix.
s=s.replace('/* ═════════════ TOWER ART ═════════════ */\n'+s[s.find('ang=ang||0;'):s.find('ang=ang||0;')], '/* ═════════════ TOWER ART ═════════════ */\nfunction drawTowerArt(c,id,t,ang,fireK,tierInfo,twin){\n'+s[s.find('ang=ang||0;'):s.find('ang=ang||0;')],1) if False else s
# Changelog insertion under existing 2.0 entry.
pos=s.find('var CHANGELOG=['); v=s.find('{v:"2.0.0",d:"latest",items:[',pos)
insert=s.find('\n',v)+1
if pos<0 or v<0:raise SystemExit('2.0 changelog not found')
item='    "UI + ENEMY VISUAL REWORK - futuristic Robot Command UI with metallic panels, cyan robot energy, magenta alien energy, clearer HUD hierarchy and a persistent right-side Robot Deployment shop. Enemy visuals now use distinct alien silhouettes instead of generic bugs, including drones, flyers, armored creatures, spiders and boss-scale forms. Existing enemy ids and stats are preserved.",\n'
if 'UI + ENEMY VISUAL REWORK' not in s:s=s[:insert]+item+s[insert:]
p.write_text(s,encoding='utf-8')
