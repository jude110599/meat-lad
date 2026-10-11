/* ═════════════ FRIENDS + PARTY INVITES (shared by every online game) ═════════════
   One friends list for the whole site, on the same Firebase account the menu,
   Meat Lad, Beetdown and Alien Attack already sign into.

   Everything lives on the player's existing accounts/{uid} document, so it
   works under the same Firestore rules the games already rely on:
     friends      array of friend emails (the same array Beetdown and Meat Lad use)
     presence     {ts, game, name, party}  heartbeat every 30 s; online = seen < 75 s ago
     partyInbox   array of invites {id, from, fromName, game, code, ts}, newest last
     friendRequests  incoming {id, type, from, uid, name, ts}: type "req" is a
                  friend request, "ok"/"no" is the answer to one this player sent
     sentRequests own outgoing requests {id, to, uid, name, ts, req}
     username     the player's current username (mirrors usernames/{name})
     avatar       custom profile picture, a ~128px JPEG data URL (< 30 KB)

   Friend requests: A writes a "req" into B's friendRequests and remembers it in
   its own sentRequests. B accepts by adding A to its own friends and writing an
   "ok" with the same id into A's friendRequests; A's page only honours an "ok"
   that matches one of its sentRequests, then adds B. So the only fields other
   players ever write are partyInbox and friendRequests.

   The main menu also shows a profile card (picture, username + rename, stats
   and achievements read from accounts.games, quackpot/{uid} and Starforge's
   local save).

   Pages use it in one of two ways:
     MLFriends.menu()                       full side panel (main menu)
     MLFriends.attach({game, party, join})  mini list while a party is open,
                                            plus invite pop-ups, inside a game
   `party()` returns {code} while the player is in an online party (else null)
   and `join(code)` makes the game join that party code. Optional:
   `visible()` hides the mini list (e.g. mid-run), `onFriends(list)` hears
   friend-list changes, and `dock:"bottom-left"` moves the mini list down. */
