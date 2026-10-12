import { useState } from 'react';
import { fmt, onlinePlayers, passiveOrePerSec, type RoomState } from '@starforge/shared';
import { act } from '../net/actions';
import { closeParty, joinParty, openParty, usesServer } from '../net/session';
import { hueColor } from '../state/refs';
import { useGame } from '../state/store';
import { Icon } from './common';
import { FriendList } from './Friends';

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
          <button className="primary wide" disabled={net === 'connecting'} onClick={() => openParty()}>
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
          <p className="hint">Friends join with this code, or invite them from your friends list below.</p>
          {mode === 'host' && (
            <button className="ghost" onClick={closeParty}>
              Close party
            </button>
          )}
        </>
      )}
      {mode === 'guest' && (
        <p className="hint">
          You're in party <b>{code}</b>
          {net === 'reconnecting' && ' · reconnecting…'}. Your progress here is saved in the host's world.
        </p>
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

export function CrewTab() {
  const s = useGame((st) => st.s);
  if (!s) return null;
  return (
    <div className="tab-crew">
      <Party />
      <Mates s={s} />
      <section>
        <h3>Friends</h3>
        <FriendList kind="invite" />
      </section>
      {usesServer && <p className="small dim">Connected to the game server.</p>}
    </div>
  );
}
