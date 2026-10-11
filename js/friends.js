/* ═════════════ FRIENDS + PARTY INVITES (shared by every online game) ═════════════
   One friends list for the whole site, on the same Firebase account the menu,
   Meat Lad, Beetdown and Alien Attack already sign into.

   Everything lives on the player's existing accounts/{uid} document, so it
   works under the same Firestore rules the games already rely on:
     friends      array of friend emails (the same array Beetdown and Meat Lad use)
     presence     {ts, game, name, party}  heartbeat every 30 s; online = seen < 75 s ago
     partyInbox   array of invites {id, from, fromName, game, code, ts}, newest last

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
  if(beatT)clearInterval(beatT); beatT=null;
}
function signedIn(u){
  var email=String(u.email||"").toLowerCase();
  me={uid:u.uid,email:email,name:lsGet("mlf:name:"+u.uid)||shortName(email)};
  status="in"; render();
  // A friendly display name: the username picked at sign-up, if there is one.
  db.collection("usernames").where("uid","==",u.uid).limit(1).get().then(function(q){
    if(!q.empty&&me&&me.uid===u.uid){ me.name=q.docs[0].id; lsSet("mlf:name:"+u.uid,me.name); beat(); render(); }
  }).catch(function(){});
  beat();
  beatT=setInterval(beat,BEAT_MS);
  unsubs.push(acct(u.uid).onSnapshot(function(snap){
    var d=snap.exists?snap.data():{};
    var list=(d.friends instanceof Array)?d.friends.slice():[];
    inbox=(d.partyInbox instanceof Array)?d.partyInbox.slice():[];
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
          info[entry].uid=doc.id; info[entry].presence=d.presence||null;
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
  return {entry:entry,uid:f.uid,name:name,online:online,status:st,
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

function addFriend(raw){
  raw=String(raw||"").trim().toLowerCase().replace(/^@/,"");
  if(!me)return Promise.resolve("Sign in first.");
  if(!raw)return Promise.resolve("Type a username or email.");
  return resolveEntry(raw).then(function(email){
    if(!email)return raw.indexOf("@")>=0?"No account with that email.":"No player called \""+raw+"\".";
    if(email===me.email)return "That's you.";
    for(var i=0;i<friends.length;i++)
      if(friends[i]===email||(info[friends[i]]&&info[friends[i]].email===email))return "Already on your list.";
    return acct(me.uid).set({friends:FV.arrayUnion(email)},{merge:true}).then(function(){ return ""; });
  }).catch(function(){ return "Couldn't add that friend."; });
}
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
".mlf-menu{top:50%;right:0;transform:translate(100%,-50%);width:290px;max-height:min(620px,86vh);display:flex;flex-direction:column;border-radius:16px 0 0 16px;transition:transform .28s cubic-bezier(.2,.8,.2,1)}",
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
"@media(max-width:640px){.mlf-menu{width:min(300px,86vw)}.mlf-mini{top:auto;bottom:10px;transform:none;max-height:45vh;width:210px}}"
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
  panel.addEventListener("keydown",function(e){ if(e.key==="Enter"&&e.target.id==="mlf-in")doAdd(); e.stopPropagation(); });
  panel.addEventListener("keyup",function(e){ e.stopPropagation(); });
  ["pointerdown","mousedown","touchstart","wheel"].forEach(function(t){
    panel.addEventListener(t,function(e){ e.stopPropagation(); },{passive:true}); });
}

function rowHtml(f,actions){
  return '<div class="mlf-row'+(f.online?" on":" off")+'">'+
    '<div class="mlf-av">'+esc(f.name.charAt(0))+'<span class="mlf-dot"></span></div>'+
    '<div class="mlf-who"><div class="mlf-name">'+esc(f.name)+'</div><div class="mlf-st">'+esc(f.status)+'</div></div>'+
    actions+'</div>';
}

function renderMenu(){
  var n=onlineCount(), html="";
  html+='<button class="mlf-tab" data-a="toggle">Friends'+(n?'<i></i>':"")+'</button>';
  html+='<div class="mlf-head"><div class="mlf-title">Friends</div>'+
    (status==="in"&&friends.length?'<div class="mlf-count">'+n+' online</div>':"")+
    '<button class="mlf-close mlf-x" data-a="toggle" aria-label="Close">✕</button></div>';
  html+='<div class="mlf-body">';
  if(status==="loading")html+='<div class="mlf-note">Loading…</div>';
  else if(status==="error")html+='<div class="mlf-note">'+esc(errMsg)+'</div>';
  else if(status==="out")html+='<div class="mlf-note">Sign in with the account box at the top of this page to add friends, see who\'s online and get party invites in every online game.</div>';
  else{
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
    if(!friends.length)html+='<div class="mlf-note">No friends yet. Add one by the username they picked when they signed up.</div>';
    sortedFriends().forEach(function(f){
      var acts="";
      if(f.party)acts+='<button class="go" data-a="joinf" data-e="'+esc(f.entry)+'">Join</button>';
      acts+='<button class="mlf-x" data-a="rm" data-e="'+esc(f.entry)+'" title="Remove">✕</button>';
      html+=rowHtml(f,acts);
    });
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
  var input=$("mlf-in"), val=input?input.value:"", focused=input&&document.activeElement===input;
  var errEl=$("mlf-err"), err=errEl?errEl.textContent:"";
  var html=mode==="menu"?renderMenu():renderMini();
  if(html===lastHtml)return;
  lastHtml=html; panel.innerHTML=html;
  if($("mlf-in")){ $("mlf-in").value=val; if(focused)$("mlf-in").focus(); }
  if($("mlf-err"))$("mlf-err").textContent=err;
}

function entryFromBtn(b){ return b.getAttribute("data-e"); }
function onClick(e){
  var b=e.target.closest("[data-a]"); if(!b||b.disabled)return;
  var a=b.getAttribute("data-a");
  if(a==="toggle")panel.classList.toggle("open");
  else if(a==="min"){ panel.classList.toggle("min"); lsSet("mlf:min:"+game,panel.classList.contains("min")?"1":"0"); }
  else if(a==="add")doAdd();
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
    var e2=$("mlf-err"); if(e2)e2.textContent=msg;
    if(!msg){ var i2=$("mlf-in"); if(i2)i2.value=""; toast("Friend added"); }
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
