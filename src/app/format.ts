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
/** Feeder series pole pace relative to F1 pole, and how spread out their grids are. */
const F2 = { pole: 13, spread: 2.2, cars: 22 };
const F3 = { pole: 21, spread: 2.6, cars: 30 };
/** Track day pace past the back of the F3 grid, spread wide; the slowest share the last slot. */
const CLUB = { from: F3.pole + F3.spread, spread: 30, cars: 40 };

export type Tier = 'pole' | 'q3' | 'q2' | 'q1' | 'f1' | 'f2' | 'f3' | 'club';

export interface GridSlot {
  /** Short stamp text, e.g. "P4", "F2 P3", "107%". */
  stamp: string;
  position: number | null;
  label: string;
  tier: Tier;
  gapPct: number;
  /** 0..1 progress up the ladder, for meters. */
  ladder: number;
}

function feeder(gapPct: number, s: typeof F2, name: string): { position: number; label: string } {
  if (gapPct <= s.pole) return { position: 1, label: `Quicker than ${name} pole` };
  const p = Math.min(s.cars, 2 + Math.floor(((gapPct - s.pole) / s.spread) * (s.cars - 1)));
  return { position: p, label: `${name} grid pace` };
}

export function gridSlot(timeMs: number, poleRefSeconds: number): GridSlot {
  const pole = poleRefSeconds * 1000;
  const gapPct = (timeMs / pole - 1) * 100;
  const ladder = Math.max(0, Math.min(1, 1 - gapPct / 30));
  if (timeMs <= pole) return { stamp: 'P1', position: 1, label: 'Pole position', tier: 'pole', gapPct, ladder: 1 };
  if (gapPct <= F1_GAPS[F1_GAPS.length - 1]) {
    let p = 2;
    for (const g of F1_GAPS) {
      if (gapPct <= g) break;
      p++;
    }
    const tier = p <= 10 ? 'q3' : p <= 15 ? 'q2' : 'q1';
    const label = tier === 'q3' ? 'F1 top ten' : tier === 'q2' ? 'F1, out in Q2' : 'F1, out in Q1';
    return { stamp: `P${p}`, position: p, label, tier, gapPct, ladder };
  }
  if (gapPct <= 7) return { stamp: '107%', position: null, label: 'Inside F1’s 107% rule', tier: 'f1', gapPct, ladder };
  if (gapPct <= F2.pole + F2.spread) {
    const f = feeder(gapPct, F2, 'F2');
    return { stamp: `F2 P${f.position}`, position: f.position, label: f.label, tier: 'f2', gapPct, ladder };
  }
  if (gapPct <= F3.pole + F3.spread) {
    const f = feeder(gapPct, F3, 'F3');
    return { stamp: `F3 P${f.position}`, position: f.position, label: f.label, tier: 'f3', gapPct, ladder };
  }
  const p = Math.min(CLUB.cars, 1 + Math.floor(((gapPct - CLUB.from) / CLUB.spread) * CLUB.cars));
  return { stamp: `Club P${p}`, position: p, label: 'Track day pace', tier: 'club', gapPct, ladder };
}

// One ordinal ladder across every series so grid slots can be averaged:
// F1 P1..P20, then 107%, then the F2, F3 and club grids.
const F1_CARS = F1_GAPS.length + 1;
const RUNG_107 = F1_CARS + 1;
const F2_FIRST = RUNG_107 + 1;
const F3_FIRST = F2_FIRST + F2.cars;
const CLUB_FIRST = F3_FIRST + F3.cars;

function gridRung(slot: GridSlot): number {
  switch (slot.tier) {
    case 'pole':
    case 'q3':
    case 'q2':
    case 'q1':
      return slot.position ?? 1;
    case 'f1':
      return RUNG_107;
    case 'f2':
      return F2_FIRST + (slot.position ?? 1) - 1;
    case 'f3':
      return F3_FIRST + (slot.position ?? 1) - 1;
    default:
      return CLUB_FIRST + (slot.position ?? 1) - 1;
  }
}

/** Mean of several grid slots, read back onto the ladder: "P4.5", "F2 P13", "Club P12.5". */
export function averageGrid(slots: GridSlot[]): { stamp: string; tier: Tier } | null {
  if (!slots.length) return null;
  let sum = 0;
  for (const s of slots) sum += gridRung(s);
  const rung = sum / slots.length;
  const r = Math.round(rung);
  const pos = (first: number, cars: number) => {
    const p = Math.min(cars, Math.max(1, Math.round((rung - first + 1) * 10) / 10));
    return Number.isInteger(p) ? String(p) : p.toFixed(1);
  };
  if (r <= F1_CARS) {
    const tier: Tier = rung === 1 ? 'pole' : r <= 10 ? 'q3' : r <= 15 ? 'q2' : 'q1';
    return { stamp: `P${pos(1, F1_CARS)}`, tier };
  }
  if (r === RUNG_107) return { stamp: '107%', tier: 'f1' };
  if (r < F3_FIRST) return { stamp: `F2 P${pos(F2_FIRST, F2.cars)}`, tier: 'f2' };
  if (r < CLUB_FIRST) return { stamp: `F3 P${pos(F3_FIRST, F3.cars)}`, tier: 'f3' };
  return { stamp: `Club P${pos(CLUB_FIRST, CLUB.cars)}`, tier: 'club' };
}

export function kmh(ms: number): number {
  return Math.round(ms * 3.6);
}
