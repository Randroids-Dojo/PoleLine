// Reference racing lines for calibration and tests. A minimum-curvature line
// (lateral offsets on the centreline that minimise the summed squared second
// difference) is solved coarse-to-fine with projected SOR.

import { quantize } from '../src/sim/path.js';
import type { Track } from '../src/sim/track.js';

function solveLevel(track: Track, stride: number, alphaIn: Float64Array, sweeps: number, margin: number): Float64Array {
  const n = Math.floor(track.n / stride);
  const idx = (k: number) => (((k % n) + n) % n) * stride;
  const alpha = new Float64Array(n);
  for (let k = 0; k < n; k++) alpha[k] = alphaIn[idx(k)];
  const cx = new Float64Array(n), cy = new Float64Array(n), nx = new Float64Array(n), ny = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const i = idx(k);
    cx[k] = track.x[i]; cy[k] = track.y[i]; nx[k] = track.nx[i]; ny[k] = track.ny[i];
  }
  const lim = track.limit - margin;
  const wrap = (k: number) => ((k % n) + n) % n;
  const px = (k: number) => { const j = wrap(k); return cx[j] + alpha[j] * nx[j]; };
  const py = (k: number) => { const j = wrap(k); return cy[j] + alpha[j] * ny[j]; };
  // Exact discrete energy around vertex j: Menger curvature squared times spacing.
  const term = (j: number) => {
    const ax = px(j - 1), ay = py(j - 1), bx = px(j), by = py(j), qx = px(j + 1), qy = py(j + 1);
    const ab = Math.hypot(bx - ax, by - ay), bc = Math.hypot(qx - bx, qy - by), ca = Math.hypot(ax - qx, ay - qy);
    const cr = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
    const den = ab * bc * ca;
    const k = den > 1e-12 ? (2 * cr) / den : 0;
    return k * k * (ab + bc) * 0.5;
  };
  const local = (k: number) => term(k - 1) + term(k) + term(k + 1);
  const delta = 0.02 * stride;
  const maxStep = 0.5 * stride;
  for (let sweep = 0; sweep < sweeps; sweep++) {
    let moved = 0;
    for (let k = 0; k < n; k++) {
      const a0 = alpha[k];
      const e0 = local(k);
      alpha[k] = a0 + delta;
      const ep = local(k);
      alpha[k] = a0 - delta;
      const em = local(k);
      const g = (ep - em) / (2 * delta);
      const h = (ep - 2 * e0 + em) / (delta * delta);
      let step = h > 1e-12 ? -g / h : ep < em ? maxStep : -maxStep;
      if (step > maxStep) step = maxStep;
      else if (step < -maxStep) step = -maxStep;
      let a = a0 + step;
      if (a > lim) a = lim;
      else if (a < -lim) a = -lim;
      alpha[k] = a;
      if (local(k) > e0) alpha[k] = a0;
      else moved += Math.abs(alpha[k] - a0);
    }
    if (moved < 1e-4 * n) break;
  }
  // Interpolate back to full resolution.
  const out = new Float64Array(track.n);
  for (let i = 0; i < track.n; i++) {
    const k0 = Math.floor(i / stride);
    const f = (i - k0 * stride) / stride;
    const a0 = alpha[k0 % n];
    const a1 = alpha[(k0 + 1) % n];
    out[i] = a0 + (a1 - a0) * f;
  }
  return out;
}

export function minCurvatureOffsets(track: Track, margin = 0.25): Float64Array {
  let alpha: Float64Array = new Float64Array(track.n);
  alpha = solveLevel(track, 16, alpha, 6000, margin);
  alpha = solveLevel(track, 8, alpha, 4000, margin);
  alpha = solveLevel(track, 4, alpha, 3000, margin);
  alpha = solveLevel(track, 2, alpha, 2000, margin);
  alpha = solveLevel(track, 1, alpha, 1500, margin);
  return alpha;
}

/** Turn lateral offsets into a quantised closed line (decimetres, flat). */
export function offsetsToLine(track: Track, alpha: Float64Array): number[] {
  const pts: number[] = [];
  let lx = Infinity, ly = Infinity;
  for (let i = 0; i < track.n; i++) {
    const x = track.x[i] + alpha[i] * track.nx[i];
    const y = track.y[i] + alpha[i] * track.ny[i];
    if (i > 0 && Math.hypot(x - lx, y - ly) < 0.7) continue;
    pts.push(quantize(x), quantize(y));
    lx = x; ly = y;
  }
  // Close on the finish line at the same lateral position the lap started.
  pts.push(pts[0], pts[1]);
  return pts;
}

/** Smooth pseudo-random wobble to mimic an imperfect hand-drawn line. */
export function wobble(track: Track, alpha: Float64Array, seed: number, amp: number, wavelength: number, jitter: number): Float64Array {
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = new Float64Array(track.n);
  const knotsEvery = Math.max(2, Math.round(wavelength / 2 / 2));
  const knots: number[] = [];
  for (let i = 0; i <= track.n / knotsEvery + 2; i++) knots.push((rnd() * 2 - 1) * amp);
  for (let i = 0; i < track.n; i++) {
    const k = Math.floor(i / knotsEvery);
    const f = (i - k * knotsEvery) / knotsEvery;
    const e = (1 - Math.cos(Math.PI * f)) / 2;
    const w = knots[k] + (knots[k + 1] - knots[k]) * e + (rnd() * 2 - 1) * jitter;
    let a = alpha[i] + w;
    const lim = track.limit - 0.2;
    if (a > lim) a = lim;
    if (a < -lim) a = -lim;
    out[i] = a;
  }
  // Keep the start point fixed so the line still begins on the start line.
  out[0] = alpha[0];
  return out;
}
