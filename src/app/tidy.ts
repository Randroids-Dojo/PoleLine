// Medium drawing, tidy strokes: when the finger lifts, the stroke it drew is
// corrected into a racing line. The correction works across the track: the
// stroke becomes a sideways offset at every centreline vertex it passes, and
// those offsets are solved so the line bends as little as it can (bending is
// what costs a car speed) while staying near what the player drew and inside
// the white lines. Wobbles and kinks go, straights come out straight, and a
// corner swings out, clips the inside and runs out again the way a racing line
// does. The stroke still leaves the old tip along the line's heading and still
// ends where the finger lifted, so the player's choices at each lift are kept,
// and the fit looks ahead past that point so the stroke ends lined up for the
// track that follows. Display side only: the result is an ordinary list of
// points that the LineBuilder validates like any other.
//
// The fit minimises  sum h k^2 + w sum (a - drawn)^2  over the offsets a, where
// k is the line's curvature at each vertex (Menger, from the vertex and its two
// neighbours) and h the spacing there, subject to |a| <= limit - margin. It is
// solved by Gauss-Newton on that sum of squares, with the track limits held by
// an active set: a vertex that reaches the edge stays there only while the fit
// pushes it outwards.

import { projectNear, type Track } from '../sim/track';
import { fitEnd, headingAtEnd, type Vec } from './curve';

/** Corrected points keep this far inside the limit (metres). */
const EDGE_MARGIN = 0.35;
/** The stroke's end is read from its last few metres, less the fingertip's tremble. */
const END_SPAN = 5;
/** A moved end (see `endAt`) draws the stroke across over at most this many metres. */
const END_RAMP = 60;
const ITERATIONS = 40;
/** Shortest sideways wave (metres) of the drawn line that the correction keeps. */
const KEEP_WAVE = 100;
/** Metres of track past the stroke's end that the correction looks ahead over. */
const AHEAD = 80;

/** Fit settings, exposed so scripts/tidytest.ts can compare variations. */
export interface TidyTuning {
  /** Shortest sideways wave (metres) of the drawn line that survives; shorter ones become the cleanest line. */
  keepWave: number;
  /** Metres of track past the stroke's end the fit looks ahead over, so the stroke ends lined up for what comes next. */
  ahead: number;
}

export const TIDY_DEFAULTS: TidyTuning = { keepWave: KEEP_WAVE, ahead: AHEAD };

export interface Tidied {
  /** The stroke as drawn, read at each centreline vertex it passes, then its end. */
  raw: Vec[];
  /** The corrected stroke, point for point with `raw`. */
  tidy: Vec[];
}

/** Signed curvature through three points (1/m) and the spacing it stands for. */
function menger(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): { k: number; h: number } {
  const ab = Math.hypot(bx - ax, by - ay);
  const bc = Math.hypot(cx - bx, cy - by);
  const ca = Math.hypot(ax - cx, ay - cy);
  const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const den = ab * bc * ca;
  return { k: den > 1e-12 ? (2 * cross) / den : 0, h: (ab + bc) / 2 };
}

/** Solve a symmetric positive definite pentadiagonal system in place (banded Cholesky). */
function solveBanded(d0: Float64Array, d1: Float64Array, d2: Float64Array, b: Float64Array): void {
  const n = d0.length;
  const l0 = new Float64Array(n);
  const l1 = new Float64Array(n);
  const l2 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    l2[i] = i >= 2 ? d2[i - 2] / l0[i - 2] : 0;
    l1[i] = i >= 1 ? (d1[i - 1] - l2[i] * l1[i - 1]) / l0[i - 1] : 0;
    l0[i] = Math.sqrt(Math.max(1e-18, d0[i] - l2[i] * l2[i] - l1[i] * l1[i]));
  }
  for (let i = 0; i < n; i++) b[i] = (b[i] - (i >= 1 ? l1[i] * b[i - 1] : 0) - (i >= 2 ? l2[i] * b[i - 2] : 0)) / l0[i];
  for (let i = n - 1; i >= 0; i--) b[i] = (b[i] - (i + 1 < n ? l1[i + 1] * b[i + 1] : 0) - (i + 2 < n ? l2[i + 2] * b[i + 2] : 0)) / l0[i];
}