(function(){
"use strict";
if(window.MLFriends)return;

var FB_VER="10.7.0";
var FB_CONFIG={apiKey:"AIzaSyBa6Kv2Wiot2F-vqX_sOH57Yy6O_HBIwPk",authDomain:"game-701be.firebaseapp.com",
  projectId:"game-701be",storageBucket:"game-701be.firebasestorage.app",messagingSenderId:"637319510154",
  appId:"1:637319510154:web:6f4947e02802c641d89573"};
var ONLINE_MS=75000, BEAT_MS=30000, INVITE_TTL=10*60000, PARTY_POLL_MS=1500;

/* Every game with online play. `page` is relative to the site root. */
var GAMES={
  menu:{name:"the main menu"},
  meatlad:{name:"Meat Lad",page:"meatlad.html",col:"#e8324a"},
  beetdown:{name:"Beetdown",page:"beetdown.html",col:"#7bd94a"},
  pantry:{name:"Alien Attack",page:"pantry.html",col:"#4fc3ff"},
  starforge:{name:"Starforge",page:"starforge/",col:"#ffb03a"}
};

/* Site root, from where this script was loaded (js/friends.js -> ../). */
var ROOT=(function(){
  try{ var s=document.currentScript&&document.currentScript.src; if(s)return new URL("../",s).href; }catch(e){}
  return location.href.replace(/[^/]*$/,"");
})();

var db=null, auth=null, FV=null;
var me=null;                 // {uid,email,name}
var game="menu", adapter=null, mode=null;
var friends=[];              // raw entries from accounts/{uid}.friends
var info={};                 // entry -> {email,uid,name,presence}
var inbox=[];                // own partyInbox
var unsubs=[], friendUnsubs=[], beatT=null, partyT=null, tickT=null;
var lastParty=null, status="loading", errMsg="";
var sentAt={};               // friend uid -> ts of last invite from this page
var reqs=[], sent=[];        // own friendRequests / sentRequests
var myDoc={};                // own accounts doc (games, avatar, username)
var qpSave=null;             // Quackpot save (its own collection)
var editName=false;

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function gameName(id){ return (GAMES[id]&&GAMES[id].name)||"a game"; }
function shortName(email){ return String(email||"").split("@")[0]||"player"; }
function ago(ms){
  var s=Math.max(0,(Date.now()-ms)/1000);
  if(s<90)return "just now"; if(s<3600)return Math.round(s/60)+"m ago";
  if(s<86400)return Math.round(s/3600)+"h ago"; return Math.round(s/86400)+"d ago";
}

/* ---------- Firebase (reuse the page's app, or load the same SDK) ---------- */
function loadScript(src){
  return new Promise(function(res,rej){
    var s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=rej;
    document.head.appendChild(s);
  });
}
var fbP=null;
function firebaseReady(){
  if(fbP)return fbP;
  var base="https://www.gstatic.com/firebasejs/"+FB_VER+"/";
  fbP=(window.firebase&&firebase.firestore?Promise.resolve():
    loadScript(base+"firebase-app-compat.js")
      .then(function(){ return loadScript(base+"firebase-auth-compat.js"); })
      .then(function(){ return loadScript(base+"firebase-firestore-compat.js"); })
  ).then(function(){
    if(!firebase.apps.length)firebase.initializeApp(FB_CONFIG);
    auth=firebase.auth(); db=firebase.firestore(); FV=firebase.firestore.FieldValue;
  });
  return fbP;
}
function acct(uid){ return db.collection("accounts").doc(uid); }

/* ---------- session ---------- */
function start(){
  firebaseReady().then(function(){
    auth.onAuthStateChanged(function(u){ stop(); if(u)signedIn(u); else{ status="out"; render(); } });
  }).catch(function(){ status="error"; errMsg="Friends couldn't load. Check your connection."; render(); });
}
function stop(){
  unsubs.concat(friendUnsubs).forEach(function(f){ try{f();}catch(e){} });
  unsubs=[]; friendUnsubs=[]; info={}; friends=[]; inbox=[]; me=null;
  reqs=[]; sent=[]; myDoc={}; qpSave=null; editName=false;
  if(beatT)clearInterval(beatT); beatT=null;
}
function signedIn(u){
  var email=String(u.email||"").toLowerCase();
  me={uid:u.uid,email:email,name:lsGet("mlf:name:"+u.uid)||shortName(email)};
  status="in"; render();
  // A friendly display name: the username picked at sign-up, if there is one.
  db.collection("usernames").where("uid","==",u.uid).get().then(function(q){
    if(q.empty||!me||me.uid!==u.uid)return;
    var ids=q.docs.map(function(d){ return d.id; });
    var pick=myDoc.username&&ids.indexOf(myDoc.username)>=0?myDoc.username:ids[0];
    me.name=pick; lsSet("mlf:name:"+u.uid,me.name); beat(); render();
  }).catch(function(){});
  if(mode==="menu")loadQuackpot(u.uid);
  beat();
  beatT=setInterval(beat,BEAT_MS);
  unsubs.push(acct(u.uid).onSnapshot(function(snap){
    var d=snap.exists?snap.data():{};
    var list=(d.friends instanceof Array)?d.friends.slice():[];
    inbox=(d.partyInbox instanceof Array)?d.partyInbox.slice():[];
    myDoc=d;
    reqs=(d.friendRequests instanceof Array)?d.friendRequests.filter(function(r){ return r&&r.id&&r.from; }):[];
    sent=(d.sentRequests instanceof Array)?d.sentRequests.filter(function(r){ return r&&r.id&&r.to; }):[];
    if(typeof d.username==="string"&&/^[a-z0-9_]{3,20}$/.test(d.username)&&d.username!==me.name){
      me.name=d.username; lsSet("mlf:name:"+u.uid,me.name);
    }
    handleAnswers();
    if(list.join("\n")!==friends.join("\n")){ friends=list; watchFriends(); notifyFriends(); }
    pruneInbox(); render(); showNewInvites();
  },function(){ status="error"; errMsg="Friends are unavailable right now."; render(); }));
}

/* Presence heartbeat. merge:true also creates the doc (with its email, so
   friends can find it) for players who signed up but never saved a game. */
function beat(){
  if(!me||!db)return;
  var p=adapter&&adapter.party?safeParty():null;
  lastParty=p?p.code:null;
  acct(me.uid).set({email:me.email,presence:{ts:Date.now(),game:game,name:me.name,party:lastParty}},{merge:true})
    .catch(function(){});
}
function safeParty(){ try{ var p=adapter.party(); return p&&p.code?p:null; }catch(e){ return null; } }
/* The mini list shows while a party is open, except where the game says it
   would get in the way (mid-run). */
function miniVisible(){
  if(!adapter||!safeParty())return false;
  try{ return adapter.visible?!!adapter.visible():true; }catch(e){ return true; }
}

/* ---------- friends ---------- */
var resolveCache={};
function resolveEntry(entry){
  entry=String(entry||"").trim().toLowerCase();
  if(entry.indexOf("@")>=0)return Promise.resolve(entry);
  if(resolveCache[entry])return resolveCache[entry];
  return (resolveCache[entry]=db.collection("usernames").doc(entry).get()
    .then(function(s){ return s.exists?String(s.data().email||"").toLowerCase()||null:null; })
    .catch(function(){ return null; }));
}
function watchFriends(){
  friendUnsubs.forEach(function(f){ try{f();}catch(e){} }); friendUnsubs=[];
  var keep={}; friends.forEach(function(e){ keep[e]=info[e]||{}; }); info=keep;
  Promise.all(friends.map(resolveEntry)).then(function(emails){
    var byEmail={};
    friends.forEach(function(entry,i){ info[entry].email=emails[i]||null; if(emails[i])byEmail[emails[i]]=entry; });
    var all=Object.keys(byEmail);
    for(var i=0;i<all.length;i+=30){
      friendUnsubs.push(db.collection("accounts").where("email","in",all.slice(i,i+30)).onSnapshot(function(q){
        q.forEach(function(doc){
          var d=doc.data(), entry=byEmail[String(d.email||"").toLowerCase()];
          if(!entry||!info[entry])return;
          info[entry].uid=doc.id; info[entry].presence=d.presence||null; info[entry].avatar=safeAvatar(d.avatar);
        });
        render();
      },function(){}));
    }
    render();
  });
}
function friendView(entry){
  var f=info[entry]||{}, p=f.presence||null;
  var online=!!(p&&p.ts&&Date.now()-p.ts<ONLINE_MS);
  var name=(p&&p.name)||(entry.indexOf("@")<0?entry:shortName(entry));
  var st;
  if(!f.uid)st=f.email===null?"not found":"never signed in here yet";
  else if(!online)st=p&&p.ts?"offline · seen "+ago(p.ts):"offline";
  else if(p.party&&p.game!=="menu")st="in a "+gameName(p.game)+" party";
  else if(p.game&&p.game!=="menu")st="playing "+gameName(p.game);
  else st="online · on the menu";
  return {entry:entry,uid:f.uid,name:name,online:online,status:st,avatar:f.avatar||"",
    party:online&&p.party&&GAMES[p.game]&&GAMES[p.game].page?{game:p.game,code:p.party}:null};
}
function sortedFriends(){
  return friends.map(friendView).sort(function(a,b){
    return (b.online-a.online)||a.name.localeCompare(b.name); });
}
function onlineCount(){ return friends.map(friendView).filter(function(f){return f.online;}).length; }
function notifyFriends(){
  if(adapter&&adapter.onFriends)try{ adapter.onFriends(friends.slice()); }catch(e){}
}

/* "Add friend" sends a request; it only becomes a friendship once accepted. */
function rid(){ return Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4); }
function isFriend(email){
  for(var i=0;i<friends.length;i++)
    if(friends[i]===email||(info[friends[i]]&&info[friends[i]].email===email))return true;
  return false;
}
function addFriend(raw){
  raw=String(raw||"").trim().toLowerCase().replace(/^@/,"");
  if(!me)return Promise.resolve("Sign in first.");
  if(!raw)return Promise.resolve("Type a username or email.");
  return resolveEntry(raw).then(function(email){
    if(!email)return raw.indexOf("@")>=0?"No account with that email.":"No player called \""+raw+"\".";
    if(email===me.email)return "That's you.";
    if(isFriend(email))return "Already on your list.";
    var incoming=reqs.filter(function(r){ return r.type==="req"&&r.from===email; })[0];
    if(incoming)return acceptRequest(incoming).then(function(){ return "ok:You're now friends with "+(incoming.name||shortName(email))+"."; });
    if(sent.some(function(r){ return r.to===email; }))return "Request already sent - waiting for them to accept.";
    return db.collection("accounts").where("email","==",email).limit(1).get().then(function(q){
      if(q.empty)return "That player hasn't opened this site since signing up. Ask them to visit, then try again.";
      var uid=q.docs[0].id, name=raw.indexOf("@")<0?raw:((q.docs[0].data().presence||{}).name||shortName(email));
      var req={id:rid(),type:"req",from:me.email,uid:me.uid,name:me.name,ts:Date.now()};
      return acct(uid).set({friendRequests:FV.arrayUnion(req)},{merge:true}).then(function(){
        return acct(me.uid).set({sentRequests:FV.arrayUnion({id:req.id,to:email,uid:uid,name:name,ts:req.ts,req:req})},{merge:true});
      }).then(function(){ return "ok:Friend request sent to "+name+"."; });
    });
  }).catch(function(){ return "Couldn't send that request."; });
}
function acceptRequest(r){
  var ans={id:r.id,type:"ok",from:me.email,uid:me.uid,name:me.name,ts:Date.now()};
  return acct(me.uid).set({friends:FV.arrayUnion(r.from),friendRequests:FV.arrayRemove(r)},{merge:true})
    .then(function(){ return r.uid?acct(r.uid).set({friendRequests:FV.arrayUnion(ans)},{merge:true}).catch(function(){}):null; });
}
function declineRequest(r){
  acct(me.uid).set({friendRequests:FV.arrayRemove(r)},{merge:true}).catch(function(){});
  if(r.uid)acct(r.uid).set({friendRequests:FV.arrayUnion({id:r.id,type:"no",from:me.email,uid:me.uid,ts:Date.now()})},{merge:true}).catch(function(){});
}
function cancelRequest(s1){
  acct(me.uid).set({sentRequests:FV.arrayRemove(s1)},{merge:true}).catch(function(){});
  if(s1.uid&&s1.req)acct(s1.uid).set({friendRequests:FV.arrayRemove(s1.req)},{merge:true}).catch(function(){});
}
/* Answers to requests this player sent. An "ok" counts only if it matches a
   request we actually sent to that email, so nobody can add themselves. */
var answering={};
function handleAnswers(){
  reqs.forEach(function(r){
    // Already friends on this side (an older one-way add): accept straight away.
    if(r.type==="req"&&isFriend(r.from)&&!answering[r.id+"req"]){ answering[r.id+"req"]=1; acceptRequest(r).catch(function(){}); return; }
    if(r.type==="req"||answering[r.id+r.type])return;
    answering[r.id+r.type]=1;
    var mine=sent.filter(function(x){ return x.id===r.id&&x.to===r.from; })[0];
    var upd={friendRequests:FV.arrayRemove(r)};
    if(mine){
      upd.sentRequests=FV.arrayRemove(mine);
      if(r.type==="ok"){ upd.friends=FV.arrayUnion(r.from); toast((r.name||mine.name)+" accepted your friend request"); }
    }
    acct(me.uid).set(upd,{merge:true}).catch(function(){ delete answering[r.id+r.type]; });
  });
}
function incoming(){ return reqs.filter(function(r){ return r.type==="req"&&!isFriend(r.from); }); }
function removeFriend(entry){
  if(!me)return;
  acct(me.uid).set({friends:FV.arrayRemove(entry)},{merge:true}).catch(function(){});
}

/* ---------- invites ---------- */
function invite(fv){
  var p=adapter&&safeParty();
  if(!me||!p||!fv.uid)return;
  var inv={id:Math.random().toString(36).slice(2,10),from:me.email,fromName:me.name,game:game,code:p.code,ts:Date.now()};
  sentAt[fv.uid]=Date.now(); render();
  acct(fv.uid).set({partyInbox:FV.arrayUnion(inv)},{merge:true})
    .then(function(){ toast("Invite sent to "+fv.name); })
    .catch(function(){ delete sentAt[fv.uid]; render(); toast("Couldn't send that invite."); });
}
function liveInvites(){
  return inbox.filter(function(i){ return i&&i.ts&&Date.now()-i.ts<INVITE_TTL&&GAMES[i.game]; })
    .sort(function(a,b){ return b.ts-a.ts; });
}
function dropInvite(inv){ if(me)acct(me.uid).set({partyInbox:FV.arrayRemove(inv)},{merge:true}).catch(function(){}); }
function pruneInbox(){
  inbox.forEach(function(i){ if(!i||!i.ts||Date.now()-i.ts>=INVITE_TTL)dropInvite(i); });
}
/* Same game: hand the code to the game. Another game: open it with ?join=.
   A game can refuse (returns false) when the player is mid-run. */
function joinParty(gameId,code){
  if(gameId===game&&adapter&&adapter.join){
    try{ return adapter.join(code)!==false; }catch(e){ return false; }
  }
  var g=GAMES[gameId]; if(!g||!g.page)return false;
  location.href=ROOT+g.page+"?join="+encodeURIComponent(code);
  return true;
}
function acceptInvite(inv){ if(joinParty(inv.game,inv.code)){ dropInvite(inv); hidePop(inv.id); } }
function seenSet(){ try{ return JSON.parse(lsGet("mlf:seen")||"{}"); }catch(e){ return {}; } }
function showNewInvites(){
  var seen=seenSet(), changed=false;
  liveInvites().forEach(function(inv){
    if(seen[inv.id])return;
    seen[inv.id]=Date.now(); changed=true; popInvite(inv);
  });
  if(changed){
    for(var k in seen)if(Date.now()-seen[k]>INVITE_TTL*2)delete seen[k];
    lsSet("mlf:seen",JSON.stringify(seen));
  }
}

/* ---------- profile: picture, username, stats, achievements ---------- */
function safeAvatar(a){
  return typeof a==="string"&&a.length<60000&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/.test(a)?a:"";
}
function loadQuackpot(uid){
  try{ var l=JSON.parse(lsGet("quackpot:v3")||"null"); if(l&&l.stats)qpSave=l; }catch(e){}
  db.collection("quackpot").doc(uid).get().then(function(s){
    var r=s.exists&&s.data()&&s.data().save; if(!r)return;
    var o=typeof r==="string"?JSON.parse(r):r;
    if(o&&o.stats&&(!qpSave||(o.lastSave||0)>=(qpSave.lastSave||0))){ qpSave=o; render(); }
  }).catch(function(){});
}
function starforgeStats(){
  try{
    var sv=JSON.parse(lsGet("starforge_save_v3")||"null"), key=lsGet("starforge_key");
    var ps=sv&&sv.room&&sv.room.players; if(!ps)return null;
    for(var id in ps)if(ps[id]&&ps[id].key===key)return ps[id];
  }catch(e){}
  return null;
}
function num(v){ v=+v; return isFinite(v)&&v>0?v:0; }
function fmt(n){
  n=num(n);
  if(n>=1e9)return (n/1e9).toFixed(n<1e10?1:0).replace(/\.0$/,"")+"B";
  if(n>=1e6)return (n/1e6).toFixed(n<1e7?1:0).replace(/\.0$/,"")+"M";
  if(n>=1e4)return (n/1e3).toFixed(n<1e5?1:0).replace(/\.0$/,"")+"K";
  return String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g,",");
}
function arrLen(a){ return a instanceof Array?a.length:0; }
function uniqMaps(a){ var o={}; (a instanceof Array?a:[]).forEach(function(k){ o[String(k).split(":")[0]]=1; }); return Object.keys(o).length; }
function gatherStats(){
  var g=(myDoc&&myDoc.games)||{}, ml=g.meatlad||{}, bd=g.beetdown||{}, aa=g.pantry||{};
  var qs=(qpSave&&qpSave.stats)||{}, sf=starforgeStats(), sfs=(sf&&sf.stats)||{};
  var S={
    ml:{cleared:arrLen(ml.cleared),deaths:num(ml.deaths),coins:num(ml.coins),bombWins:num(ml.bombWins),bombPlays:num(ml.bombPlays)},
    bd:{runs:num(bd.runs),best:num(bd.best),wins:num(bd.wins),kills:num(bd.kills),mats:num(bd.mats)},
    aa:{runs:num(aa.runs),wins:num(aa.wins),best:num(aa.best),pops:num(aa.pops),lvl:num(aa.playerLvl),maps:uniqMaps(aa.mapsBeat),
        ach:arrLen(aa.achUnlocked),hard:num(aa.hardWins),insane:num(aa.insaneWins),perfect:num(aa.perfectWins),bossPops:num(aa.bossPops)},
    qp:{ducks:num(qs.ducks),golden:num(qs.golden),bosses:num(qs.bosses),earned:num(qs.earned),combo:num(qs.bestCombo),ach:arrLen(qpSave&&qpSave.ach)},
    sf:{ore:num(sfs.ore),taps:num(sfs.taps),leaps:num(sfs.leaps),cores:num(sfs.cores),funded:num(sfs.funded)},
    friends:friends.length, avatar:!!safeAvatar(myDoc.avatar)
  };
  S.played={ml:S.ml.cleared>0||S.ml.deaths>0,bd:S.bd.runs>0,aa:S.aa.runs>0||S.aa.wins>0,qp:S.qp.ducks>0||S.qp.earned>0,sf:S.sf.taps>0||S.sf.ore>0};
  S.games=Object.keys(S.played).filter(function(k){ return S.played[k]; }).length;
  return S;
}
var GAME_ROWS=[
  ["ml","Meat Lad","#e8324a",function(s){ return [[fmt(s.cleared),"levels cleared"],[fmt(s.deaths),"deaths"],[fmt(s.coins),"coins"],[fmt(s.bombWins),"bomb wins"]]; }],
  ["bd","Beetdown","#7bd94a",function(s){ return [[fmt(s.runs),"runs"],[fmt(s.wins),"wins"],[fmt(s.best),"best wave"],[fmt(s.kills),"pests killed"]]; }],
  ["aa","Alien Attack","#4fc3ff",function(s){ return [[fmt(s.wins),"wins"],[fmt(s.lvl||1),"player level"],[fmt(s.maps),"maps beaten"],[fmt(s.pops),"pops"]]; }],
  ["qp","Quackpot","#ffd84a",function(s){ return [[fmt(s.ducks),"ducks"],[fmt(s.golden),"golden"],[fmt(s.bosses),"bosses"],[fmt(s.combo),"best combo"]]; }],
  ["sf","Starforge","#ffb03a",function(s){ return [[fmt(s.ore),"ore mined"],[fmt(s.taps),"taps"],[fmt(s.cores),"star cores"],[fmt(s.leaps),"leaps"]]; }]
];
/* [id, icon, name, how to earn, test] */
var ACHS=[
  ["first","🎮","First Steps","Play any game",function(s){ return s.games>=1; }],
  ["trio","🧭","Explorer","Play 3 different games",function(s){ return s.games>=3; }],
  ["all","👑","Arcade Regular","Play all 5 games",function(s){ return s.games>=5; }],
  ["ml5","🥩","Fresh Meat","Clear 5 Meat Lad levels",function(s){ return s.ml.cleared>=5; }],
  ["ml25","🔪","Meat Master","Clear 25 Meat Lad levels",function(s){ return s.ml.cleared>=25; }],
  ["mlDie","💀","Never Give Up","Die 500 times in Meat Lad",function(s){ return s.ml.deaths>=500; }],
  ["mlBomb","💣","Hot Potato","Win 5 Bomb rounds in Meat Lad",function(s){ return s.ml.bombWins>=5; }],
  ["bdWin","🌱","Root Defender","Win a Beetdown run",function(s){ return s.bd.wins>=1; }],
  ["bdKill","🪲","Pest Control","Kill 1,000 pests in Beetdown",function(s){ return s.bd.kills>=1000; }],
  ["bdWave","🌊","Wave Rider","Reach wave 20 in Beetdown",function(s){ return s.bd.best>=20; }],
  ["aaWin","🛸","Pantry Saver","Win an Alien Attack map",function(s){ return s.aa.wins>=1; }],
  ["aaHard","🔥","Hard Mode Hero","Win Alien Attack on Hard",function(s){ return s.aa.hard>=1; }],
  ["aaInsane","⚡","Insane","Win Alien Attack on Insane",function(s){ return s.aa.insane>=1; }],
  ["aaLvl","⭐","Veteran","Reach player level 20 in Alien Attack",function(s){ return s.aa.lvl>=20; }],
  ["qp100","🦆","Duck Hunter","Catch 100 ducks in Quackpot",function(s){ return s.qp.ducks>=100; }],
  ["qp10k","🏆","Duck Legend","Catch 10,000 ducks in Quackpot",function(s){ return s.qp.ducks>=10000; }],
  ["qpGold","✨","Golden Touch","Catch a golden duck",function(s){ return s.qp.golden>=1; }],
  ["qpBoss","🐉","Boss Plucker","Beat a Quackpot boss",function(s){ return s.qp.bosses>=1; }],
  ["sfOre","⛏️","Prospector","Mine 1M ore in Starforge",function(s){ return s.sf.ore>=1e6; }],
  ["sfLeap","🌌","Quantum Leaper","Make a Quantum Leap in Starforge",function(s){ return s.sf.leaps>=1; }],
  ["sfFund","🛠️","Patron","Fund the Forge Tree in Starforge",function(s){ return s.sf.funded>0; }],
  ["fr1","🤝","Friendly","Make a friend",function(s){ return s.friends>=1; }],
  ["fr5","🎉","Popular","Have 5 friends",function(s){ return s.friends>=5; }],
  ["pic","📸","Looking Good","Upload a profile picture",function(s){ return s.avatar; }]
];
function earned(S){ return ACHS.filter(function(a){ try{ return !!a[4](S); }catch(e){ return false; } }); }

