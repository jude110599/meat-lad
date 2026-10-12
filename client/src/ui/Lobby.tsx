import { useEffect, useState } from 'react';
import { NODE_IDS, fmt, has } from '@starforge/shared';
import { SLOTS, deleteSlot, exitToTitle, joinParty, loadSave, openParty, selectSlot, slotUsed, startLocal, usesServer } from '../net/session';
import { useGame, type Slot } from '../state/store';
import { Changelog } from './Changelog';
import { ConfirmButton, Icon } from './common';
import { FriendList } from './Friends';
import { friendsName } from './friends';
import { HowTo } from './Menu';

function store(key: string, v?: string): string | null {
  try {
    if (v === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
  return null;
}

/** "just now", "12m ago", "3h ago", "5d ago". */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

type View = 'home' | 'solo' | 'multi' | 'host' | 'join';

/** One save slot: what's in it, with Continue / Start new and a two-tap delete. */
function SlotCard({ n, verb, onGo, onChange }: { n: Slot; verb: 'play' | 'host'; onGo: (n: Slot) => void; onChange: () => void }) {
  const selected = useGame((st) => st.slot === n);
  const save = loadSave(n);
  const used = slotUsed(n);
  const mine = save?.mine;
  const nodes = save ? NODE_IDS.filter((id) => has(save.state, id)).length : 0;
  const crew = save ? Object.keys(save.state.players).length : 0;
  const go = save ? (verb === 'host' ? 'Host' : 'Continue') : verb === 'host' ? 'Host new' : 'Start new';
  return (
    <div className={'slot' + (selected ? ' sel' : '') + (save ? '' : ' empty')} onClick={() => selectSlot(n)}>
      <div className="slot-n">
        <small>Slot</small>
        <b>{n}</b>
      </div>
      <div className="slot-info">
        {save ? (
          <>
            <b>
              <i className="gem" /> {fmt(mine?.wallet.ore ?? 0)} ore
              {(mine?.wallet.cores ?? 0) > 0 && <em> · ★{fmt(mine!.wallet.cores)}</em>}
            </b>
            <span>
              Forge Tree {nodes}/{NODE_IDS.length}
              {crew > 1 ? ` · ${crew} crew` : ''}
              {mine && mine.stats.leaps > 0 ? ` · ${mine.stats.leaps} leap${mine.stats.leaps === 1 ? '' : 's'}` : ''}
            </span>
            <small>Last played {ago(save.savedAt)}</small>
          </>
        ) : used ? (
          <>
            <b>Unreadable save</b>
            <span>From another version. Delete it to reuse the slot.</span>
          </>
        ) : (
          <>
            <b>Empty slot</b>
            <span>A fresh planet and an empty Forge Tree.</span>
          </>
        )}
      </div>
      <div className="slot-acts" onClick={(e) => e.stopPropagation()}>
        {used && (
          <ConfirmButton
            className="slot-del"
            armed={<>Delete?</>}
            onConfirm={() => {
              deleteSlot(n);
              onChange();
            }}
          >
            <Icon name="trash" />
            <span className="sr">Delete slot {n}</span>
          </ConfirmButton>
        )}
        {(save || !used) && (
          <button
            className={'slot-go' + (save ? '' : ' new')}
            onClick={() => {
              selectSlot(n);
              onGo(n);
            }}
          >
            {save ? <Icon name={verb === 'host' ? 'host' : 'play'} /> : <Icon name="plus" />}
            {go}
          </button>
        )}
      </div>
    </div>
  );
}

function SlotList({ verb, onGo }: { verb: 'play' | 'host'; onGo: (n: Slot) => void }) {
  const [, setRev] = useState(0);
  return (
    <div className="slots">
      {SLOTS.map((n) => (
        <SlotCard key={n} n={n} verb={verb} onGo={onGo} onChange={() => setRev((r) => r + 1)} />
      ))}
    </div>
  );
}

function Head({ title, sub, onBack }: { title: string; sub: string; onBack: () => void }) {
  return (
    <div className="lhead">
      <button className="lback" onClick={onBack} aria-label="Back">
        <Icon name="back" />
      </button>
      <div>
        <h2>{title}</h2>
        <p>{sub}</p>
      </div>
    </div>
  );
}

export function Lobby() {
  const { net, netError, mode, code, set } = useGame();
  const slot = useGame((st) => st.slot);
  const [name, setName] = useState(() => store('starforge_name') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const [view, setView] = useState<View>('home');
  // Read once per visit to the title screen, for the Singleplayer button.
  const save = useState(() => loadSave(slot))[0];

  // Fill the name from the site account once friends.js has signed in.
  useEffect(() => {
    if (name) return;
    const t = setInterval(() => {
      const n = friendsName();
      if (n) {
        setName((cur) => cur || n);
        clearInterval(t);
      }
    }, 600);
    return () => clearInterval(t);
  }, [name]);

  const commit = () => {
    const n = name.trim().slice(0, 16) || 'Prospector';
    store('starforge_name', n);
    set({ name: n });
  };
  const go = (v: View) => {
    commit();
    set({ netError: null });
    setView(v);
  };
  const joining = mode === 'guest' || (mode === 'server' && net === 'connecting');
  const busy = net === 'connecting' || net === 'reconnecting';
  const home = view === 'home';

  let body: React.ReactNode;
  if (joining && busy)
    body = (
      <div className="joining">
        <div className="spinner" />
        <div>
          Joining party <b>{code}</b>…
        </div>
        <button className="ghost" onClick={exitToTitle}>
          Cancel
        </button>
      </div>
    );
  else if (view === 'home')
    body = (
      <>
        <label className="field">
          <span>Your name</span>
          <input value={name} maxLength={16} placeholder="Prospector" onChange={(e) => setName(e.target.value)} onBlur={commit} />
        </label>
        <div className="actions main">
          <button className="primary" onClick={() => go('solo')}>
            <span className="lbl">
              <Icon name="solo" /> Singleplayer
            </span>
            <small>{save ? `Slot ${slot} · ${fmt(save.mine?.wallet.ore ?? 0)} ore · played ${ago(save.savedAt)}` : '3 save slots'}</small>
          </button>
          <button className="secondary" onClick={() => go('multi')}>
            <span className="lbl">
              <Icon name="crew" /> Multiplayer
            </span>
            <small>Host or join a crew of up to 4</small>
          </button>
        </div>
        <HowTo />
        <Changelog />
      </>
    );
  else if (view === 'solo')
    body = (
      <>
        <Head title="Singleplayer" sub="Pick a save slot. Each one is its own world." onBack={() => go('home')} />
        <SlotList
          verb="play"
          onGo={(n) => {
            commit();
            startLocal(false, n);
          }}
        />
      </>
    );
  else if (view === 'multi')
    body = (
      <>
        <Head title="Multiplayer" sub="Play together in one world. Everyone keeps their own wallet and upgrades." onBack={() => go('home')} />
        <div className="actions main">
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              if (usesServer) {
                commit();
                openParty();
              } else go('host');
            }}
          >
            <span className="lbl">
              <Icon name="host" /> Host
            </span>
            <small>{usesServer ? 'Open a room on the game server' : 'Open one of your worlds to friends'}</small>
          </button>
          <button className="secondary" onClick={() => go('join')}>
            <span className="lbl">
              <Icon name="join" /> Join
            </span>
            <small>With a code, or ask a friend</small>
          </button>
        </div>
      </>
    );
  else if (view === 'host')
    body = (
      <>
        <Head title="Host a party" sub="Which world should your crew play in? Friends join with a code or an invite." onBack={() => go('multi')} />
        <SlotList
          verb="host"
          onGo={(n) => {
            commit();
            openParty(n);
          }}
        />
      </>
    );
  else
    body = (
      <>
        <Head title="Join a party" sub="Type the code your host sees in their Crew tab, or ask a friend to let you in." onBack={() => go('multi')} />
        <form
          className="join"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
            joinParty(joinCode);
          }}
        >
          <input
            value={joinCode}
            maxLength={6}
            placeholder="PARTY CODE"
            aria-label="Party code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <button type="submit" disabled={joinCode.length < 4 || busy}>
            Join
          </button>
        </form>
        <div className="lsect">
          <span>Friends</span>
        </div>
        <FriendList kind="join" />
      </>
    );

  return (
    <div className="lobby">
      <div className="lobby-sky" />
      <div className={'lobby-card' + (home ? '' : ' sub')}>
        <a className="homebtn" href="../" title="Back to the game select">
          <Icon name="back" /> Main menu
        </a>
        {home ? (
          <>
            <div className="emblem" aria-hidden>
              <s />
              <b />
              <i />
            </div>
            <h1 className="logo">
              STAR<span>FORGE</span>
            </h1>
            <p className="tag">Co-op incremental mining. Tap the planet, build up your rig, and pool resources with friends to grow a shared Forge Tree.</p>
          </>
        ) : (
          <div className="logo mini" aria-hidden>
            STAR<span>FORGE</span>
          </div>
        )}
        <div className="pane" key={joining && busy ? 'joining' : view}>
          {body}
        </div>
        {netError && (
          <p className="err" onClick={() => set({ netError: null })}>
            {netError}
          </p>
        )}
      </div>
    </div>
  );
}