/**
 * Correct the stroke that starts at point `anchor` of `line` (metres, flat
 * [x, y, ...]; the anchor is the tip the stroke began from). `startDir` is the
 * heading to leave the anchor in when there is no line before it to read one
 * from. `hint` is a track segment near the anchor. `endAt` moves the end from
 * where the finger lifted to a point of the caller's choosing (the stroke that
 * finishes the lap ends where the lap began). Null when the stroke is too short
 * to correct. `after` pins points past the end (a stroke rejoining the old line
of a lap being edited arrives along it) in place of looking ahead.
 */
export function tidyStroke(track: Track, line: ArrayLike<number>, anchor: number, startDir: Vec, hint: number, tuning: TidyTuning = TIDY_DEFAULTS, endAt?: Vec, after?: Vec[]): Tidied | null {
  const t = track;
  const count = line.length / 2;
  if (count - anchor < 4) return null;

  // Where the stroke runs along the circuit: lap distance (unwrapped from the
  // anchor) and sideways offset for every drawn point.
  const ss: number[] = [];
  const ds: number[] = [];
  let h = hint;
  let sRaw = 0;
  let sUn = 0;
  let seg0 = 0;
  for (let i = anchor; i < count; i++) {
    const p = projectNear(t, line[i * 2], line[i * 2 + 1], h, 12);
    if (i === anchor) {
      sRaw = sUn = p.s;
      seg0 = p.seg;
    } else {
      let delta = p.s - sRaw;
      if (delta < -t.length / 2) delta += t.length;
      else if (delta > t.length / 2) delta -= t.length;
      sUn += delta;
      sRaw = p.s;
    }
    h = p.seg;
    // Ink only flows forward; hold the distance where projection noise dips back.
    ss.push(ss.length ? Math.max(ss[ss.length - 1], sUn) : sUn);
    ds.push(p.d);
  }
  const sA = ss[0];
  const sE = ss[ss.length - 1];
  if (sE - sA < 8) return null;
  // Where the stroke's end node sits along the circuit (the drawn end, or
  // endAt), and how far across the track an endAt is.
  let sStop = sE;
  let dEnd = ds[ds.length - 1];
  if (endAt) {
    const p = projectNear(t, endAt.x, endAt.y, h, 12);
    let delta = p.s - sRaw;
    if (delta < -t.length / 2) delta += t.length;
    else if (delta > t.length / 2) delta -= t.length;
    sStop = Math.max(sE, sUn + delta);
    dEnd = p.d;
  }

  // The free vertices: every centreline vertex the stroke passes, clear of its
  // ends, then (looking ahead) the vertices past its end, which have nothing
  // drawn to stay near and only shape how the stroke leaves.
  const vx: number[] = [];
  const vy: number[] = [];
  const nx: number[] = [];
  const ny: number[] = [];
  const drawn: number[] = [];
  let sv = t.s[seg0];
  let j = 0;
  let ghostFrom = -1;
  const ahead = after?.length ? 0 : tuning.ahead;
  for (let k = 1; sv < sStop + ahead; k++) {
    sv += t.segLen[(seg0 + k - 1) % t.n];
    if (sv <= sA + 0.6) continue;
    if (sv >= sStop - 0.6 && sv < sStop + 2) continue;
    if (sv >= sStop && ghostFrom < 0) ghostFrom = vx.length;
    const v = (seg0 + k) % t.n;
    while (j < ss.length - 2 && ss[j + 1] < sv) j++;
    const span = ss[j + 1] - ss[j];
    const u = span > 1e-9 ? Math.min(1, Math.max(0, (sv - ss[j]) / span)) : 0;
    vx.push(t.x[v]);
    vy.push(t.y[v]);
    nx.push(t.nx[v]);
    ny.push(t.ny[v]);
    const at = sv >= sE ? ds[ds.length - 1] : ds[j] + (ds[j + 1] - ds[j]) * u;
    // A moved end pulls the stroke's aim across over its last stretch, so the
    // fit starts from (and stays near) a line that actually reaches it.
    const ramp = endAt ? Math.min(1, Math.max(0, 1 - (sStop - sv) / Math.min(END_RAMP, sStop - sA))) : 0;
    drawn.push(at + (dEnd - at) * ramp * ramp * (3 - 2 * ramp));
  }
  const m = vx.length;
  const drawnCount = ghostFrom < 0 ? m : ghostFrom;
  if (drawnCount < 3) return null;

  // Fixed nodes: two points behind the anchor along the line's heading (they
  // keep the join smooth), the anchor, and the end where the finger lifted.
  const before = Array.prototype.slice.call(line, 0, (anchor + 1) * 2) as number[];
  const dir = headingAtEnd(before) ?? startDir;
  const ax = line[anchor * 2];
  const ay = line[anchor * 2 + 1];
  let ex = endAt ? endAt.x : line[(count - 1) * 2];
  let ey = endAt ? endAt.y : line[(count - 1) * 2 + 1];
  const tail = Array.prototype.slice.call(line, anchor * 2) as number[];
  const end = endAt ? null : fitEnd(tail, END_SPAN);
  if (end && Math.hypot(end.x - ex, end.y - ey) < 0.6 && projectNear(t, end.x, end.y, h, 12).dist <= t.limit - EDGE_MARGIN) {
    ex = end.x;
    ey = end.y;
  }
  // Node layout: behind2, behind1, anchor, drawn vertices, end, then the
  // vertices ahead (or the pinned points after the end). fi maps a node to its
  // free offset (or -1 for a fixed node).
  const pinnedAfter = after ?? [];
  const N = 4 + m + pinnedAfter.length;
  const fi = new Int32Array(N).fill(-1);
  for (let i = 0; i < m; i++) fi[3 + i + (i >= drawnCount ? 1 : 0)] = i;
  const endNode = 3 + drawnCount;
  const px = new Float64Array(N);
  const py = new Float64Array(N);
  px[0] = ax - dir.x * 4;
  py[0] = ay - dir.y * 4;
  px[1] = ax - dir.x * 2;
  py[1] = ay - dir.y * 2;
  px[2] = ax;
  py[2] = ay;
  px[endNode] = ex;
  py[endNode] = ey;
  pinnedAfter.forEach((p, k) => {
    px[endNode + 1 + k] = p.x;
    py[endNode + 1 + k] = p.y;
  });
  const nodeOf = new Int32Array(m);
  for (let q = 0; q < N; q++) if (fi[q] >= 0) nodeOf[fi[q]] = q;

  const lim = t.limit - EDGE_MARGIN;
  const alpha = Float64Array.from(drawn, (a) => Math.max(-lim, Math.min(lim, a)));
  const target = Float64Array.from(alpha);
  const place = (a: Float64Array) => {
    for (let i = 0; i < m; i++) {
      px[nodeOf[i]] = vx[i] + nx[i] * a[i];
      py[nodeOf[i]] = vy[i] + ny[i] * a[i];
    }
  };
  // Fidelity: a sideways wave of length keepWave costs as much in bending as in
  // straying from the drawing (vertices are about 2 m apart). Vertices ahead
  // barely care where they are.
  const wave = (2 * Math.PI) / tuning.keepWave;
  const w = 2 * wave * wave * wave * wave;
  const wt = new Float64Array(m);
  for (let i = 0; i < m; i++) wt[i] = i < drawnCount ? w : w * 0.01;
  const energy = (a: Float64Array) => {
    place(a);
    let e = 0;
    for (let c = 1; c < N - 1; c++) {
      const r = menger(px[c - 1], py[c - 1], px[c], py[c], px[c + 1], py[c + 1]);
      e += r.h * r.k * r.k;
    }
    for (let i = 0; i < m; i++) e += wt[i] * (a[i] - target[i]) * (a[i] - target[i]);
    return e;
  };

  // Gauss-Newton. Curvature at node c depends on the offsets of nodes c-1, c
  // and c+1, so the normal equations are pentadiagonal in the free offsets.
  const pinned = new Uint8Array(m);
  const kap = new Float64Array(N);
  const hh = new Float64Array(N);
  const jac = new Float64Array(N * 3);
  const eps = 0.01;
  let e0 = energy(alpha);
  for (let it = 0; it < ITERATIONS; it++) {
    place(alpha);
    for (let c = 1; c < N - 1; c++) {
      const r = menger(px[c - 1], py[c - 1], px[c], py[c], px[c + 1], py[c + 1]);
      kap[c] = r.k;
      hh[c] = r.h;
      // d k_c / d a for each neighbour that is free.
      for (let o = 0; o < 3; o++) {
        const q = c - 1 + o;
        const f = fi[q];
        jac[c * 3 + o] = 0;
        if (f < 0) continue;
        const sx = px[q];
        const sy = py[q];
        px[q] = sx + nx[f] * eps;
        py[q] = sy + ny[f] * eps;
        const kp = menger(px[c - 1], py[c - 1], px[c], py[c], px[c + 1], py[c + 1]).k;
        px[q] = sx - nx[f] * eps;
        py[q] = sy - ny[f] * eps;
        const km = menger(px[c - 1], py[c - 1], px[c], py[c], px[c + 1], py[c + 1]).k;
        px[q] = sx;
        py[q] = sy;
        jac[c * 3 + o] = (kp - km) / (2 * eps);
      }
    }
    const d0 = new Float64Array(m);
    const d1 = new Float64Array(m);
    const d2 = new Float64Array(m);
    const grad = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      d0[i] = wt[i];
      grad[i] = wt[i] * (alpha[i] - target[i]);
    }
    for (let c = 1; c < N - 1; c++) {
      for (let o = 0; o < 3; o++) {
        const f = fi[c - 1 + o];
        if (f < 0) continue;
        const jo = jac[c * 3 + o];
        grad[f] += hh[c] * jo * kap[c];
        d0[f] += hh[c] * jo * jo;
        for (let p = o + 1; p < 3; p++) {
          const g = fi[c - 1 + p];
          if (g < 0) continue;
          const v = hh[c] * jo * jac[c * 3 + p];
          if (g - f === 1) d1[f] += v;
          else if (g - f === 2) d2[f] += v;
        }
      }
    }
    // Track limits: a vertex at the edge that the fit pushes further out stays
    // there; one it would pull back in is released.
    let changed = false;
    for (let i = 0; i < m; i++) {
      const atEdge = Math.abs(alpha[i]) >= lim - 1e-6;
      const outward = grad[i] * Math.sign(alpha[i]) < 0;
      const pin = atEdge && outward ? 1 : 0;
      if (pin !== pinned[i]) changed = true;
      pinned[i] = pin;
    }
    const step = Float64Array.from(grad, (g) => -g);
    for (let i = 0; i < m; i++) {
      if (!pinned[i]) continue;
      d0[i] = 1;
      step[i] = 0;
      if (i >= 1) d1[i - 1] = 0;
      if (i < m - 1) d1[i] = 0;
      if (i >= 2) d2[i - 2] = 0;
      if (i < m - 2) d2[i] = 0;
    }
    solveBanded(d0, d1, d2, step);
    // Damped step, projected inside the limits.
    let moved = 0;
    let accepted = false;
    for (let scale = 1; scale > 0.06; scale /= 2) {
      const next = new Float64Array(m);
      let big = 0;
      for (let i = 0; i < m; i++) {
        const st = Math.max(-1.5, Math.min(1.5, step[i] * scale));
        next[i] = Math.max(-lim, Math.min(lim, alpha[i] + st));
        big = Math.max(big, Math.abs(next[i] - alpha[i]));
      }
      const e1 = energy(next);
      if (e1 <= e0) {
        alpha.set(next);
        e0 = e1;
        moved = big;
        accepted = true;
        break;
      }
    }
    if ((!accepted || moved < 1e-3) && !changed) break;
  }

  // The stroke: the drawn vertices, then its end. The look-ahead is dropped.
  const raw: Vec[] = [];
  const tidy: Vec[] = [];
  for (let i = 0; i < drawnCount; i++) {
    raw.push({ x: vx[i] + nx[i] * target[i], y: vy[i] + ny[i] * target[i] });
    tidy.push({ x: vx[i] + nx[i] * alpha[i], y: vy[i] + ny[i] * alpha[i] });
  }
  raw.push({ x: ex, y: ey });
  tidy.push({ x: ex, y: ey });
  return { raw, tidy };
}

/** Points part way from the drawn stroke to the corrected one (0 drawn, 1 corrected). */
export function blend(t: Tidied, k: number): Vec[] {
  return t.raw.map((p, i) => ({ x: p.x + (t.tidy[i].x - p.x) * k, y: p.y + (t.tidy[i].y - p.y) * k }));
}
