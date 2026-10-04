// Track geometry: decodes the stored centreline and answers "where along the
// lap is this point, and how far off the centreline is it?". Projection is
// windowed around a hint so figure-eight layouts (Suzuka) and parallel
// sections (Monaco, Baku) never snap onto the wrong part of the circuit.

import type { TrackMeta } from './types.js';

/** Painted white line width outside the asphalt edge. Still counts as track. */
export const WHITE_LINE = 0.35;

export interface Track {
  meta: TrackMeta;
  n: number;
  x: Float64Array;
  y: Float64Array;
  /** Cumulative distance at each vertex. */
  s: Float64Array;
  /** Unit tangent of segment i -> i+1. */
  tx: Float64Array;
  ty: Float64Array;
  segLen: Float64Array;
  /** Per-vertex unit normal (pointing to the right of travel). */
  nx: Float64Array;
  ny: Float64Array;
  length: number;
  half: number;
  /** Legal half width for the car centre (asphalt + white line). */
  limit: number;
}

export interface Projection {
  seg: number;
  /** Distance along the centreline in [0, length). */
  s: number;
  /** Signed lateral offset, positive to the right of travel. */
  d: number;
  /** Unsigned distance to the centreline polyline. */
  dist: number;
}

export function buildTrack(meta: TrackMeta, deltas: number[]): Track {
  const n = deltas.length / 2;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let ix = 0, iy = 0;
  for (let i = 0; i < n; i++) {
    ix += deltas[i * 2];
    iy += deltas[i * 2 + 1];
    x[i] = ix / 10;
    y[i] = iy / 10;
  }
  const s = new Float64Array(n);
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const segLen = new Float64Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const dx = x[j] - x[i];
    const dy = y[j] - y[i];
    const len = Math.sqrt(dx * dx + dy * dy);
    s[i] = acc;
    segLen[i] = len;
    tx[i] = dx / len;
    ty[i] = dy / len;
    acc += len;
  }
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i === 0 ? n - 1 : i - 1;
    const ax = tx[p] + tx[i];
    const ay = ty[p] + ty[i];
    const len = Math.sqrt(ax * ax + ay * ay) || 1;
    // Right-hand normal in screen space (+y down): (-ty, tx).
    nx[i] = -ay / len;
    ny[i] = ax / len;
  }
  const half = meta.width / 2;
  return { meta, n, x, y, s, tx, ty, segLen, nx, ny, length: acc, half, limit: half + WHITE_LINE };
}

function projectOnSegment(t: Track, i: number, px: number, py: number, out: Projection): number {
  const ax = t.x[i];
  const ay = t.y[i];
  const len = t.segLen[i];
  const ux = t.tx[i];
  const uy = t.ty[i];
  let u = (px - ax) * ux + (py - ay) * uy;
  if (u < 0) u = 0;
  else if (u > len) u = len;
  const qx = ax + ux * u;
  const qy = ay + uy * u;
  const dx = px - qx;
  const dy = py - qy;
  const d2 = dx * dx + dy * dy;
  out.seg = i;
  out.s = t.s[i] + u;
  const side = dx * -uy + dy * ux;
  const dist = Math.sqrt(d2);
  out.dist = dist;
  out.d = side >= 0 ? dist : -dist;
  return d2;
}

/** Closest point on segments [hint - window, hint + window]. */
export function projectNear(t: Track, px: number, py: number, hint: number, window: number, out?: Projection): Projection {
  const best: Projection = out ?? { seg: 0, s: 0, d: 0, dist: 0 };
  const tmp: Projection = { seg: 0, s: 0, d: 0, dist: 0 };
  let bestD2 = Infinity;
  for (let k = -window; k <= window; k++) {
    let i = (hint + k) % t.n;
    if (i < 0) i += t.n;
    const d2 = projectOnSegment(t, i, px, py, tmp);
    if (d2 < bestD2) {
      bestD2 = d2;
      best.seg = tmp.seg;
      best.s = tmp.s;
      best.d = tmp.d;
      best.dist = tmp.dist;
    }
  }
  return best;
}

/** Global closest point. Only for UI hit-testing, never for validation. */
export function projectGlobal(t: Track, px: number, py: number): Projection {
  const half = Math.floor(t.n / 2);
  return projectNear(t, px, py, half, half);
}

/** Centreline point and frame at distance s (wrapped). */
export function frameAt(t: Track, sIn: number): { x: number; y: number; tx: number; ty: number; nx: number; ny: number; seg: number } {
  let s = sIn % t.length;
  if (s < 0) s += t.length;
  // Binary search for the segment.
  let lo = 0, hi = t.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t.s[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const u = s - t.s[i];
  return {
    x: t.x[i] + t.tx[i] * u,
    y: t.y[i] + t.ty[i] * u,
    tx: t.tx[i],
    ty: t.ty[i],
    nx: -t.ty[i],
    ny: t.tx[i],
    seg: i,
  };
}

export function segAt(t: Track, s: number): number {
  return frameAt(t, s).seg;
}
