import { useEffect, useState, type CSSProperties } from 'react';
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
