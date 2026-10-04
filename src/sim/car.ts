// 2026-regulation Formula car for the point-mass lap simulation. Numbers sit in
// the published ballpark and are approximate (the FIA refined the details during
// 2025):
//   - ~780 kg with driver on a qualifying fuel load, smaller and narrower than
//     the 2022-2025 cars, with less downforce and drag in corner mode;
//   - active aerodynamics instead of DRS: on designated straights both wings
//     flatten into straight mode, and they close back to corner mode whenever
//     the car brakes;
//   - a power unit split roughly half and half: ~400 kW from the engine and up
//     to 350 kW from the MGU-K, whose output tapers away above 290 km/h;
//   - a 4 MJ battery window, recharged under braking (up to 350 kW, at most
//     8.5 MJ per lap), so long straights can run the battery flat.

import type { Compound } from './types.js';

export const G = 9.81;

export const CAR = {
  mass: 780,
  /** Engine power at the wheels, sea level (W). */
  icePower: 375000,
  /** Fraction of engine power lost per unit of air-density deficit (turbo compensates most of it). */
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
  mu: 1.93,
  vMax: 110,
  /** Straight mode: share of corner-mode drag and downforce left with both wings flat. */
  straightDrag: 0.5,
  straightDownforce: 0.45,
};

/** Hybrid system (MGU-K and battery). Energies in joules, powers in watts. */
export const ERS = {
  /** Peak MGU-K deployment at the wheels. */
  deploy: 330000,
  /** Deployment is full up to this speed (m/s), then tapers... */
  taperFrom: 290 / 3.6,
  /** ...to this share of peak at taperMid... */
  taperMid: 340 / 3.6,
  taperMidShare: 100 / 350,
  /** ...and to nothing at taperTo. */
  taperTo: 345 / 3.6,
  /** Usable battery window, and the charge carried over the line from the out-lap. */
  capacity: 4e6,
  startCharge: 4e6,
  /** Below this charge, deployment fades out (the battery protects itself). */
  reserve: 0.35e6,
  /**
   * Super clipping: above the deployment cut-off on a full-throttle straight,
   * the MGU-K harvests engine power back into the battery.
   */
  superClip: 80000,
  /** Regenerative braking limit, efficiency, and the most that may be recovered per lap. */
  harvest: 350000,
  harvestEfficiency: 0.88,
  harvestPerLap: 8.5e6,
};

/** Peak MGU-K power allowed at speed v (m/s). */
export function deployLimit(v: number): number {
  if (v <= ERS.taperFrom) return ERS.deploy;
  if (v <= ERS.taperMid) {
    const f = (v - ERS.taperFrom) / (ERS.taperMid - ERS.taperFrom);
    return ERS.deploy * (1 - f * (1 - ERS.taperMidShare));
  }
  if (v <= ERS.taperTo) {
    const f = (v - ERS.taperMid) / (ERS.taperTo - ERS.taperMid);
    return ERS.deploy * ERS.taperMidShare * (1 - f);
  }
  return 0;
}

/** Corner-mode aero packages by downforce level 1 (Monza) .. 5 (Monaco). [ClA, CdA] in m^2. */
export const AERO: Record<1 | 2 | 3 | 4 | 5, { cla: number; cda: number }> = {
  1: { cla: 3.25, cda: 1.06 },
  2: { cla: 3.6, cda: 1.15 },
  3: { cla: 3.9, cda: 1.25 },
  4: { cla: 4.2, cda: 1.34 },
  5: { cla: 4.45, cda: 1.43 },
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
