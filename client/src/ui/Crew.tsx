import { useState } from 'react';
import { NODE_IDS, fmt, has, onlinePlayers, passiveOrePerSec, type RoomState } from '@starforge/shared';
import { act } from '../net/actions';
import { closeParty, joinParty, leaveParty, openParty, resetSave, usesServer } from '../net/session';
import { hueColor } from '../state/refs';
import { useGame } from '../state/store';
import { Changelog } from './Changelog';
import { ConfirmButton, Icon, useMe } from './common';

const EMOTES = ['👋', '👍', '🔥', '💎', '🎉', '⏳'];

function Party() {
  const { mode, code, net, netError, set } = useGame();
  const [copied, setCopied] = useState(false);
  const [join, setJoin] = useState('');
  const link = code ? `${location.origin}${location.pathname}?join=${code}` : '';
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <section className="party">
      {mode === 'solo' && (
        <>
          <p className="hint">Play with up to 3 friends in your world. They keep their own progress here and help grow your Forge Tree.</p>
          <button className="primary wide" disabled={net === 'connecting'} onClick={openParty}>
            <span className="lbl">
              {net === 'connecting' ? (
                'Opening party…'
              ) : (
                <>
                  <Icon name="crew" /> Open a party
                </>
              )}
            </span>
          </button>
          <form
            className="join"
            onSubmit={(e) => {
              e.preventDefault();
              joinParty(join);
            }}
          >
            <input value={join} maxLength={6} placeholder="FRIEND'S CODE" onChange={(e) => setJoin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
            <button type="submit" disabled={join.length < 4}>
              Join
            </button>
          </form>
        </>
      )}
      {(mode === 'host' || mode === 'server') && code && (
        <>
          <div className="code">
            <span>Party code</span>
            <b>{code}</b>
            <button onClick={copy} className={copied ? 'copied' : ''}>
              {copied ? (
                <>
                  <Icon name="check" /> Copied
                </>
              ) : (
                'Copy invite link'
              )}
            </button>
          </div>
          <p className="hint">Friends join with this code, or from the friends list if they're signed in on the main menu.</p>
          {mode === 'host' && (
            <button className="ghost" onClick={closeParty}>
              Close party
            </button>
          )}
        </>
      )}
      {mode === 'guest' && (
        <>
          <p className="hint">
            You're in party <b>{code}</b>
            {net === 'reconnecting' && ' · reconnecting…'}. Your progress here is saved in the host's world.
          </p>
          <button className="ghost" onClick={leaveParty}>
            Leave and play solo
          </button>
        </>
      )}
      {netError && mode !== 'guest' && (
        <p className="err" onClick={() => set({ netError: null })}>
          {netError} ✕
        </p>
      )}
    </section>
  );
}

function Mates({ s }: { s: RoomState }) {
  const me = useGame((st) => st.me);
  const emotes = useGame((st) => st.emotes);
  const mode = useGame((st) => st.mode);
  const online = onlinePlayers(s).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
  const away = Object.values(s.players).filter((p) => !p.online).length;
  return (
    <section>
      <h3>
        Crew <em>{online.length}/4</em>
      </h3>
      <div className="mates">
        {online.map((p) => {
          const e = emotes[p.id];
          return (
            <div key={p.id} className="mate" style={{ ['--c' as string]: hueColor(p.hue, 64) }}>
              <i />
              <b>
                {p.name}
                {p.id === me && <small> (you)</small>}
                {e && Date.now() - e.at < 4000 && <span className="emote">{e.id}</span>}
              </b>
              <span>{fmt(passiveOrePerSec(s, p))}/s</span>
              {p.wallet.cores > 0 && <span className="cores">★{fmt(p.wallet.cores)}</span>}
            </div>
          );
        })}
      </div>
      {away > 0 && mode !== 'guest' && (
        <p className="hint">
          {away} crewmate{away === 1 ? '' : 's'} away. Their progress is saved in this world.
        </p>
      )}
      {mode !== 'solo' && (
        <div className="emotes">
          {EMOTES.map((e) => (
            <button key={e} onClick={() => act.emote(e)}>
              {e}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Stats({ s }: { s: RoomState }) {
  const p = useMe();
  if (!p) return null;
  const owned = NODE_IDS.filter((id) => has(s, id)).length;
  const rows: [string, string][] = [
    ['Ore mined, all time', fmt(p.stats.ore)],
    ['Taps', fmt(p.stats.taps)],
    ['Quantum Leaps', String(p.stats.leaps)],
    ['Star Cores earned', fmt(p.stats.cores)],
    ['Forge Tree nodes you paid for', p.stats.funded.toFixed(1)],
    ['Forge Tree unlocked', `${owned}/${NODE_IDS.length}`],
  ];
  return (
    <section>
      <h3>Your stats</h3>
      <dl className="stats">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function CrewTab() {
  const s = useGame((st) => st.s);
  const mode = useGame((st) => st.mode);
  if (!s) return null;
  return (
    <div className="tab-crew">
      <Party />
      <Mates s={s} />
      <Stats s={s} />
      <section>
        <details className="howto">
          <summary>How to play</summary>
          <ul>
            <li>
              <b>Tap the asteroid</b> to mine ore. Glowing seams pay extra, and cracking one pays ×5.
            </li>
            <li>
              <b>Upgrades</b> are yours: a stronger drill, drones that mine on their own, and more as the tree grows.
            </li>
            <li>
              <b>The Forge Tree</b> is shared. Anyone can put ore, alloy or Star Cores into a node, and when it's paid off it unlocks for the whole crew. Nodes are
              expensive, so pick together.
            </li>
            <li>
              <b>Comets</b> fly past now and then. Tap one and the whole crew gets paid, you double.
            </li>
            <li>
              <b>Quantum Leap</b> (late in the tree) restarts your own run for Star Cores, which boost everything you mine.
            </li>
            <li>Drones, harvesters and rigs keep mining at a reduced rate while you're away.</li>
          </ul>
        </details>
        <Changelog />
      </section>
      <section className="foot">
        <a className="ghost" href="../">
          <Icon name="back" /> All games
        </a>
        {(mode === 'solo' || mode === 'host') && (
          <ConfirmButton className="ghost danger" onConfirm={resetSave} armed="Really wipe this world?">
            Reset my world
          </ConfirmButton>
        )}
        {usesServer && <small>Connected to the game server.</small>}
      </section>
    </div>
  );
}
