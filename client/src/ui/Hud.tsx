import {
  NODES,
  NODE_IDS,
  RESOURCES,
  UPGRADES,
  UPGRADE_IDS,
  fmt,
  has,
  onlinePlayers,
  surgeOn,
  upgradeCost,
  upgradeUnlocked,
  type PlayerState,
  type RoomState,
  type Wallet,
} from '@starforge/shared';
import { hueColor } from '../state/refs';
import { hostNow, useGame, type Tab } from '../state/store';
import { Amount, Icon, RES_LABEL, Tick, fmtDuration, liveWallet, resStyle, useMe, useTicker, type IconName } from './common';
import { CrewTab } from './Crew';
import { JoinAsks } from './Friends';
import { MenuTab } from './Menu';
import { TreeTab, canFinish } from './Tree';
import { UpgradesTab } from './Upgrades';

/* ---------------- top bar ---------------- */

function TopBar({ s, p }: { s: RoomState; p: PlayerState }) {
  useTicker(100);
  const snapAt = useGame((st) => st.snapAt);
  const net = useGame((st) => st.net);
  const mode = useGame((st) => st.mode);
  const openTab = useGame((st) => st.openTab);
  const w = liveWallet(p, snapAt);
  const now = hostNow();
  const online = onlinePlayers(s);
  const showAlloy = has(s, 'smelting') || p.wallet.alloy > 0;
  const surge = surgeOn(s, now);
  const reconnecting = net === 'reconnecting';
  return (
    <header className="topbar">
      <div className="ore" style={resStyle('ore')}>
        <i />
        <div>
          <Tick raw={p.wallet.ore} live={w.ore} rate={p.rates.ore} />
          <span>
            ore{p.rates.ore > 0.05 && <em> +{fmt(p.rates.ore)}/s</em>}
          </span>
        </div>
      </div>
      {(showAlloy || p.wallet.cores > 0) && (
        <div className="minors">
          {showAlloy && (
            <div className="minor" style={resStyle('alloy')}>
              <i />
              <Tick raw={p.wallet.alloy} live={w.alloy} rate={p.rates.alloy} />
              <span>alloy</span>
            </div>
          )}
          {p.wallet.cores > 0 && (
            <div className="minor" style={resStyle('cores')}>
              <i />
              <Tick raw={p.wallet.cores} live={p.wallet.cores} />
              <span>cores</span>
            </div>
          )}
        </div>
      )}
      <div className="spacer" />
      {(surge || reconnecting) && (
        <div className="flags">
          {surge && (
            <span className="surge">
              <Icon name="bolt" /> ×2 · {Math.ceil((s.surgeUntil - now) / 1000)}s
            </span>
          )}
          {reconnecting && (
            <span className="netwarn">
              <Icon name="signal" /> Reconnecting…
            </span>
          )}
        </div>
      )}
      <button className="crewpill" onClick={() => openTab('crew')} aria-label="Crew and party">
        {online.map((q) => (
          <i key={q.id} style={{ ['--h' as string]: hueColor(q.hue, 62) }} />
        ))}
        <span>{mode === 'solo' ? 'Solo' : `${online.length}/4`}</span>
      </button>
    </header>
  );
}

/* ---------------- tabs and the sheet / side panel ---------------- */

function badges(s: RoomState, p: PlayerState, w: Wallet): Record<Tab, number> {
  const up = UPGRADE_IDS.some((id) => {
    const def = UPGRADES[id];
    return upgradeUnlocked(s, id) && !(def.maxLevel !== undefined && p.levels[id] >= def.maxLevel) && w[def.currency] >= upgradeCost(id, p.levels[id]);
  });
  const tree = NODE_IDS.some((id) => canFinish(s, id, w));
  return { upgrades: up ? 1 : 0, tree: tree ? 1 : 0, crew: 0, menu: 0 };
}

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'upgrades', icon: 'pick', label: 'Upgrades' },
  { id: 'tree', icon: 'tree', label: 'Forge Tree' },
  { id: 'crew', icon: 'crew', label: 'Crew' },
  { id: 'menu', icon: 'menu', label: 'Menu' },
];

