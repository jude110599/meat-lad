import { useEffect, useState } from 'react';
import { NODE_IDS, fmt, has } from '@starforge/shared';
import { joinParty, loadSave, openParty, startLocal, usesServer } from '../net/session';
import { useGame } from '../state/store';
import { friendsName } from './friends';
import { Changelog } from './Changelog';
import { Icon } from './common';

function store(key: string, v?: string): string | null {
  try {
    if (v === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function Lobby() {
  const { net, netError, mode, code, set } = useGame();
  const [name, setName] = useState(() => store('starforge_name') ?? '');
  const [joinCode, setJoinCode] = useState('');
  const save = useState(() => loadSave())[0];

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
  const joining = mode === 'guest' || (mode === 'server' && net === 'connecting');
  const busy = net === 'connecting' || net === 'reconnecting';

  return (
    <div className="lobby">
      <div className="lobby-sky" />
      <div className="lobby-card">
        <a className="back" href="../">
          <Icon name="back" /> All games
        </a>
        <div className="emblem" aria-hidden>
          <s />
          <b />
          <i />
        </div>
        <h1 className="logo">
          STAR<span>FORGE</span>
        </h1>
        <p className="tag">Co-op incremental mining. Tap the asteroid, build up your rig, and pool resources with friends to grow a shared Forge Tree.</p>

        {joining && busy ? (
          <div className="joining">
            <div className="spinner" />
            <div>
              Joining party <b>{code}</b>…
            </div>
            <button className="ghost" onClick={() => startLocal(false)}>
              Cancel and play solo
            </button>
          </div>
        ) : (
          <>
            <label className="field">
              <span>Your name</span>
              <input value={name} maxLength={16} placeholder="Prospector" onChange={(e) => setName(e.target.value)} onBlur={commit} />
            </label>

            <div className="actions">
              <button
                className="primary"
                onClick={() => {
                  commit();
                  startLocal(false);
                }}
              >
                <span className="lbl">
                  <Icon name="play" /> {save ? 'Continue expedition' : 'Play solo'}
                </span>
                {save && (
                  <small>
                    {save.mine ? `${fmt(save.mine.wallet.ore)} ore · ` : ''}
                    {NODE_IDS.filter((id) => has(save.state, id)).length}/{NODE_IDS.length} tree nodes
                  </small>
                )}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  commit();
                  openParty();
                }}
              >
                <span className="lbl">
                  <Icon name="crew" /> Host a party
                </span>
                <small>{usesServer ? 'on the game server' : 'friends join with a code'}</small>
              </button>
            </div>

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
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              />
              <button type="submit" disabled={joinCode.length < 4 || busy}>
                Join
              </button>
            </form>
          </>
        )}

        {netError && <p className="err">{netError}</p>}
        <p className="small dim">Signed in on the main menu? Your friends list appears here once you host, so you can invite them straight in.</p>
        <Changelog />
      </div>
    </div>
  );
}
