// Easy drawing, tidy strokes: when the finger lifts, the stroke it drew is
// refitted as a smoothing spline. Wobbles on the straights flatten out,
// corners become even curves, and the stroke leaves the old tip in the
// direction the line was already heading, so strokes join without a kink. The
// fit never crosses the white line (points that would are pinned just inside
// it) and the stroke still ends where the finger lifted, less the fingertip's
// last tremble. Display side only: the result is an ordinary list of points
// that the LineBuilder validates like any other.
//
// The fit minimises  sum w |p - drawn|^2 + sum lambda |p[i-1] - 2 p[i] + p[i+1]|^2
// over points a metre apart. Lambda sets the shortest wobble that survives:
// long on the straights, short where the circuit itself turns tightly, so a
// hairpin keeps its shape while a wavy straight comes out ruler straight.

import { frameAt, projectNear, type Track } from '../sim/track';
import { fitEnd, headingAtEnd, type Vec } from './curve';

const STEP = 1;
/** Pinned points sit this far inside the limit (metres). */
const EDGE_MARGIN = 0.35;
const PIN_ROUNDS = 8;
/** The stroke's end is read from its last few metres. */
const END_SPAN = 5;
const PIN = 1e7;
/** Shortest surviving wobble (metres) as a share of the circuit's corner radius, and its bounds. */
const CUT_PER_RADIUS = 0.6;
const CUT_MIN = 10;
const CUT_MAX = 55;
/** Centreline curvature is measured over this many vertices either side (2 m apart). */
const CURVE_SPAN = 5;
/** ...and the tightest within this many metres of a point decides its smoothing. */
const CURVE_REACH = 25;

/** Fit settings, exposed so scripts/tidytest.ts can compare variations. */
export interface TidyTuning {
  cutPerRadius: number;
  cutMin: number;
  cutMax: number;
  /** How far (metres) a corner's tighter smoothing reaches along the line. */
  reach: number;
}

export const TIDY_DEFAULTS: TidyTuning = { cutPerRadius: CUT_PER_RADIUS, cutMin: CUT_MIN, cutMax: CUT_MAX, reach: CURVE_REACH };

export interface Tidied {
  /** The stroke as drawn, resampled every metre after its first point; ends on the drawn end. */
  raw: Vec[];
  /** The tidied stroke, point for point with `raw`. */
  tidy: Vec[];
}

/** Resample a polyline (metres, flat) from point `from` to the end, every `step` metres. */
function resample(line: ArrayLike<number>, from: number, step: number): Vec[] {
  const n = line.length / 2;
  const out: Vec[] = [{ x: line[from * 2], y: line[from * 2 + 1] }];
  let px = out[0].x;
  let py = out[0].y;
  let carry = 0;
  for (let i = from + 1; i < n; i++) {
    const qx = line[i * 2];
    const qy = line[i * 2 + 1];
    const len = Math.hypot(qx - px, qy - py);
    let u = step - carry;
    while (u <= len) {
      out.push({ x: px + ((qx - px) * u) / len, y: py + ((qy - py) * u) / len });
      u += step;
    }
    carry = len - (u - step);
    px = qx;
    py = qy;
  }
  const end = { x: line[(n - 1) * 2], y: line[(n - 1) * 2 + 1] };
  const last = out[out.length - 1];
  if (out.length > 1 && Math.hypot(end.x - last.x, end.y - last.y) < step * 0.5) out[out.length - 1] = end;
  else if (last.x !== end.x || last.y !== end.y) out.push(end);
  return out;
}

/** Solve a symmetric positive definite pentadiagonal system in place (banded Cholesky). */
function solveBanded(d0: Float64Array, d1: Float64Array, d2: Float64Array, bx: Float64Array, by: Float64Array): void {
  const n = d0.length;
  const l0 = new Float64Array(n);
  const l1 = new Float64Array(n);
  const l2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    l2[i] = i >= 2 ? d2[i - 2] / l0[i - 2] : 0;
    l1[i] = i >= 1 ? (d1[i - 1] - l2[i] * (i >= 1 ? l1[i - 1] : 0)) / l0[i - 1] : 0;
    l0[i] = Math.sqrt(Math.max(1e-12, d0[i] - l2[i] * l2[i] - l1[i] * l1[i]));
  }
  for (const b of [bx, by]) {
    for (let i = 0; i < n; i++) b[i] = (b[i] - (i >= 1 ? l1[i] * b[i - 1] : 0) - (i >= 2 ? l2[i] * b[i - 2] : 0)) / l0[i];
    for (let i = n - 1; i >= 0; i--) b[i] = (b[i] - (i + 1 < n ? l1[i + 1] * b[i + 1] : 0) - (i + 2 < n ? l2[i + 2] * b[i + 2] : 0)) / l0[i];
  }
}

/** Unsigned centreline curvature (1/m) around vertex i. */
function trackCurvature(t: Track, i: number): number {
  const a = (i - CURVE_SPAN + t.n) % t.n;
  const b = (i + CURVE_SPAN) % t.n;
  const cross = t.tx[a] * t.ty[b] - t.ty[a] * t.tx[b];
  const dot = t.tx[a] * t.tx[b] + t.ty[a] * t.ty[b];
  return Math.abs(Math.atan2(cross, dot)) / (t.s[1] * CURVE_SPAN * 2 || 1);
}

