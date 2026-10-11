import { NODE_IDS, fmt, has, type RoomState } from '@starforge/shared';
import { exitToTitle, resetSave } from '../net/session';
import { useGame } from '../state/store';
import { Changelog } from './Changelog';
import { ConfirmButton, Icon, useMe } from './common';

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

export function HowTo({ open = false }: { open?: boolean }) {
  return (
    <details className="howto" open={open}>
      <summary>How to play</summary>
      <ul>
        <li>
          <b>Tap the asteroid</b> to mine ore. Glowing seams pay extra, and cracking one pays ×5.
        </li>
        <li>
          <b>Upgrades</b> are yours: a stronger drill, drones that mine on their own, and more as the tree grows.
        </li>
        <li>
          <b>The Forge Tree</b> is shared. Anyone can put ore, alloy or Star Cores into a node, and when it's paid off it unlocks for the whole crew. Nodes are expensive,
          so pick together.
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
  );
}

/** The Menu tab: leave, your stats, how to play and what's new. */
export function MenuTab() {
  const s = useGame((st) => st.s);
  const mode = useGame((st) => st.mode);
  const slot = useGame((st) => st.slot);
  if (!s) return null;
  const local = mode === 'solo' || mode === 'host';
  return (
    <div className="tab-crew tab-menu">
      <section className="menu-acts">
        <a className="menubtn" href="../">
          <Icon name="back" />
          <span>
            <b>Back to main menu</b>
            <small>All games{local ? ' · your world is saved' : ''}</small>
          </span>
        </a>
        <button className="menubtn" onClick={exitToTitle}>
          <Icon name="home" />
          <span>
            <b>Starforge title screen</b>
            <small>{mode === 'guest' ? 'Leaves this party' : mode === 'host' ? 'Saves and closes the party' : 'Saves; switch save slots there'}</small>
          </span>
        </button>
        {local && (
          <p className="hint slotnote">
            <Icon name="save" /> Playing save slot {slot}. It saves by itself every few seconds.
          </p>
        )}
        {mode === 'guest' && <p className="hint slotnote">Your progress here is saved in the host's world.</p>}
      </section>
      <Stats s={s} />
      <section>
        <HowTo />
        <Changelog />
      </section>
      {local && (
        <section className="foot">
          <ConfirmButton className="ghost danger" onConfirm={resetSave} armed={`Really wipe slot ${slot}?`}>
            Reset this world
          </ConfirmButton>
        </section>
      )}
    </div>
  );
}