function Dock({ s, p }: { s: RoomState; p: PlayerState }) {
  useTicker(500);
  const tab = useGame((st) => st.tab);
  const sheet = useGame((st) => st.sheet);
  const node = useGame((st) => st.node);
  const snapAt = useGame((st) => st.snapAt);
  const { openTab, set } = useGame.getState();
  const b = badges(s, p, liveWallet(p, snapAt));
  const at = Math.max(0, TABS.findIndex((t) => t.id === tab));
  return (
    <aside className={'dock' + (sheet ? ' open' : '')}>
      <div className="body">
        <button className="grab" onClick={() => set({ sheet: false })} aria-label="Close panel">
          <i />
        </button>
        <div className="scroll">
          {/* Keyed so each tab (and each tree page) slides in fresh. */}
          <div className="pane" key={tab === 'tree' && node ? 'node:' + node : tab}>
            {tab === 'upgrades' && <UpgradesTab />}
            {tab === 'tree' && <TreeTab />}
            {tab === 'crew' && <CrewTab />}
            {tab === 'menu' && <MenuTab />}
          </div>
        </div>
      </div>
      <nav className="tabs" style={{ ['--i' as string]: at }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'on' : ''}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => (t.id === 'tree' && tab === 'tree' && node ? set({ node: null, sheet: true }) : openTab(t.id))}
          >
            <i>
              <Icon name={t.icon} />
            </i>
            <span>{t.label}</span>
            {b[t.id] > 0 && <em className="dot" />}
          </button>
        ))}
        <span className="tab-ind" aria-hidden />
      </nav>
    </aside>
  );
}

/* ---------------- overlays ---------------- */

function Toasts() {
  const toasts = useGame((st) => st.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={'toast ' + t.tone}>
          <i />
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

/** One gentle nudge at a time for a new player; gone once they get the hang of it. */
function Hint({ s, p }: { s: RoomState; p: PlayerState }) {
  const sheet = useGame((st) => st.sheet);
  let text = '';
  if (p.stats.taps < 6) text = 'Tap the asteroid to mine ore';
  else if (p.levels.drill + p.levels.drone === 0 && p.wallet.ore >= UPGRADES.drill.baseCost) text = 'Open Upgrades and buy a Drill Laser';
  else if (!has(s, 'core') && p.wallet.ore >= (NODES.core.cost.ore ?? 0) && p.levels.drone > 0) text = 'Open the Forge Tree: the Forge Core is ready to fund';
  if (!text || sheet) return null;
  return (
    <div className="hint-float">
      <i />
      {text}
    </div>
  );
}

function OfflineCard() {
  const offline = useGame((st) => st.offline);
  const set = useGame((st) => st.set);
  if (!offline) return null;
  return (
    <div className="modal" onClick={() => set({ offline: null })}>
      <div className="card offline" onClick={(e) => e.stopPropagation()}>
        <h3>Welcome back</h3>
        <p>Your drones and rigs kept mining for {fmtDuration(offline.seconds)} while you were away:</p>
        <div className="gains">
          {RESOURCES.filter((r) => offline.gained[r] > 0).map((r) => (
            <span key={r}>
              <Amount r={r} v={offline.gained[r]} /> {RES_LABEL[r]}
            </span>
          ))}
        </div>
        <button className="primary wide" onClick={() => set({ offline: null })}>
          Collect
        </button>
      </div>
    </div>
  );
}

function LeapFlash() {
  useTicker(500);
  const leap = useGame((st) => st.leap);
  if (!leap || Date.now() - leap.at > 2600) return null;
  return (
    <div className="leapflash" key={leap.at}>
      <i className="lf-ring" />
      <i className="lf-ring two" />
      <b>QUANTUM LEAP</b>
      <span>+{leap.cores} Star Core{leap.cores === 1 ? '' : 's'}</span>
    </div>
  );
}

/* ---------------- layout ---------------- */

export function Hud() {
  const s = useGame((st) => st.s);
  const p = useMe();
  if (!s || !p) return null;
  return (
    <div className="hud">
      <TopBar s={s} p={p} />
      <Toasts />
      <JoinAsks />
      <Hint s={s} p={p} />
      <Dock s={s} p={p} />
      <OfflineCard />
      <LeapFlash />
    </div>
  );
}
