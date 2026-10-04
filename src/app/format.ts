// Lap time formatting and the "where would this put you on the grid" model.

export function formatLap(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '-:--.---';
  const neg = ms < 0;
  const a = Math.abs(Math.round(ms));
  const m = Math.floor(a / 60000);
  const s = Math.floor((a % 60000) / 1000);
  const r = a % 1000;
  return `${neg ? '-' : ''}${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

export function formatSector(ms: number): string {
  const a = Math.round(ms);
  const s = Math.floor(a / 1000);
  const r = a % 1000;
  if (s >= 60) return formatLap(ms);
  return `${s}.${String(r).padStart(3, '0')}`;
}

export function formatDelta(ms: number): string {
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '±';
  const a = Math.abs(Math.round(ms));
  return `${sign}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, '0')}`;
}

/** Typical modern qualifying gaps to pole (percent) for P2..P20. */
const GRID_GAPS = [0.05, 0.12, 0.2, 0.27, 0.34, 0.42, 0.5, 0.58, 0.68, 0.78, 0.86, 0.94, 1.03, 1.12, 1.25, 1.38, 1.52, 1.68, 1.9];

export interface GridSlot {
  position: number | null;
  label: string;
  tier: 'pole' | 'q3' | 'q2' | 'q1' | 'dnq';
  gapPct: number;
}

export function gridSlot(timeMs: number, poleRefSeconds: number): GridSlot {
  const pole = poleRefSeconds * 1000;
  const gapPct = (timeMs / pole - 1) * 100;
  if (gapPct > 7) return { position: null, label: 'Outside 107%', tier: 'dnq', gapPct };
  if (timeMs <= pole) return { position: 1, label: 'Pole position', tier: 'pole', gapPct };
  let p = 2;
  for (const g of GRID_GAPS) {
    if (gapPct <= g) break;
    p++;
  }
  if (p > 20) p = 20;
  const tier = p <= 10 ? 'q3' : p <= 15 ? 'q2' : 'q1';
  const label = tier === 'q3' ? 'Top ten in Q3' : tier === 'q2' ? 'Out in Q2' : 'Out in Q1';
  return { position: p, label, tier, gapPct };
}

export function kmh(ms: number): number {
  return Math.round(ms * 3.6);
}