var NAME_RE=/^[a-z0-9_]{3,20}$/;
function renameTo(raw){
  var n=String(raw||"").trim().toLowerCase();
  if(!me)return Promise.resolve("Sign in first.");
  if(!NAME_RE.test(n))return Promise.resolve("3-20 characters: letters, numbers and _ only.");
  if(n===me.name)return Promise.resolve("");
  var old=me.name, uid=me.uid, ref=db.collection("usernames").doc(n);
  return ref.get().then(function(s){
    if(s.exists&&s.data().uid!==uid)return "\""+n+"\" is taken. Try another.";
    return (s.exists?Promise.resolve():ref.set({email:me.email,uid:uid})).then(function(){
      return acct(uid).set({username:n},{merge:true});
    }).then(function(){
      if(!me||me.uid!==uid)return "";
      me.name=n; lsSet("mlf:name:"+uid,n); beat();
      var oldRef=db.collection("usernames").doc(old);
      oldRef.get().then(function(o){ if(o.exists&&o.data().uid===uid)return oldRef.delete(); }).catch(function(){});
      return "";
    });
  }).catch(function(){ return "Couldn't change your username. \""+n+"\" may be taken."; });
}

/* Square-crop, shrink to 128px and re-encode as JPEG until it is under 30 KB. */
var AV_MAX=30000;
function makeAvatar(file){
  return new Promise(function(res,rej){
    if(!file||!/^image\//.test(file.type))return rej("Pick an image file.");
    var url=URL.createObjectURL(file), img=new Image();
    img.onload=function(){
      URL.revokeObjectURL(url);
      var w=img.naturalWidth, h=img.naturalHeight, side=Math.min(w,h);
      if(!side)return rej("That image couldn't be read.");
      var sizes=[128,112,96,80], quals=[.85,.75,.65,.55,.45];
      for(var i=0;i<sizes.length;i++){
        var c=document.createElement("canvas"); c.width=c.height=sizes[i];
        var g=c.getContext("2d"); g.fillStyle="#1b1430"; g.fillRect(0,0,c.width,c.height);
        g.imageSmoothingQuality="high";
        g.drawImage(img,(w-side)/2,(h-side)/2,side,side,0,0,c.width,c.height);
        for(var j=0;j<quals.length;j++){
          var d=c.toDataURL("image/jpeg",quals[j]);
          if(d.length<AV_MAX&&safeAvatar(d))return res(d);
        }
      }
      rej("That picture is too detailed. Try another.");
    };
    img.onerror=function(){ URL.revokeObjectURL(url); rej("That image couldn't be read."); };
    img.src=url;
  });
}
var fileIn=null;
function pickAvatar(){
  if(!fileIn){
    fileIn=document.createElement("input"); fileIn.type="file"; fileIn.accept="image/*"; fileIn.style.display="none";
    fileIn.addEventListener("change",function(){
      var f=fileIn.files&&fileIn.files[0]; fileIn.value=""; if(!f||!me)return;
      toast("Uploading picture…");
      makeAvatar(f).then(function(d){
        return acct(me.uid).set({avatar:d},{merge:true}).then(function(){ toast("Profile picture updated"); });
      }).catch(function(e){ toast(typeof e==="string"?e:"Couldn't save that picture."); });
    });
    document.body.appendChild(fileIn);
  }
  fileIn.click();
}
function avHtml(name,avatar,cls){
  var a=safeAvatar(avatar);
  return '<div class="mlf-av'+(cls?" "+cls:"")+'">'+(a?'<img src="'+esc(a)+'" alt="">':esc(String(name||"?").charAt(0)))+
    (cls==="mlf-pav"?"":'<span class="mlf-dot"></span>')+'</div>';
}
function renderProfile(){
  var S=gatherStats(), got=earned(S), have={};
  got.forEach(function(a){ have[a[0]]=1; });
  var open=lsGet("mlf:stats")!=="0", av=safeAvatar(myDoc.avatar);
  var h='<div class="mlf-prof">';
  h+='<div class="mlf-ptop"><button class="mlf-pavb" data-a="pic" title="Change profile picture" aria-label="Change profile picture">'+
    avHtml(me.name,av,"mlf-pav")+'<span class="mlf-cam">✎</span></button><div class="mlf-who">';
  if(editName){
    h+='<div class="mlf-add"><input id="mlf-rn" maxlength="20" placeholder="new username" autocomplete="off" spellcheck="false" autocapitalize="off">'+
      '<button class="go" data-a="rnsave">Save</button></div>'+
      '<div class="mlf-err" id="mlf-rerr"></div><button class="mlf-link" data-a="rncancel">Cancel</button>';
  } else {
    h+='<div class="mlf-pname">'+esc(me.name)+'</div><div class="mlf-st">'+esc(me.email)+'</div>'+
      '<div class="mlf-pacts"><button data-a="rn">Change username</button>'+
      (av?'<button data-a="picrm" class="mlf-x">Remove photo</button>':'<button data-a="pic">Add photo</button>')+'</div>';
  }
  h+='</div></div>';
  h+='<button class="mlf-ptog" data-a="stats">Stats &amp; achievements · '+got.length+'/'+ACHS.length+'<span class="mlf-chev'+(open?"":" up")+'">▾</span></button>';
  if(open){
    h+='<div class="mlf-stats">';
    var any=false;
    GAME_ROWS.forEach(function(r){
      if(!S.played[r[0]])return; any=true;
      h+='<div class="mlf-game" style="--gc:'+r[2]+'"><div class="mlf-gname">'+esc(r[1])+'</div><div class="mlf-nums">';
      r[3](S[r[0]]).forEach(function(c){ h+='<div><b>'+esc(c[0])+'</b><span>'+esc(c[1])+'</span></div>'; });
      h+='</div></div>';
    });
    if(!any)h+='<div class="mlf-note">No stats yet. Play a game while signed in and they\'ll show up here.</div>';
    h+='<div class="mlf-badges">';
    ACHS.forEach(function(a){
      var ok=!!have[a[0]];
      h+='<button class="mlf-badge'+(ok?" on":"")+'" data-a="badge" data-id="'+esc(a[0])+'" title="'+esc(a[2]+": "+a[3])+'">'+
        '<span class="i">'+a[1]+'</span><span class="n">'+esc(a[2])+'</span></button>';
    });
    h+='</div><div class="mlf-note" style="font-size:10.5px">Starforge stats are from this device.</div></div>';
  }
  h+='</div>';
  return h;
}

/* ---------- UI ---------- */
var CSS=[
".mlf,.mlf *{box-sizing:border-box;font-family:'Trebuchet MS',Verdana,system-ui,sans-serif}",
".mlf{--mlf-bg:rgba(16,12,26,.94);--mlf-line:rgba(255,255,255,.1);--mlf-ink:#f2ecff;--mlf-soft:#9c90bd;--mlf-on:#5ef28a;--mlf-acc:#e0247a;color:var(--mlf-ink)}",
".mlf button{font:inherit;cursor:pointer;border:1px solid var(--mlf-line);background:rgba(255,255,255,.06);color:var(--mlf-ink);border-radius:9px;padding:6px 10px;font-size:12px;font-weight:700;letter-spacing:.03em;transition:background .15s,border-color .15s,transform .08s}",
".mlf button:hover:not(:disabled){background:rgba(255,255,255,.13);border-color:rgba(255,255,255,.28)}",
".mlf button:active:not(:disabled){transform:scale(.96)}",
".mlf button:disabled{opacity:.45;cursor:default}",
".mlf button.go{background:linear-gradient(135deg,#e0247a,#a01a8a);border-color:transparent}",
".mlf button.go:hover:not(:disabled){background:linear-gradient(135deg,#f0388a,#b42a9c)}",
".mlf-panel{position:fixed;z-index:9000;background:var(--mlf-bg);border:1px solid var(--mlf-line);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);box-shadow:0 18px 50px rgba(0,0,0,.55)}",
".mlf-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--mlf-line)}",
".mlf-title{font-weight:900;letter-spacing:.14em;text-transform:uppercase;font-size:12px;flex:1}",
".mlf-count{font-size:11px;color:var(--mlf-on);font-weight:700;letter-spacing:.04em}",
".mlf-body{padding:10px 12px 12px;overflow-y:auto}",
".mlf-note{font-size:12px;color:var(--mlf-soft);line-height:1.5;padding:4px 2px}",
".mlf-err{font-size:11.5px;color:#ff7a8a;min-height:15px;padding:3px 2px 0}",
".mlf-add{display:flex;gap:6px}",
".mlf-add input{flex:1;min-width:0;background:rgba(0,0,0,.35);border:1px solid var(--mlf-line);color:var(--mlf-ink);border-radius:9px;padding:8px 10px;font-size:13px;outline:none;-webkit-user-select:text;user-select:text}",
".mlf-add input:focus{border-color:rgba(224,36,122,.7)}",
".mlf-sect{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--mlf-soft);margin:12px 2px 6px;font-weight:700}",
".mlf-row{display:flex;align-items:center;gap:9px;padding:7px 6px;border-radius:10px;transition:background .15s}",
".mlf-row:hover{background:rgba(255,255,255,.04)}",
".mlf-row.off{opacity:.55}",
".mlf-av{width:30px;height:30px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:900;font-size:13px;position:relative;background:linear-gradient(135deg,#3b2a63,#1b1430);text-transform:uppercase}",
".mlf-dot{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;background:#5a5470;border:2px solid #120d1e}",
".mlf-row.on .mlf-dot{background:var(--mlf-on);box-shadow:0 0 8px var(--mlf-on)}",
".mlf-who{flex:1;min-width:0}",
".mlf-name{font-weight:800;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
".mlf-st{font-size:11px;color:var(--mlf-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
".mlf-row.on .mlf-st{color:#a8f0c0}",
".mlf-x{padding:4px 8px!important;font-size:11px!important;opacity:.6}",
".mlf-x:hover{opacity:1}",
".mlf-inv{background:linear-gradient(135deg,rgba(224,36,122,.18),rgba(123,217,74,.08));border:1px solid rgba(224,36,122,.4);border-radius:12px;padding:9px 10px;margin-bottom:6px;display:flex;gap:8px;align-items:center;font-size:12px}",
".mlf-inv b{font-weight:900}",
/* menu: a side drawer with a tab that is always visible on the right edge */
".mlf-menu{top:50%;right:0;transform:translate(100%,-50%);width:310px;max-height:min(720px,90vh);display:flex;flex-direction:column;border-radius:16px 0 0 16px;transition:transform .28s cubic-bezier(.2,.8,.2,1)}",
".mlf-menu.open{transform:translate(0,-50%)}",
".mlf-tab{position:absolute;left:-40px;top:50%;transform:translateY(-50%);width:40px;padding:14px 0!important;border-radius:12px 0 0 12px!important;border-right:none!important;background:var(--mlf-bg)!important;writing-mode:vertical-rl;text-orientation:mixed;letter-spacing:.2em!important;text-transform:uppercase;font-size:11px!important;display:flex;align-items:center;gap:8px}",
".mlf-tab i{width:8px;height:8px;border-radius:50%;background:var(--mlf-on);box-shadow:0 0 8px var(--mlf-on);font-style:normal}",
"@media(min-width:1680px){.mlf-menu{transform:translate(0,-50%)}.mlf-menu .mlf-tab{display:none}.mlf-menu .mlf-close{display:none}}",
/* in-game: a compact list on the left edge, collapsible to a pill */
".mlf-mini{left:10px;top:50%;transform:translateY(-50%);width:230px;max-height:60vh;display:flex;flex-direction:column;border-radius:14px}",
".mlf-mini.mlf-bl{top:auto;bottom:12px;transform:none;max-height:40vh}",
".mlf-mini .mlf-head{padding:9px 11px;cursor:pointer}",
".mlf-mini .mlf-body{padding:6px 8px 8px}",
".mlf-mini.min{width:auto}",
".mlf-mini.min .mlf-body{display:none}",
".mlf-mini.min .mlf-head{border-bottom:none}",
".mlf-mini .mlf-row{padding:5px 4px}",
".mlf-mini .mlf-av{width:24px;height:24px;font-size:11px}",
".mlf-chev{font-size:11px;color:var(--mlf-soft);transition:transform .2s}",
".mlf-mini.min .mlf-chev{transform:rotate(180deg)}",
/* invite pop-up */
".mlf-pops{position:fixed;z-index:9100;top:14px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;width:min(360px,calc(100vw - 32px));pointer-events:none}",
".mlf-pop{pointer-events:auto;background:var(--mlf-bg);border:1px solid rgba(224,36,122,.55);border-radius:14px;padding:12px 14px;box-shadow:0 14px 40px rgba(0,0,0,.6),0 0 24px rgba(224,36,122,.25);animation:mlfPop .35s cubic-bezier(.2,.9,.3,1.3)}",
".mlf-pop p{font-size:13px;line-height:1.45;margin:0 0 9px}",
".mlf-pop .acts{display:flex;gap:8px;justify-content:flex-end}",
".mlf-toast{position:fixed;z-index:9100;bottom:18px;left:50%;transform:translateX(-50%);background:var(--mlf-bg);border:1px solid var(--mlf-line);border-radius:999px;padding:8px 16px;font-size:12.5px;animation:mlfIn .3s ease-out}",
"@keyframes mlfIn{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}",
"@keyframes mlfPop{from{opacity:0;transform:translateY(-12px) scale(.96)}to{opacity:1;transform:none}}",
"/* profile card + friend requests (menu) */",
".mlf-av img{width:100%;height:100%;border-radius:50%;object-fit:cover;display:block}",
".mlf-prof{background:linear-gradient(160deg,rgba(224,36,122,.14),rgba(79,195,255,.06));border:1px solid var(--mlf-line);border-radius:14px;padding:11px;margin-bottom:10px}",
".mlf-ptop{display:flex;gap:11px;align-items:flex-start}",
".mlf .mlf-pavb{padding:0;border:none;background:none;position:relative;border-radius:50%;flex:none}",
".mlf .mlf-pavb:hover:not(:disabled){background:none}",
".mlf-pav{width:56px;height:56px;font-size:24px;box-shadow:0 0 0 2px rgba(224,36,122,.7),0 6px 18px rgba(0,0,0,.45)}",
".mlf-cam{position:absolute;right:-2px;bottom:-2px;width:20px;height:20px;border-radius:50%;background:#e0247a;display:grid;place-items:center;font-size:11px;border:2px solid #120d1e}",
".mlf-pname{font-weight:900;font-size:16px;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
".mlf-pacts{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}",
".mlf-pacts button{padding:5px 8px;font-size:11px}",
".mlf .mlf-link{background:none;border:none;padding:2px 0;color:var(--mlf-soft);font-size:11px;text-decoration:underline}",
".mlf .mlf-ptog{width:100%;margin-top:10px;display:flex;justify-content:space-between;align-items:center;background:rgba(0,0,0,.25);font-size:11px;letter-spacing:.08em;text-transform:uppercase}",
".mlf-chev.up{transform:rotate(180deg)}",
".mlf-stats{margin-top:8px;display:flex;flex-direction:column;gap:6px}",
".mlf-game{border-left:3px solid var(--gc);background:rgba(0,0,0,.25);border-radius:8px;padding:6px 8px}",
".mlf-gname{font-size:10.5px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--gc);margin-bottom:3px}",
".mlf-nums{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}",
".mlf-nums div{min-width:0;display:flex;flex-direction:column}",
".mlf-nums b{font-size:13px;font-weight:900}",
".mlf-nums span{font-size:9.5px;color:var(--mlf-soft);line-height:1.15}",
".mlf-badges{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:4px}",
".mlf .mlf-badge{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 2px;border-radius:10px;background:rgba(0,0,0,.3);filter:grayscale(1);opacity:.38;min-width:0}",
".mlf .mlf-badge.on{filter:none;opacity:1;background:linear-gradient(135deg,rgba(224,36,122,.3),rgba(255,176,58,.18));border-color:rgba(255,190,90,.45)}",
".mlf-badge .i{font-size:18px;line-height:1}",
".mlf-badge .n{font-size:8.5px;letter-spacing:0;text-transform:none;font-weight:700;line-height:1.1;text-align:center;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
".mlf-req{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:12px;margin-bottom:6px;background:rgba(94,242,138,.08);border:1px solid rgba(94,242,138,.35)}",
".mlf-req .mlf-who b{font-weight:900}",
".mlf-req.out{background:rgba(255,255,255,.03);border-color:var(--mlf-line)}",
".mlf-tab b{writing-mode:horizontal-tb;background:#e0247a;border-radius:999px;font-size:10px;min-width:16px;padding:1px 4px;letter-spacing:0}",
"@media(max-width:640px){.mlf-menu{width:min(320px,90vw)}.mlf-mini{top:auto;bottom:10px;transform:none;max-height:45vh;width:210px}}"
].join("\n");

var panel=null, pops=null;
function ensureDom(){
  if(panel)return;
  var st=document.createElement("style"); st.id="mlf-css"; st.textContent=CSS; document.head.appendChild(st);
  panel=document.createElement("div");
  panel.className="mlf mlf-panel "+(mode==="menu"?"mlf-menu":"mlf-mini");
  if(mode==="mini"&&lsGet("mlf:min:"+game)==="1")panel.classList.add("min");
  if(mode==="mini"&&adapter&&adapter.dock==="bottom-left")panel.classList.add("mlf-bl");
  document.body.appendChild(panel);
  pops=document.createElement("div"); pops.className="mlf mlf-pops"; document.body.appendChild(pops);
  panel.addEventListener("click",onClick);
  panel.addEventListener("keydown",function(e){
    if(e.key==="Enter"&&e.target.id==="mlf-in")doAdd();
    else if(e.key==="Enter"&&e.target.id==="mlf-rn")doRename();
    else if(e.key==="Escape"&&e.target.id==="mlf-rn"){ editName=false; lastHtml=""; render(); }
    e.stopPropagation(); });
  panel.addEventListener("keyup",function(e){ e.stopPropagation(); });
  ["pointerdown","mousedown","touchstart","wheel"].forEach(function(t){
    panel.addEventListener(t,function(e){ e.stopPropagation(); },{passive:true}); });
}

function rowHtml(f,actions){
  return '<div class="mlf-row'+(f.online?" on":" off")+'">'+
    avHtml(f.name,f.avatar)+
    '<div class="mlf-who"><div class="mlf-name">'+esc(f.name)+'</div><div class="mlf-st">'+esc(f.status)+'</div></div>'+
    actions+'</div>';
}

function renderMenu(){
  var n=onlineCount(), html="", inc=status==="in"?incoming():[];
  html+='<button class="mlf-tab" data-a="toggle">Friends'+(inc.length?'<b>'+inc.length+'</b>':n?'<i></i>':"")+'</button>';
  html+='<div class="mlf-head"><div class="mlf-title">Friends</div>'+
    (status==="in"&&friends.length?'<div class="mlf-count">'+n+' online</div>':"")+
    '<button class="mlf-close mlf-x" data-a="toggle" aria-label="Close">✕</button></div>';
  html+='<div class="mlf-body">';
  if(status==="loading")html+='<div class="mlf-note">Loading…</div>';
  else if(status==="error")html+='<div class="mlf-note">'+esc(errMsg)+'</div>';
  else if(status==="out")html+='<div class="mlf-note">Sign in with the account box at the top of this page to add friends, see who\'s online and get party invites in every online game.</div>';
  else{
    html+=renderProfile();
    if(inc.length){
      html+='<div class="mlf-sect">Friend requests · '+inc.length+'</div>';
      inc.forEach(function(r){
        html+='<div class="mlf-req">'+avHtml(r.name||shortName(r.from),"")+'<div class="mlf-who"><div class="mlf-name">'+
          esc(r.name||shortName(r.from))+'</div><div class="mlf-st">wants to be friends</div></div>'+
          '<button class="go" data-a="racc" data-id="'+esc(r.id)+'">Accept</button>'+
          '<button class="mlf-x" data-a="rdec" data-id="'+esc(r.id)+'" title="Decline" aria-label="Decline">✕</button></div>';
      });
    }
    html+='<div class="mlf-add"><input id="mlf-in" maxlength="60" placeholder="Username or email" autocomplete="off" spellcheck="false">'+
      '<button class="go" data-a="add">Add friend</button></div><div class="mlf-err" id="mlf-err"></div>';
    var invs=liveInvites();
    if(invs.length){
      html+='<div class="mlf-sect">Invites</div>';
      invs.forEach(function(i){
        html+='<div class="mlf-inv"><div style="flex:1"><b>'+esc(i.fromName||shortName(i.from))+'</b> invited you to '+
          esc(gameName(i.game))+'</div><button class="go" data-a="accept" data-id="'+esc(i.id)+'">Join</button>'+
          '<button class="mlf-x" data-a="decline" data-id="'+esc(i.id)+'">✕</button></div>';
      });
    }
    html+='<div class="mlf-sect">Your friends'+(friends.length?" · "+friends.length:"")+'</div>';
    if(!friends.length)html+='<div class="mlf-note">No friends yet. Add one by their username - they\'ll get a request to accept.</div>';
    sortedFriends().forEach(function(f){
      var acts="";
      if(f.party)acts+='<button class="go" data-a="joinf" data-e="'+esc(f.entry)+'">Join</button>';
      acts+='<button class="mlf-x" data-a="rm" data-e="'+esc(f.entry)+'" title="Remove">✕</button>';
      html+=rowHtml(f,acts);
    });
    if(sent.length){
      html+='<div class="mlf-sect">Sent requests · '+sent.length+'</div>';
      sent.forEach(function(r){
        html+='<div class="mlf-req out">'+avHtml(r.name||shortName(r.to),"")+'<div class="mlf-who"><div class="mlf-name">'+
          esc(r.name||shortName(r.to))+'</div><div class="mlf-st">waiting for them to accept</div></div>'+
          '<button class="mlf-x" data-a="rcan" data-id="'+esc(r.id)+'">Cancel</button></div>';
      });
    }
    html+='<div class="mlf-note" style="margin-top:10px">Signed in as <b>'+esc(me.name)+'</b>. Friends follow you into Meat Lad, Beetdown, Alien Attack and Starforge.</div>';
  }
  html+='</div>';
  return html;
}

function renderMini(){
  var p=safeParty(), n=onlineCount();
  var html='<div class="mlf-head" data-a="min"><div class="mlf-title">Friends</div>'+
    (status==="in"?'<div class="mlf-count">'+n+' on</div>':"")+'<span class="mlf-chev">▾</span></div><div class="mlf-body">';
  if(status!=="in"){
    html+='<div class="mlf-note">'+(status==="error"?esc(errMsg):status==="loading"?"Loading…":
      'Sign in on the <a href="'+ROOT+'" style="color:#ff7eb6">main menu</a> to invite friends here.')+'</div>';
  } else if(!friends.length){
    html+='<div class="mlf-note">No friends yet. Add them from the main menu.</div>';
  } else {
    sortedFriends().forEach(function(f){
      var sent=f.uid&&sentAt[f.uid]&&Date.now()-sentAt[f.uid]<20000;
      var here=f.party&&p&&f.party.game===game&&f.party.code===p.code;
      var btn=here?'<button disabled>In party</button>':
        f.online?'<button class="go" data-a="inv" data-e="'+esc(f.entry)+'"'+(sent?" disabled":"")+'>'+(sent?"Sent ✓":"Invite")+'</button>':
        '';
      html+=rowHtml(f,btn);
    });
  }
  html+='</div>';
  return html;
}

var lastHtml="";
function render(){
  if(!mode)return;
  ensureDom();
  if(mode==="mini"){
    var show=miniVisible();
    panel.style.display=show?"":"none";
    if(!show)return;
  }
  // Keep the add-friend field (and its focus) intact across re-renders.
  var keep={};
  ["mlf-in","mlf-rn","mlf-err","mlf-rerr"].forEach(function(id){
    var el=$(id); if(el)keep[id]={v:el.tagName==="INPUT"?el.value:el.textContent,f:document.activeElement===el};
  });
  var html=mode==="menu"?renderMenu():renderMini();
  if(html===lastHtml)return;
  var scroll=panel.querySelector(".mlf-body"), top=scroll?scroll.scrollTop:0;
  lastHtml=html; panel.innerHTML=html;
  for(var id in keep){
    var el=$(id); if(!el)continue;
    if(el.tagName==="INPUT"){ el.value=keep[id].v; if(keep[id].f)el.focus(); } else el.textContent=keep[id].v;
  }
  scroll=panel.querySelector(".mlf-body"); if(scroll)scroll.scrollTop=top;
}

function entryFromBtn(b){ return b.getAttribute("data-e"); }
function onClick(e){
  var b=e.target.closest("[data-a]"); if(!b||b.disabled)return;
  var a=b.getAttribute("data-a");
  if(a==="toggle")panel.classList.toggle("open");
  else if(a==="min"){ panel.classList.toggle("min"); lsSet("mlf:min:"+game,panel.classList.contains("min")?"1":"0"); }
  else if(a==="add")doAdd();
  else if(a==="racc"||a==="rdec"){
    var r=reqs.filter(function(x){ return x.id===b.getAttribute("data-id")&&x.type==="req"; })[0];
    if(r){ if(a==="racc"){ b.disabled=true; acceptRequest(r).then(function(){ toast("You're now friends with "+(r.name||shortName(r.from))); },function(){ toast("Couldn't accept that request."); }); } else declineRequest(r); }
  }
  else if(a==="rcan"){ var sr=sent.filter(function(x){ return x.id===b.getAttribute("data-id"); })[0]; if(sr)cancelRequest(sr); }
  else if(a==="pic")pickAvatar();
  else if(a==="picrm"){
    if(b.getAttribute("data-sure")){ acct(me.uid).set({avatar:""},{merge:true}).catch(function(){}); }
    else{ b.setAttribute("data-sure","1"); b.textContent="Remove?"; setTimeout(function(){ lastHtml=""; render(); },2500); }
  }
  else if(a==="rn"){ editName=true; lastHtml=""; render(); var ri=$("mlf-rn"); if(ri){ ri.value=me.name; ri.focus(); ri.select(); } }
  else if(a==="rncancel"){ editName=false; lastHtml=""; render(); }
  else if(a==="rnsave")doRename();
  else if(a==="stats"){ lsSet("mlf:stats",lsGet("mlf:stats")==="0"?"1":"0"); lastHtml=""; render(); }
  else if(a==="badge"){ var ac=ACHS.filter(function(x){ return x[0]===b.getAttribute("data-id"); })[0];
    if(ac)toast(ac[1]+" "+ac[2]+" - "+ac[3]+(b.classList.contains("on")?" ✓":"")); }
  else if(a==="rm"){
    if(b.getAttribute("data-sure")){ removeFriend(entryFromBtn(b)); }
    else{ b.setAttribute("data-sure","1"); b.textContent="Remove?"; setTimeout(function(){ lastHtml=""; render(); },2500); }
  }
  else if(a==="inv")invite(friendView(entryFromBtn(b)));
  else if(a==="joinf"){ var f=friendView(entryFromBtn(b)); if(f.party)joinParty(f.party.game,f.party.code); }
  else if(a==="accept"||a==="decline"){
    var id=b.getAttribute("data-id"), inv=inbox.filter(function(i){return i.id===id;})[0];
    if(inv){ if(a==="accept")acceptInvite(inv); else{ dropInvite(inv); hidePop(id); } }
  }
}
function doAdd(){
  var inp=$("mlf-in"), err=$("mlf-err"); if(!inp)return;
  var v=inp.value; err.textContent="Looking…";
  addFriend(v).then(function(msg){
    var ok=msg.indexOf("ok:")===0, e2=$("mlf-err");
    if(e2)e2.textContent=ok?"":msg;
    if(ok){ var i2=$("mlf-in"); if(i2)i2.value=""; toast(msg.slice(3)); }
  });
}
function doRename(){
  var inp=$("mlf-rn"), err=$("mlf-rerr"); if(!inp)return;
  err.textContent="Checking…";
  renameTo(inp.value).then(function(msg){
    if(msg){ var e2=$("mlf-rerr"); if(e2)e2.textContent=msg; return; }
    editName=false; lastHtml=""; render(); toast("You're now "+me.name);
  });
}

function popInvite(inv){
  ensureDom();
  var d=document.createElement("div"); d.className="mlf-pop"; d.setAttribute("data-pop",inv.id);
  d.innerHTML='<p><b>'+esc(inv.fromName||shortName(inv.from))+'</b> invited you to their '+esc(gameName(inv.game))+' party.</p>'+
    '<div class="acts"><button data-a="no">Not now</button><button class="go" data-a="yes">Join party</button></div>';
  d.addEventListener("click",function(e){
    var b=e.target.closest("[data-a]"); if(!b)return;
    if(b.getAttribute("data-a")==="yes")acceptInvite(inv); else hidePop(inv.id);
  });
  pops.appendChild(d);
  setTimeout(function(){ hidePop(inv.id); },25000);
}
function hidePop(id){
  if(!pops)return;
  var el=pops.querySelector('[data-pop="'+id+'"]'); if(el)el.remove();
}
var toastT=null;
function toast(msg){
  ensureDom();
  var t=document.querySelector(".mlf-toast");
  if(!t){ t=document.createElement("div"); t.className="mlf mlf-toast"; document.body.appendChild(t); }
  t.textContent=msg; t.style.display="";
  clearTimeout(toastT); toastT=setTimeout(function(){ t.style.display="none"; },2600);
}

/* ---------- public API ---------- */
function boot(){
  if(document.body)start(); else document.addEventListener("DOMContentLoaded",start);
  tickT=setInterval(function(){ lastHtml=""; render(); },15000);
}
window.MLFriends={
  /* Full side panel for the main menu. */
  menu:function(){ game="menu"; mode="menu"; boot(); },
  /* In-game hook-up. opts: {game, party:()=>({code})|null, join:(code)=>bool,
     visible?:()=>bool, onFriends?:(list)=>void} */
  attach:function(opts){
    game=opts.game; adapter=opts; mode="mini"; boot();
    var lastVis=null;
    partyT=setInterval(function(){
      var p=safeParty(), code=p?p.code:null, vis=miniVisible();
      if(code!==lastParty){ beat(); lastHtml=""; render(); }
      else if(vis!==lastVis){ lastHtml=""; render(); }
      lastVis=vis;
    },PARTY_POLL_MS);
    // Arriving from an invite on another page: ?join=CODE
    var m=/[?&]join=([A-Za-z0-9]+)/.exec(location.search);
    if(m&&opts.join){
      try{ history.replaceState(null,"",location.pathname+location.search.replace(/([?&])join=[^&]*&?/,"$1").replace(/[?&]$/,"")+location.hash); }catch(e){}
      setTimeout(function(){ try{ opts.join(m[1].toUpperCase()); }catch(e){} },700);
    }
  },
  /* The signed-in player's display name and email, or null. */
  me:function(){ return me?{name:me.name,email:me.email}:null; },
  games:GAMES
};
})();