/**
 * Tidy the stroke that starts at point `anchor` of `line` (metres, flat
 * [x, y, ...]; the anchor is the tip the stroke began from). `startDir` is the
 * heading to leave the anchor in when there is no line before it to read one
 * from. `hint` is a track segment near the anchor. Null when the stroke is too
 * short to be worth tidying.
 */
export function tidyStroke(track: Track, line: ArrayLike<number>, anchor: number, startDir: Vec, hint: number, tuning: TidyTuning = TIDY_DEFAULTS): Tidied | null {
  const r = resample(line, anchor, STEP);
  const m = r.length - 1;
  if (m < 4) return null;
  const before = Array.prototype.slice.call(line, 0, (anchor + 1) * 2) as number[];
  const dir = headingAtEnd(before) ?? startDir;
  // Nodes: a virtual point a step behind the anchor (it carries the heading),
  // the anchor, the stroke, its end. Only the stroke between the ends moves.
  const T = m + 2;
  const qx = new Float64Array(T);
  const qy = new Float64Array(T);
  qx[0] = r[0].x - dir.x * STEP;
  qy[0] = r[0].y - dir.y * STEP;
  for (let k = 0; k <= m; k++) {
    qx[k + 1] = r[k].x;
    qy[k + 1] = r[k].y;
  }
  // Where each node sits on the circuit, and how hard to smooth there.
  const seg = new Int32Array(T);
  const kappa = new Float64Array(T);
  let h = hint;
  for (let k = 0; k < T; k++) {
    const p = projectNear(track, qx[k], qy[k], h, 12);
    h = seg[k] = p.seg;
    kappa[k] = trackCurvature(track, p.seg);
  }
  // The end holds where the finger lifted, less the fingertip's last tremble.
  const flat: number[] = [];
  for (const p of r) flat.push(p.x, p.y);
  const end = fitEnd(flat, END_SPAN);
  if (end && Math.hypot(end.x - qx[T - 1], end.y - qy[T - 1]) < 0.6 && projectNear(track, end.x, end.y, seg[T - 1], 12).dist <= track.limit - EDGE_MARGIN) {
    qx[T - 1] = end.x;
    qy[T - 1] = end.y;
  }
  const lambda = new Float64Array(T);
  for (let k = 0; k < T; k++) {
    let kMax = 0;
    for (let j = Math.max(0, k - tuning.reach); j <= Math.min(T - 1, k + tuning.reach); j++) if (kappa[j] > kMax) kMax = kappa[j];
    const cut = Math.min(tuning.cutMax, Math.max(tuning.cutMin, kMax > 1e-6 ? tuning.cutPerRadius / kMax : tuning.cutMax));
    const w = cut / (2 * Math.PI * STEP);
    lambda[k] = w * w * w * w;
  }
  const pinned = new Uint8Array(T);
  pinned[0] = pinned[1] = pinned[T - 1] = 1;
  const px = Float64Array.from(qx);
  const py = Float64Array.from(qy);
  const limit = track.limit - EDGE_MARGIN;
  for (let round = 0; round < PIN_ROUNDS; round++) {
    const d0 = new Float64Array(T);
    const d1 = new Float64Array(T);
    const d2 = new Float64Array(T);
    const bx = new Float64Array(T);
    const by = new Float64Array(T);
    for (let k = 0; k < T; k++) {
      const w = pinned[k] ? PIN : 1;
      d0[k] += w;
      bx[k] = w * px[k];
      by[k] = w * py[k];
    }
    for (let c = 1; c < T - 1; c++) {
      const l = lambda[c];
      d0[c - 1] += l;
      d0[c] += 4 * l;
      d0[c + 1] += l;
      d1[c - 1] -= 2 * l;
      d1[c] -= 2 * l;
      d2[c - 1] += l;
    }
    // Free points are pulled towards the drawn line; pinned ones hold where they are.
    for (let k = 0; k < T; k++) {
      if (pinned[k]) continue;
      bx[k] = qx[k];
      by[k] = qy[k];
    }
    solveBanded(d0, d1, d2, bx, by);
    let added = 0;
    for (let k = 0; k < T; k++) {
      if (pinned[k]) continue;
      px[k] = bx[k];
      py[k] = by[k];
      const p = projectNear(track, px[k], py[k], seg[k], 12);
      if (p.dist <= limit) continue;
      // Over the line: hold this point just inside it and fit the rest again.
      const f = frameAt(track, p.s);
      const side = p.d >= 0 ? limit : -limit;
      px[k] = f.x + f.nx * side;
      py[k] = f.y + f.ny * side;
      pinned[k] = 1;
      added++;
    }
    if (!added) break;
  }
  const raw: Vec[] = [];
  const tidy: Vec[] = [];
  for (let k = 2; k < T; k++) {
    raw.push({ x: qx[k], y: qy[k] });
    tidy.push({ x: px[k], y: py[k] });
  }
  return { raw, tidy };
}

/** Points part way from the drawn stroke to the tidied one (0 drawn, 1 tidied). */
export function blend(t: Tidied, k: number): Vec[] {
  return t.raw.map((p, i) => ({ x: p.x + (t.tidy[i].x - p.x) * k, y: p.y + (t.tidy[i].y - p.y) * k }));
}
