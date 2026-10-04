// Modern (ground-effect era) Formula car parameters for the point-mass lap
// simulation. Numbers sit in the published ballpark: ~800 kg with driver,
// ~1000 hp combined, 5-6 g in fast corners, ~330-350 km/h top speed.

import type { Compound } from './types.js';

export const G = 9.81;

export const CAR = {
  mass: 808,
  /** Combined ICE + ERS power at the wheels, sea level (W). */
  power: 700000,
  /** Fraction of power lost per unit of air-density deficit (turbo compensates most of it). */
  altitudePowerLoss: 0.32,
  rhoRef: 1.18,
  crr: 0.011,
  /** Share of normal load available for traction on the driven axle. */
  tractionShare: 0.6,
  /** Longitudinal braking grip relative to lateral grip. */
  brakeShare: 0.86,
  /** Tyre load sensitivity: grip coefficient lost per extra body-weight of load. */
  loadSensitivity: 0.06,
  /** Peak lateral friction coefficient of a soft tyre in its window. */
  mu: 1.8,
  vMax: 110,
  /** DRS: drag and downforce reduction when the flap is open. */
  drsDrag: 0.11,
  drsDownforce: 0.14,
};

/** Aero packages by downforce level 1 (Monza) .. 5 (Monaco). [ClA, CdA] in m^2. */
export const AERO: Record<1 | 2 | 3 | 4 | 5, { cla: number; cda: number }> = {
  1: { cla: 4.1, cda: 1.2 },
  2: { cla: 4.6, cda: 1.31 },
  3: { cla: 5.0, cda: 1.42 },
  4: { cla: 5.35, cda: 1.52 },
  5: { cla: 5.7, cda: 1.63 },
};

export interface CompoundSpec {
  label: string;
  short: string;
  color: string;
  /** Peak grip relative to the soft. */
  grip: number;
  /** Optimal tyre temperature (deg C) and window half-width. */
  tOpt: number;
  window: number;
  /** Temperature gained on the out-lap above track temperature. */
  warm: number;
  /** Heating response to sliding energy. */
  heat: number;
}

export const COMPOUND_SPECS: Record<Compound, CompoundSpec> = {
  soft: { label: 'Soft', short: 'S', color: '#ff2d3d', grip: 1, tOpt: 97, window: 22, warm: 49, heat: 0.92 },
  medium: { label: 'Medium', short: 'M', color: '#ffd12e', grip: 0.9935, tOpt: 104, window: 24, warm: 47, heat: 0.82 },
  hard: { label: 'Hard', short: 'H', color: '#f2f2f2', grip: 0.984, tOpt: 114, window: 28, warm: 44, heat: 0.66 },
};

/** Tyre thermal model constants. */
export const THERMAL = {
  /** Heating gain per unit sliding power (deg C per second). */
  gain: 1.6,
  /** Base cooling rate (1/s) plus speed-dependent convective term (per m/s). */
  coolBase: 0.012,
  coolSpeed: 0.00028,
  /** Equilibrium offset above the air/track mean when not loaded. */
  restOffset: 30,
  /** Peak grip loss at one window-width away from optimum. */
  loss: 0.03,
};

/** Grip multiplier for a tyre at temperature T. Rational falloff, no exp. */
export function tyreGrip(spec: CompoundSpec, temp: number): number {
  const x = (temp - spec.tOpt) / spec.window;
  const x2 = x * x;
  return 1 - (THERMAL.loss * x2) / (1 + 0.11 * x2);
}

/** Cosmetic gearbox for HUD and audio: upshift points in m/s for gears 1..8. */
const SHIFT = [0, 22.5, 32.5, 41, 49.5, 58, 67, 76.5, 200];

export function gearFor(v: number): { gear: number; rpm: number } {
  let g = 1;
  while (g < 8 && v >= SHIFT[g]) g++;
  const lo = SHIFT[g - 1];
  const hi = g === 8 ? 96 : SHIFT[g];
  const f = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const rpm = g === 1 ? 4000 + 8000 * f : 10400 + 1700 * f;
  return { gear: g, rpm };
}
