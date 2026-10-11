const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/** Incremental-style number formatting: 1.23K, 45.6M, then scientific past Dc. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n < 10 && n % 1) return n.toFixed(1);
  if (n < 1000) return Math.floor(n).toString();
  const e = Math.floor(Math.log10(n) / 3);
  if (e < SUFFIXES.length) {
    const v = n / 1000 ** e;
    return v.toFixed(v < 100 ? 2 : 1) + SUFFIXES[e];
  }
  return n.toExponential(2).replace('+', '');
}
