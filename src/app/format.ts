// Lap time formatting and the "where would this lap put you" ladder.

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

/** Typical modern F1 qualifying gaps to pole (percent) for P2..P20. */
const F1_GAPS = [0.05, 0.12, 0.2, 0.27, 0.34, 0.42, 0.5, 0.58, 0.68, 0.78, 0.86, 0.94, 1.03, 1.12, 1.25, 1.38, 1.52, 1.68, 1.9];
const LAST = F1_GAPS.length + 1;

export type Tier = 'pole' | 'q3' | 'q2' | 'q1';

export interface GridSlot {
  /** Short stamp text, e.g. "P4". */
  stamp: string;
  position: number;
  label: string;
  tier: Tier;
}

function tierFor(p: number): Tier {
  return p <= 1 ? 'pole' : p <= 10 ? 'q3' : p <= 15 ? 'q2' : 'q1';
}

/** Where a lap would line up on an F1 grid; anything slower than P20 pace starts P20. */
export function gridSlot(timeMs: number, poleRefSeconds: number): GridSlot {
  const pole = poleRefSeconds * 1000;
  if (timeMs <= pole) return { stamp: 'P1', position: 1, label: 'Pole position', tier: 'pole' };
  const gapPct = (timeMs / pole - 1) * 100;
  let p = 2;
  while (p < LAST && gapPct > F1_GAPS[p - 2]) p++;
  const tier = tierFor(p);
  const label = tier === 'q3' ? 'F1 top ten' : tier === 'q2' ? 'F1, out in Q2' : 'F1, out in Q1';
  return { stamp: `P${p}`, position: p, label, tier };
}

/** Mean of several grid slots to one decimal, e.g. "P4.5". Purple only when every slot is pole. */
export function averageGrid(slots: GridSlot[]): { stamp: string; tier: Tier } | null {
  if (!slots.length) return null;
  let sum = 0;
  for (const s of slots) sum += s.position;
  const mean = sum / slots.length;
  const shown = Math.round(mean * 10) / 10;
  return { stamp: `P${shown}`, tier: mean === 1 ? 'pole' : tierFor(Math.max(2, Math.round(mean))) };
}

export function kmh(ms: number): number {
  return Math.round(ms * 3.6);
}
