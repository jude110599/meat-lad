import { useEffect, useState } from 'react';
import { fmt, type Role } from '@starforge/shared';
import { joinParty, loadSave, openParty, startLocal, usesServer } from '../net/session';
import { useGame } from '../state/store';
import { friendsName } from './friends';

const ROLES: { id: Role; icon: string; name: string; text: string }[] = [
  {
    id: 'miner',
    icon: '⛏',
    name: 'Miner',
    text: 'Fire the drill laser. Glowing seams pay ×3, a hot drill pays ×2, but overheat and it locks up.',
  },
  {
    id: 'refiner',
    icon: '⚙',
    name: 'Refiner',
    text: 'Run the station. Press machines to refine ore into alloy, plasma, dark matter and cosmic energy, and spend power on overclocks.',
  },
];

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
  const { net, netError, mode, code, role, set } = useGame();
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

  useEffect(() => {
    const r = store('starforge_role');
    if (r === 'miner' || r === 'refiner') set({ role: r, view: r === 'refiner' ? 'station' : 'rock', tab: r === 'refiner' ? 'refinery' : 'mining' });
  }, [set]);

  const commit = () => {
    const n = name.trim().slice(0, 16) || 'Prospector';
    store('starforge_name', n);
    set({ name: n });
  };
  const pickRole = (r: Role) => {
    store('starforge_role', r);
    set({ role: r, view: r === 'refiner' ? 'station' : 'rock', tab: r === 'refiner' ? 'refinery' : 'mining' });
  };

  const joining = mode === 'guest' || (mode === 'server' && net === 'connecting');
  const busy = net === 'connecting' || net === 'reconnecting';

  return (
    <div className="lobby">
      <div className="lobby-sky" />
      <div className="lobby-card">
        <a className="back" href="../">
          ← All games
        </a>
        <h1 className="logo">
          STAR<span>FORGE</span>
        </h1>
        <p className="tag">Co-op asteroid mining. Strike, refine, survive the events, and leap to a new rock.</p>

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

            <div className="roles">
              {ROLES.map((r) => (
                <button key={r.id} className={'role' + (role === r.id ? ' on' : '')} onClick={() => pickRole(r.id)}>
                  <i>{r.icon}</i>
                  <b>{r.name}</b>
                  <span>{r.text}</span>
                </button>
              ))}
            </div>
            <p className="small">You can switch roles any time. Solo, you can do both.</p>

            <div className="actions">
              <button
                className="primary"
                onClick={() => {
                  commit();
                  startLocal(false);
                }}
              >
                ▶ {save ? 'Continue expedition' : 'Play solo'}
                {save && (
                  <small>
                    {fmt(save.state.wallet.ore)} ore · {save.state.leaps} leap{save.state.leaps === 1 ? '' : 's'}
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
                👥 Host a party
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
      </div>
    </div>
  );
}
