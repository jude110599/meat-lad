import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RESOURCE_DEFS, fmt, type PlayerState, type ResourceId, type Wallet } from '@starforge/shared';
import { selectMe, useGame } from '../state/store';

/** Re-render at a steady rate, for counters and timers between 10 Hz snapshots. */
export function useTicker(ms: number): void {
  const [, setT] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setT((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

export const useMe = (): PlayerState | undefined => useGame(selectMe);

/** My wallet, advanced by my income since the last snapshot so counters roll smoothly. */
export function liveWallet(p: PlayerState, snapAt: number): Wallet {
  const dt = Math.min(1, Math.max(0, (performance.now() - snapAt) / 1000));
  return { ore: p.wallet.ore + p.rates.ore * dt, alloy: p.wallet.alloy + p.rates.alloy * dt, cores: p.wallet.cores };
}

/** "2h 13m", "4m 10s", "12s". */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

export const RES_LABEL: Record<ResourceId, string> = { ore: 'ore', alloy: 'alloy', cores: 'cores' };

export const resStyle = (r: ResourceId): CSSProperties => ({ ['--c' as string]: RESOURCE_DEFS[r].color });

/** A number with its resource's coloured gem. */
export function Amount({ r, v, label = false }: { r: ResourceId; v: number; label?: boolean }) {
  return (
    <span className={'amt ' + r} style={resStyle(r)}>
      <i />
      {fmt(v)}
      {label && <small> {RES_LABEL[r]}</small>}
    </span>
  );
}

/**
 * Counts how often `v` has gone up since this component mounted, and by how
 * much the last time. Key a one-shot animation on `n` to replay it on every
 * rise (a level bought, a node finished); nothing plays on mount.
 */
export function useRise(v: number): { n: number; by: number } {
  const r = useRef({ v, n: 0, by: 0 });
  const c = r.current;
  if (v > c.v) {
    c.n++;
    c.by = v - c.v;
  }
  c.v = v;
  return { n: c.n, by: c.by };
}

/**
 * A live counter that pops when its value jumps by more than steady income
 * explains (a tap, a comet, a seam) and dips when it is spent. A jump worth a
 * real share of the total pops harder. `raw` is the snapshot value, `live`
 * the smoothly extrapolated one that is shown.
 */
export function Tick({ raw, live, rate = 0 }: { raw: number; live: number; rate?: number }) {
  const r = useRef({ raw, t: performance.now(), n: 0, dir: '', at: 0 });
  const c = r.current;
  if (raw !== c.raw) {
    const now = performance.now();
    // Snapshots land ~10 times a second; bunched ones still carry a tenth of a second of income.
    const expected = rate * Math.min(2, Math.max(0.1, (now - c.t) / 1000));
    const d = raw - c.raw;
    const dir = d > expected * 1.35 + 0.5 ? (d > Math.max(1, Math.abs(c.raw) * 0.04) ? 'rise big' : 'rise') : d < -0.5 ? 'fall' : '';
    // At most a couple of pops a second, so rapid taps and chunky income don't make it jitter; a bigger jump still cuts in.
    if (dir && (now - c.at > 450 || (dir !== c.dir && dir !== 'rise'))) {
      c.n++;
      c.dir = dir;
      c.at = now;
    }
    c.raw = raw;
    c.t = now;
  }
  return (
    <b key={c.n} className={'tick' + (c.n ? ' ' + c.dir : '')}>
      {fmt(live)}
    </b>
  );
}

export type IconName = 'pick' | 'tree' | 'crew' | 'lock' | 'check' | 'back' | 'play' | 'bolt' | 'signal';

const ICONS: Record<IconName, React.ReactNode> = {
  pick: (
    <>
      <path d="M10.5 3.6Q18.9 5.2 20.4 13.5" />
      <path d="M15.4 8.6 4.6 19.4" />
    </>
  ),
  tree: (
    <>
      <path d="M12 5 6 12l6 7 6-7-6-7" opacity=".55" />
      <circle cx="12" cy="5" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="6" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="2.2" fill="currentColor" stroke="none" />
    </>
  ),
  crew: (
    <>
      <circle cx="9" cy="8.2" r="3.1" />
      <path d="M3.4 19.5c0-3.4 2.5-5.7 5.6-5.7s5.6 2.3 5.6 5.7" />
      <circle cx="16.6" cy="8.8" r="2.5" opacity=".65" />
      <path d="M16.2 13.9c2.6.1 4.5 2.2 4.5 5.1" opacity=".65" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.4" />
      <path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5" />
    </>
  ),
  check: <path d="m5 12.6 4.4 4.4L19 7.4" />,
  back: <path d="M15 5 8 12l7 7" />,
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  bolt: <path d="M13.5 3 5.5 13.5h6L10.5 21l8-10.5h-6z" fill="currentColor" stroke="none" />,
  signal: (
    <>
      <path d="M4.5 9.5a11 11 0 0 1 15 0" />
      <path d="M7.5 12.8a6.5 6.5 0 0 1 9 0" />
      <circle cx="12" cy="16.8" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
};

/** One line-icon set for the HUD chrome, so every glyph shares a weight and takes `currentColor`. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={'ic' + (className ? ' ' + className : '')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

/**
 * A button that asks for a second tap before doing something you can't take
 * back. The first tap arms it for a few seconds.
 */
export function ConfirmButton({
  className,
  disabled,
  onConfirm,
  children,
  armed: armedLabel,
}: {
  className?: string;
  disabled?: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
  armed: React.ReactNode;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={(className ?? '') + (armed ? ' armed' : '')}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? armedLabel : children}
    </button>
  );
}
