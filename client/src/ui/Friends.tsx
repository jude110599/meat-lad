import { useEffect, useState } from 'react';
import { openParty, usesServer } from '../net/session';
import { useGame } from '../state/store';
import { Icon } from './common';
import { friendsApi, useFriends, type FriendRow, type FriendsState } from './friends';

const STARFORGE = 'starforge';

function Avatar({ f }: { f: { name: string; avatar: string; online: boolean } }) {
  return (
    <span className={'fav' + (f.online ? ' on' : '')}>
      {f.avatar ? <img src={f.avatar} alt="" /> : <b>{(f.name[0] ?? '?').toUpperCase()}</b>}
    </span>
  );
}

/** Signed out, loading or broken: say so instead of an empty list. */
function Note({ fs }: { fs: FriendsState }) {
  if (fs.status === 'loading') return <p className="hint">Loading friends…</p>;
  if (fs.status === 'error') return <p className="hint">{fs.error || 'Friends are unavailable right now.'}</p>;
  if (fs.status === 'out')
    return (
      <p className="hint">
        <a href="../">Sign in on the main menu</a> to see your friends here.
      </p>
    );
  return (
    <p className="hint">
      No friends yet. Add them by username from the friends panel on the <a href="../">main menu</a>.
    </p>
  );
}

/** Invite friends into my party; opens one first when playing solo. */
function useInvite(): (f: FriendRow) => void {
  return (f) => {
    const st = useGame.getState();
    const inParty = st.mode !== 'solo' && st.code && st.net === 'open';
    const send = () =>
      void friendsApi.invite(f.entry).then((ok) => useGame.getState().toast(ok ? `Invite sent to ${f.name}` : `Couldn't invite ${f.name}`, ok ? 'good' : 'bad'));
    if (inParty) return send();
    if (st.mode !== 'solo') return;
    // Opening a party in a dedicated-server build would leave this world; there the code is shared instead.
    if (usesServer) return st.toast('Open a party first, then invite', 'info');
    openParty();
    // Send it as soon as the party is reachable.
    const t0 = Date.now();
    const off = useGame.subscribe((s) => {
      if (s.mode === 'host' && s.code && s.net === 'open') {
        off();
        send();
      } else if ((s.net === 'idle' && s.netError) || Date.now() - t0 > 20000) off();
    });
  };
}

/**
 * The site-wide friends list in Starforge's own style.
 *   invite  (Crew tab) an Invite button for online friends
 *   join    (lobby) "Request to join" for friends in a Starforge party
 */
export function FriendList({ kind }: { kind: 'invite' | 'join' }) {
  const fs = useFriends();
  const mode = useGame((st) => st.mode);
  const busy = useGame((st) => st.net === 'connecting');
  const invite = useInvite();
  const [msg, setMsg] = useState('');
  const list = fs.friends;
  const online = list.filter((f) => f.online).length;

  const request = (f: FriendRow) => {
    setMsg('');
    void friendsApi.requestJoin(f.entry).then((m) => setMsg(m.startsWith('ok:') ? '' : m));
  };

  return (
    <div className="friends">
      {fs.status === 'in' && list.length > 0 ? (
        <div className="frows">
          {list.map((f) => {
            const sfParty = f.party?.game === STARFORGE;
            let action: React.ReactNode = null;
            if (kind === 'invite') {
              if (f.here) action = <span className="ftag">In party</span>;
              else if (f.online && f.known)
                action = (
                  <button className="fbtn" disabled={f.invited || busy} onClick={() => invite(f)}>
                    {f.invited ? (
                      <>
                        <Icon name="check" /> Sent
                      </>
                    ) : (
                      'Invite'
                    )}
                  </button>
                );
            } else if (sfParty) {
              action = f.requested ? (
                <button className="fbtn wait" onClick={friendsApi.cancelJoin} title="Cancel the request">
                  <i className="mini-spin" /> Asked · cancel
                </button>
              ) : (
                <button className="fbtn go" onClick={() => request(f)} disabled={!!fs.pending}>
                  Request to join
                </button>
              );
            }
            return (
              <div key={f.entry} className={'frow' + (f.online ? ' on' : '')}>
                <Avatar f={f} />
                <div className="fwho">
                  <b>{f.name}</b>
                  <span>{f.status}</span>
                </div>
                {action}
              </div>
            );
          })}
        </div>
      ) : (
        <Note fs={fs} />
      )}
      {kind === 'join' && fs.pending && (
        <p className="hint pend">
          <i className="mini-spin" />
          <span>
            Waiting for <b>{fs.pending.name}</b> to let you in. You'll join as soon as they accept.
          </span>
        </p>
      )}
      {msg && <p className="err">{msg}</p>}
      {fs.status === 'in' && list.length > 0 && (
        <p className="hint fcount">
          {online} of {list.length} online
          {kind === 'invite' && mode === 'solo' && ' · inviting opens a party'}
        </p>
      )}
    </div>
  );
}

/** A friend asks to join my party: a card at the top of the screen with Accept and Decline. */
export function JoinAsks() {
  const fs = useFriends();
  const [, setT] = useState(0);
  useEffect(() => {
    if (!fs.asks.length) return;
    const t = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [fs.asks.length]);
  const ask = fs.asks[0];
  if (!ask) return null;
  const left = Math.max(0, Math.ceil((ask.ts + 120000 - Date.now()) / 1000));
  return (
    <div className="joinask" key={ask.id} role="alertdialog" aria-label={`${ask.name} wants to join`}>
      <i className="ja-dot" />
      <div className="ja-txt">
        <b>{ask.name}</b> wants to join your party
        <small>
          {fs.asks.length > 1 ? `${fs.asks.length - 1} more waiting · ` : ''}
          {left}s
        </small>
      </div>
      <div className="ja-btns">
        <button className="ghost" onClick={() => friendsApi.answerJoin(ask.id, false)}>
          Decline
        </button>
        <button className="ja-ok" onClick={() => friendsApi.answerJoin(ask.id, true)}>
          Accept
        </button>
      </div>
    </div>
  );
}
