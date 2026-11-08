// Section by section: the lap is cut into sections at each corner's turn-in,
// apex and exit, at brake boards before the corners a car has to brake for,
// and on long straights. For every section the player calls the pedal (gas
// or brake) and, if they like, a move to another lane: the left edge, the
// middle or the right edge of the road. Long sections let the line cross more
// than one lane. The lanes become an ordinary racing line, so it is validated
// like any other; the pedals become the brake zones the lap sim honours
// (src/sim/lapsim.ts, SimOptions.brakes).
//
// Display side only, so it may use any Math. What reaches the sim is the line
// and the brake zones as plain numbers.

import { LineBuilder } from '../sim/builder';
import { simulateLap } from '../sim/lapsim';
import { type Track } from '../sim/track';
import { menger, solveBanded } from './tidy';

export type Pedal = 'gas' | 'brake';
/** -1 the left edge, 0 the middle, 1 the right edge, looking along the lap. */
export type Lane = -1 | 0 | 1;

export interface Pick {
  pedal: Pedal;
  /** The lane the section ends in. */
  lane: Lane;
}

export type MarkKind = 'board' | 'turn' | 'in' | 'apex' | 'out' | 'exit' | 'straight' | 'finish';

export interface Corner {
  entry: number;
  apex: number;
  exit: number;
  /** 1 turns right (towards the right edge), -1 left. */
  dir: 1 | -1;
  /** How far it turns, in degrees. */
  angle: number;
  /** A car has to brake for it. */
  brakes: boolean;
}

export interface Section {
  from: number;
  to: number;
  /** What the section runs up to. */
  end: MarkKind;
  /** The brake board at its end (metres to the turn-in), when it ends at one. */
  board?: number;
  /** The corner it leads into or out of, for inside and outside. */
  corner: number | null;
  /** How many lanes the line can move across in it. */
  reach: 1 | 2;
  /** The centreline vertex it ends on (n for the finish line). */
  v: number;
}

export interface Course {
  length: number;
  corners: Corner[];
  sections: Section[];
}

/** Corners turn at least this tightly (1/m) somewhere along them. */
const CORNER_CURVE = 1 / 230;
/** Corners turn at least this far (degrees). */
const MIN_TURN = 14;
/** Half the window curvature is averaged over (centreline vertices, about 2 m each). */
const CURVE_WINDOW = 6;
/** No section is shorter than this (metres). */
const MIN_SECTION = 22;
/** Straights longer than this are split (metres). */
const MAX_SECTION = 420;
/** Brake boards stand every this many metres before a turn-in. */
const BOARD_STEP = 50;
const MAX_BOARDS = 4;
/** A corner gets brake boards when the reference car slows this much (m/s) for it... */
const SLOW_FOR = 7;
/** ...looking this far (metres) back before the turn-in. */
const BRAKE_LOOK = 300;
/** A section at least this long can cross the whole road. */
const WIDE_REACH = 60;
/** How far inside the limit the edge lanes run (metres). */
const EDGE_MARGIN = 0.35;

/** Distance from the middle to an edge lane (metres). */
export function laneOffset(t: Track): number {
  return t.limit - EDGE_MARGIN;
}

/** Signed curvature at each centreline vertex (1/m), positive turning right, averaged over a short window. */
function curvature(t: Track, half: number): Float64Array {
  const n = t.n;
  const turn = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i === 0 ? n - 1 : i - 1;
    // Right of travel is (-ty, tx), so a positive cross product turns right.
    const cross = t.tx[p] * t.ty[i] - t.ty[p] * t.tx[i];
    const dot = t.tx[p] * t.tx[i] + t.ty[p] * t.ty[i];
    turn[i] = Math.atan2(cross, dot);
  }
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0;
    let len = 0;
    for (let d = -half; d <= half; d++) {
      const j = (((i + d) % n) + n) % n;
      a += turn[j];
      len += t.segLen[j];
    }
    k[i] = a / len;
  }
  return k;
}

/** How fast a reference car (the centreline on mediums) goes at each sample, and where. */
function reference(t: Track): { s: Float32Array; v: Float32Array } {
  const pts = new Float64Array(t.n * 2);
  for (let i = 0; i < t.n; i++) {
    pts[i * 2] = t.x[i];
    pts[i * 2 + 1] = t.y[i];
  }
  const lap = simulateLap(t, pts, 'medium');
  return { s: lap.s, v: lap.v };
}

function findCorners(t: Track): Corner[] {
  const n = t.n;
  const k = curvature(t, CURVE_WINDOW);
  // Start the search on the straightest vertex so no corner is split by the wrap.
  let start = 0;
  for (let i = 1; i < n; i++) if (Math.abs(k[i]) < Math.abs(k[start])) start = i;
  type Run = { a: number; b: number; dir: 1 | -1 };
  const runs: Run[] = [];
  let cur: Run | null = null;
  for (let m = 0; m <= n; m++) {
    const i = (start + m) % n;
    const dir: 1 | -1 | 0 = m < n && Math.abs(k[i]) >= CORNER_CURVE ? (k[i] > 0 ? 1 : -1) : 0;
    if (cur && dir === cur.dir) {
      cur.b = m;
      continue;
    }
    if (cur) runs.push(cur);
    cur = dir ? { a: m, b: m, dir } : null;
  }
  // Join runs of the same hand separated by a short gap (one corner that eases off).
  const merged: Run[] = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && last.dir === r.dir && (r.a - last.b) * 2 < 24) last.b = r.b;
    else merged.push({ ...r });
  }
  const sAt = (m: number) => {
    const i = (start + m) % n;
    return t.s[i];
  };
  const corners: Corner[] = [];
  for (const r of merged) {
    // Widen to where the turning really starts and stops (half the threshold).
    let a = r.a;
    while (a > r.a - 15 && Math.abs(k[(start + a - 1 + n) % n]) >= CORNER_CURVE * 0.5 && (k[(start + a - 1 + n) % n] > 0 ? 1 : -1) === r.dir) a--;
    let b = r.b;
    while (b < r.b + 15 && Math.abs(k[(start + b + 1) % n]) >= CORNER_CURVE * 0.5 && (k[(start + b + 1) % n] > 0 ? 1 : -1) === r.dir) b++;
    let total = 0;
    for (let m = a; m <= b; m++) total += k[(start + m + n) % n] * t.segLen[(start + m + n) % n];
    const angle = (Math.abs(total) * 180) / Math.PI;
    if (angle < MIN_TURN) continue;
    // The apex is where half the turning is done.
    let acc = 0;
    let apexM = a;
    for (let m = a; m <= b; m++) {
      acc += k[(start + m + n) % n] * t.segLen[(start + m + n) % n];
      if (Math.abs(acc) >= Math.abs(total) / 2) {
        apexM = m;
        break;
      }
    }
    corners.push({ entry: sAt(a), apex: sAt(apexM), exit: sAt(b), dir: r.dir, angle, brakes: false });
  }
  corners.sort((p, q) => p.apex - q.apex);
  return corners;
}

/** Cut a circuit into sections. Deterministic for a given track. */
export function buildCourse(t: Track): Course {
  const L = t.length;
  const corners = findCorners(t);
  const ref = reference(t);
  type M = { s: number; kind: MarkKind; corner: number | null; board?: number; rank: number };
  const marks: M[] = [];
  const wrap = (s: number) => ((s % L) + L) % L;
  corners.forEach((c, ci) => {
    // Unwrapped positions relative to the apex, so a corner across the start line still reads in order.
    const apex = c.apex;
    const back = (s: number) => {
      let d = apex - s;
      if (d < 0) d += L;
      return d;
    };
    const entryBack = back(c.entry);
    const exitAhead = (() => {
      let d = c.exit - apex;
      if (d < 0) d += L;
      return d;
    })();
    marks.push({ s: wrap(apex), kind: 'apex', corner: ci, rank: 0 });
    marks.push({ s: wrap(apex - entryBack), kind: 'turn', corner: ci, rank: 1 });
    marks.push({ s: wrap(apex + exitAhead), kind: 'exit', corner: ci, rank: 2 });
    // Does the reference car slow for it, and from how far before the turn-in?
    // Its top speed on the way in, the slowest it goes through, and where it
    // starts slowing (the last fast point before the corner).
    const n = ref.s.length;
    let top = 0;
    let topAt = 0;
    let low = Infinity;
    for (let i = 0; i < n; i++) {
      const s = wrap(ref.s[i]);
      let d = apex - s;
      if (d < 0) d += L;
      if (d > L - exitAhead - 1) d -= L;
      if (d <= entryBack + BRAKE_LOOK && d >= 0 && ref.v[i] >= top) {
        top = ref.v[i];
        topAt = d;
      }
      if (d <= entryBack && d >= -exitAhead && ref.v[i] < low) low = ref.v[i];
    }
    if (top - low < SLOW_FOR) return;
    const brakeFrom = topAt - entryBack;
    c.brakes = true;
    // A corner the car slows for gets a point halfway in and halfway out, so
    // the brakes can come off and the gas go on close to where they should.
    if (entryBack > 2 * MIN_SECTION) marks.push({ s: wrap(apex - entryBack / 2), kind: 'in', corner: ci, rank: 2.5 });
    if (exitAhead > 2 * MIN_SECTION) marks.push({ s: wrap(apex + exitAhead / 2), kind: 'out', corner: ci, rank: 2.5 });
    // Room back to the previous corner's exit.
    const prev = corners[(ci - 1 + corners.length) % corners.length];
    let room = c.entry - prev.exit;
    if (room <= 0) room += L;
    if (corners.length === 1) room = L / 2;
    const want = Math.min(MAX_BOARDS, Math.max(1, Math.ceil((brakeFrom + 60) / BOARD_STEP)));
    for (let b = 1; b <= want; b++) {
      const dist = b * BOARD_STEP;
      if (dist > room - MIN_SECTION) break;
      marks.push({ s: wrap(c.entry - dist), kind: 'board', corner: ci, board: dist, rank: 3 });
    }
  });
  // Keep marks clear of the start line and of each other, the more important first.
  marks.sort((a, b) => a.rank - b.rank || a.s - b.s);
  const kept: M[] = [];
  for (const m of marks) {
    if (m.s < MIN_SECTION || m.s > L - MIN_SECTION) continue;
    if (kept.some((o) => Math.abs(o.s - m.s) < MIN_SECTION)) continue;
    kept.push(m);
  }
  kept.sort((a, b) => a.s - b.s);
  // Split long straights evenly.
  const bounds: M[] = [];
  let prevS = 0;
  for (const m of [...kept, { s: L, kind: 'finish' as MarkKind, corner: null, rank: 0 }]) {
    const gap = m.s - prevS;
    const pieces = Math.ceil(gap / MAX_SECTION);
    for (let p = 1; p < pieces; p++) bounds.push({ s: prevS + (gap * p) / pieces, kind: 'straight', corner: null, rank: 4 });
    bounds.push(m);
    prevS = m.s;
  }
  // Every boundary sits on a centreline vertex, so the line can be pinned there.
  const nearest = (s: number) => {
    let lo = 0, hi = t.n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t.s[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1 < t.n && t.s[lo + 1] - s < s - t.s[lo] ? lo + 1 : lo;
  };
  const sections: Section[] = [];
  let from = 0;
  for (const m of bounds) {
    const v = m.kind === 'finish' ? t.n : nearest(m.s);
    m.s = m.kind === 'finish' ? L : t.s[v];
    // Inside and outside follow the corner the section ends at, else the next one.
    let corner = m.corner;
    if (corner === null) {
      const next = corners.findIndex((c) => c.apex > m.s);
      corner = corners.length ? (next >= 0 ? next : 0) : null;
    }
    sections.push({ from, to: m.s, end: m.kind, board: m.board, corner, reach: m.s - from >= WIDE_REACH ? 2 : 1, v });
    from = m.s;
  }
  return { length: L, corners, sections };
}

/** Lanes at every section boundary, from the first boundary (the start line) to the last section planned. */
export function boundaryLanes(picks: readonly Pick[], total: number): number[] {
  // The lap starts in the lane it finishes in; until then, in the middle.
  const first = picks.length === total ? picks[total - 1].lane : 0;
  return [first, ...picks.map((p) => p.lane)];
}

/**
 * Monotone cubic (PCHIP) slopes through (xs, ys): a first guess at the line
 * that never swings past a lane it was not asked to reach.
 */
function slopes(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const m = new Array<number>(n).fill(0);
  for (let k = 1; k < n - 1; k++) {
    const hl = xs[k] - xs[k - 1];
    const hr = xs[k + 1] - xs[k];
    const dl = (ys[k] - ys[k - 1]) / hl;
    const dr = (ys[k + 1] - ys[k]) / hr;
    if (dl * dr <= 0) continue;
    const w1 = 2 * hr + hl;
    const w2 = hr + 2 * hl;
    m[k] = (w1 + w2) / (w1 / dl + w2 / dr);
  }
  return m;
}

function hermite(xs: readonly number[], ys: readonly number[], ms: readonly number[], s: number): number {
  const n = xs.length;
  if (s <= xs[0]) return ys[0];
  if (s >= xs[n - 1]) return ys[n - 1];
  let k = 0;
  while (k < n - 2 && s > xs[k + 1]) k++;
  const h = xs[k + 1] - xs[k];
  const u = (s - xs[k]) / h;
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * ys[k] + (u3 - 2 * u2 + u) * h * ms[k] + (-2 * u3 + 3 * u2) * ys[k + 1] + (u3 - u2) * h * ms[k + 1];
}

const SOLVE_ITERATIONS = 80;
/** The first solve uses every this many vertices. */
const COARSE = 4;
/** Laying a section re-solves only this many sections back. */
const WINDOW_SECTIONS = 3;
/** A sideways change bigger than this (metres) between neighbouring vertices is a fold, not a line. */
const FOLD = 2.5;
/** An unfinished line is solved this far (metres) past its last gate. */
const AHEAD = 60;
/** The first guess aims this far towards the edge inside an edge lane's gate. */
const GATE_AIM = 0.85;

/** The sideways span (metres, positive right) a lane's gate covers: a third of the road. */
export function gate(t: Track, lane: Lane): [number, number] {
  const w = laneOffset(t);
  const third = w / 3;
  return lane < 0 ? [-w, -third] : lane > 0 ? [third, w] : [-third, third];
}

/**
 * Sideways offset (metres, positive right) at every centreline vertex from the
 * start line to the end of the last section planned: the line that bends as
 * little as it can (bending is what costs a car speed) while passing through
 * the gate picked at every section boundary and staying inside the white
 * lines. Index n is the start line again once the whole lap is planned.
 * Solved on every fourth vertex first, then on all of them. With `prev` (the
 * offsets before the latest section was laid) only the last few sections are
 * re-solved; a whole lap is always solved whole, so its line depends only on
 * the picks.
 */
export function solveOffsets(t: Track, course: Course, picks: readonly Pick[], prev?: Float64Array | null): Float64Array {
  const n = t.n;
  const w = laneOffset(t);
  const total = course.sections.length;
  const whole = picks.length === total;
  const lanes = boundaryLanes(picks, total);
  const M = picks.length ? course.sections[picks.length - 1].v : 0;
  const N = M + 1;
  // An unfinished line is solved a little past its last gate, so its end
  // already leads on the way the road does instead of swinging straight at
  // the gate (only up to the gate is returned).
  const NX = whole ? N : Math.min(n, M + Math.round(AHEAD / (t.length / n))) + 1;
  // Knots: the start line and the end of every planned section. Each holds the
  // line inside the third of the road its lane names (a gate).
  const knotAt = [0, ...course.sections.slice(0, picks.length).map((s) => s.v)];
  const lo = new Float64Array(NX).fill(-w);
  const hi = new Float64Array(NX).fill(w);
  const alpha = new Float64Array(NX);
  const sOf = (q: number) => (q >= n ? t.length : t.s[q]);
  const xs = knotAt.map(sOf);
  const ys = lanes.map((l) => l * w * GATE_AIM);
  const ms = slopes(xs, ys);
  for (let q = 0; q < N; q++) alpha[q] = hermite(xs, ys, ms, sOf(q));
  const isKnot = new Uint8Array(NX);
  knotAt.forEach((q, k) => {
    const g = gate(t, lanes[k] as Lane);
    lo[q] = g[0];
    hi[q] = g[1];
    alpha[q] = Math.max(g[0], Math.min(g[1], ys[k]));
    isKnot[q] = 1;
  });
  for (let q = N; q < NX; q++) alpha[q] = alpha[N - 1];
  if (NX < 3) return alpha.slice(0, N);
  // Laying one more section of an unfinished lap: only the last few sections
  // move, so the line before them is kept as it was and holds the join smooth.
  let from = 0;
  if (prev && !whole && picks.length > WINDOW_SECTIONS) {
    const ws = knotAt[picks.length - WINDOW_SECTIONS];
    if (ws >= 2 && prev.length > ws) {
      from = ws - 2;
      for (let q = 0; q < N; q++) {
        if (q < prev.length && (q < ws || !isKnot[q] || (prev[q] >= lo[q] && prev[q] <= hi[q]))) alpha[q] = Math.max(lo[q], Math.min(hi[q], prev[q]));
      }
      for (let q = N; q < NX; q++) alpha[q] = alpha[N - 1];
      for (let q = 0; q < ws; q++) lo[q] = hi[q] = alpha[q];
      // The new section starts from where the old line ends and eases across
      // to its gate, so the first guess has no step at the join.
      const j = prev.length - 1;
      if (j < N - 1) {
        const a0 = alpha[j];
        const a1 = alpha[N - 1];
        const s0 = sOf(j);
        const span = sOf(N - 1) - s0;
        for (let q = j + 1; q < N - 1; q++) {
          const u = Math.min(1, Math.max(0, (sOf(q) - s0) / span));
          alpha[q] = a0 + (a1 - a0) * u * u * (3 - 2 * u);
        }
      }
    }
  }
  const chain: number[] = [];
  for (let q = from; q < NX; q++) chain.push(q);
  // Coarse: every fourth vertex and every knot, then every vertex.
  const coarse = chain.filter((q, k) => k < 2 || q % COARSE === 0 || isKnot[q] || q === NX - 1);
  if (coarse.length >= 3 && coarse.length < chain.length) {
    const sub = Float64Array.from(coarse, (q) => alpha[q]);
    refine(t, coarse, Float64Array.from(coarse, (q) => lo[q]), Float64Array.from(coarse, (q) => hi[q]), sub, whole, 60, 1e-6);
    for (let k = 0; k + 1 < coarse.length; k++) {
      const qa = coarse[k];
      const qb = coarse[k + 1];
      for (let q = qa; q <= qb; q++) alpha[q] = sub[k] + ((sub[k + 1] - sub[k]) * (q - qa)) / (qb - qa);
    }
  }
  const sub = Float64Array.from(chain, (q) => alpha[q]);
  refine(t, chain, Float64Array.from(chain, (q) => lo[q]), Float64Array.from(chain, (q) => hi[q]), sub, whole, SOLVE_ITERATIONS, 1e-5);
  chain.forEach((q, k) => (alpha[q] = sub[k]));
  const out = alpha.slice(0, N);
  // A re-solve of the end that folded the line across the road (a local
  // minimum the whole solve does not fall into): solve it all instead.
  if (from > 0 && maxStep(out) > FOLD) return solveOffsets(t, course, picks);
  return out;
}

/** The biggest sideways change (metres) between neighbouring vertices. */
export function maxStep(a: ArrayLike<number>): number {
  let m = 0;
  for (let q = 1; q < a.length; q++) m = Math.max(m, Math.abs(a[q] - a[q - 1]));
  return m;
}

/**
 * Levenberg-Marquardt on the bending of the chain of centreline vertices
 * `verts` (in order; n stands for the start line at the end of a whole lap),
 * each offset held in [lo, hi] by an active set. Updates `alpha` in place.
 */
function refine(t: Track, verts: readonly number[], lo: Float64Array, hi: Float64Array, alpha: Float64Array, whole: boolean, iterations: number, tol: number): void {
  const n = t.n;
  const N = verts.length;
  const vert = (q: number) => verts[q] % n;
  const px = new Float64Array(N + 2);
  const py = new Float64Array(N + 2);
  // Node q sits at slot q + 1; slots 0 and N + 1 are the nodes either side of
  // the chain once the lap closes on itself.
  const place = (a: Float64Array) => {
    for (let q = 0; q < N; q++) {
      const v = vert(q);
      px[q + 1] = t.x[v] + t.nx[v] * a[q];
      py[q + 1] = t.y[v] + t.ny[v] * a[q];
    }
    if (!whole) return;
    // The finish is the start line: the same point as node 0.
    px[N] = px[1];
    py[N] = py[1];
    px[0] = px[N - 1];
    py[0] = py[N - 1];
    px[N + 1] = px[2];
    py[N + 1] = py[2];
  };
  // Curvature terms: every node with a neighbour on each side. The ends of an
  // unfinished line have none past them, so they bend freely there.
  const c0 = whole ? 0 : 1;
  const c1 = whole ? N - 1 : N - 2;
  const energy = (a: Float64Array) => {
    place(a);
    let e = 0;
    for (let c = c0; c <= c1; c++) {
      const r = menger(px[c], py[c], px[c + 1], py[c + 1], px[c + 2], py[c + 2]);
      e += r.h * r.k * r.k;
    }
    return e;
  };
  const kap = new Float64Array(N);
  const hh = new Float64Array(N);
  const jac = new Float64Array(N * 3);
  const pinned = new Uint8Array(N);
  const eps = 0.01;
  let damp = 1e-3;
  if (whole) alpha[N - 1] = alpha[0];
  let e0 = energy(alpha);
  for (let it = 0; it < iterations; it++) {
    place(alpha);
    for (let c = c0; c <= c1; c++) {
      const r = menger(px[c], py[c], px[c + 1], py[c + 1], px[c + 2], py[c + 2]);
      kap[c] = r.k;
      hh[c] = r.h;
      for (let o = 0; o < 3; o++) {
        const q = c - 1 + o;
        jac[c * 3 + o] = 0;
        if (q < 0 || q >= N) continue;
        const v = vert(q);
        const sx = px[q + 1];
        const sy = py[q + 1];
        px[q + 1] = sx + t.nx[v] * eps;
        py[q + 1] = sy + t.ny[v] * eps;
        const kp = menger(px[c], py[c], px[c + 1], py[c + 1], px[c + 2], py[c + 2]).k;
        px[q + 1] = sx - t.nx[v] * eps;
        py[q + 1] = sy - t.ny[v] * eps;
        const km = menger(px[c], py[c], px[c + 1], py[c + 1], px[c + 2], py[c + 2]).k;
        px[q + 1] = sx;
        py[q + 1] = sy;
        jac[c * 3 + o] = (kp - km) / (2 * eps);
      }
    }
    const d0 = new Float64Array(N);
    const d1 = new Float64Array(N);
    const d2 = new Float64Array(N);
    const grad = new Float64Array(N);
    for (let c = c0; c <= c1; c++) {
      for (let o = 0; o < 3; o++) {
        const f = c - 1 + o;
        if (f < 0 || f >= N) continue;
        const jo = jac[c * 3 + o];
        grad[f] += hh[c] * jo * kap[c];
        d0[f] += hh[c] * jo * jo;
        for (let p = o + 1; p < 3; p++) {
          const g = c - 1 + p;
          if (g >= N) continue;
          const val = hh[c] * jo * jac[c * 3 + p];
          if (g - f === 1) d1[f] += val;
          else d2[f] += val;
        }
      }
    }
    let changed = false;
    for (let q = 0; q < N; q++) {
      // At a bound the fit pushes further out: hold it there. The finish line
      // of a whole lap is the start line, which moves with node 0.
      const pin = (whole && q === N - 1) || hi[q] - lo[q] < 1e-6 || (alpha[q] >= hi[q] - 1e-6 && grad[q] < 0) || (alpha[q] <= lo[q] + 1e-6 && grad[q] > 0) ? 1 : 0;
      if (pin !== pinned[q]) changed = true;
      pinned[q] = pin;
    }
    // Damp the step until it lowers the bending.
    let accepted = false;
    let gain = 0;
    for (let tries = 0; tries < 10 && !accepted; tries++) {
      const a0 = Float64Array.from(d0, (v) => v * (1 + damp) + 1e-9);
      const a1 = d1.slice();
      const a2 = d2.slice();
      const step = Float64Array.from(grad, (g) => -g);
      for (let q = 0; q < N; q++) {
        if (!pinned[q]) continue;
        a0[q] = 1;
        step[q] = 0;
        if (q >= 1) a1[q - 1] = 0;
        if (q < N - 1) a1[q] = 0;
        if (q >= 2) a2[q - 2] = 0;
        if (q < N - 2) a2[q] = 0;
      }
      solveBanded(a0, a1, a2, step);
      const next = new Float64Array(N);
      for (let q = 0; q < N; q++) next[q] = pinned[q] ? alpha[q] : Math.max(lo[q], Math.min(hi[q], alpha[q] + step[q]));
      if (whole) next[N - 1] = next[0];
      const e1 = energy(next);
      if (e1 < e0) {
        gain = e0 - e1;
        alpha.set(next);
        e0 = e1;
        accepted = true;
        damp = Math.max(1e-6, damp / 4);
      } else {
        damp *= 6;
      }
    }
    if (!accepted && !changed) break;
    if (accepted && gain < tol * e0 && !changed) break;
  }
}

/**
 * The planned line as points (metres), one per centreline vertex, from the
 * start line to the end of the last section planned. A whole lap runs a few
 * metres past the line so it crosses it.
 */
export function planPoints(t: Track, course: Course, picks: readonly Pick[], offsets = solveOffsets(t, course, picks)): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const n = t.n;
  const whole = picks.length === course.sections.length;
  const count = offsets.length + (whole ? 3 : 0);
  for (let q = 0; q < count; q++) {
    const v = q % n;
    const a = q < offsets.length ? offsets[q] : offsets[q - n];
    out.push({ x: t.x[v] + t.nx[v] * a, y: t.y[v] + t.ny[v] * a });
  }
  return out;
}

/** The lanes a section can end in, from the lane it starts in. */
export function reachableLanes(section: Section, startLane: number): Lane[] {
  const out: Lane[] = [];
  for (const l of [-1, 0, 1] as Lane[]) if (Math.abs(l - startLane) <= section.reach) out.push(l);
  return out;
}

/** The brake zones for the lap sim: flat [from, to, ...] metres of lap progress. */
export function brakeZones(course: Course, picks: readonly Pick[]): number[] {
  const out: number[] = [];
  const L = course.length;
  course.sections.forEach((sec, k) => {
    if (picks[k]?.pedal !== 'brake') return;
    // A little past each end of the lap, where the line runs a hair either side of the start line.
    const from = sec.from <= 0 ? -10 : sec.from;
    const to = sec.to >= L ? L + 10 : sec.to;
    if (out.length && Math.abs(out[out.length - 1] - from) < 1e-9) out[out.length - 1] = to;
    else out.push(from, to);
  });
  return out;
}

/** Does a lane sit on the inside of the corner a section belongs to? -1 outside, 0 neither, 1 inside. */
export function laneSide(course: Course, section: Section, lane: Lane): -1 | 0 | 1 {
  if (section.corner === null || lane === 0) return 0;
  const c = course.corners[section.corner];
  return lane === c.dir ? 1 : -1;
}

/** Compact text for a plan, for saving: one letter per section, g or b, then l, m or r. */
export function encodePicks(picks: readonly Pick[]): string {
  return picks.map((p) => (p.pedal === 'gas' ? 'g' : 'b') + (p.lane < 0 ? 'l' : p.lane > 0 ? 'r' : 'm')).join('');
}

export function decodePicks(text: string): Pick[] | null {
  if (!/^([gb][lmr])*$/.test(text)) return null;
  const out: Pick[] = [];
  for (let i = 0; i < text.length; i += 2) out.push({ pedal: text[i] === 'g' ? 'gas' : 'brake', lane: text[i + 1] === 'l' ? -1 : text[i + 1] === 'r' ? 1 : 0 });
  return out;
}

const courses = new WeakMap<Track, Course>();

/** A circuit's sections, worked out once per track. */
export function courseFor(t: Track): Course {
  let c = courses.get(t);
  if (!c) {
    c = buildCourse(t);
    courses.set(t, c);
  }
  return c;
}

/**
 * The lanes section k can end in. A section reaches one lane, or any on a
 * long one. The last section also sets the lane the lap starts in, so it may
 * only end where the first section can still reach its own gate from.
 */
export function laneOptions(course: Course, picks: readonly Pick[], k: number): Lane[] {
  const sec = course.sections[k];
  if (!sec) return [];
  const out = reachableLanes(sec, startLane(course, picks, k));
  const total = course.sections.length;
  if (k === total - 1 && total > 1 && picks[0]) {
    const first = course.sections[0];
    const ok = out.filter((l) => Math.abs(l - picks[0].lane) <= first.reach);
    if (ok.length) return ok;
  }
  return out;
}

/**
 * After the pick for section k changes, carry the later lanes along: a lane a
 * later section can no longer reach from where the one before it now ends
 * moves to the nearest one it can. Round a whole lap, the first section
 * starts where the last ends, so the carrying goes on from there.
 */
export function settleLanes(course: Course, picks: Pick[], k: number): void {
  const total = course.sections.length;
  const whole = picks.length === total;
  const steps = whole ? total - 1 : picks.length - 1 - k;
  for (let n = 1; n <= steps; n++) {
    const j = (k + n) % total;
    if (j >= picks.length) break;
    const ok = laneOptions(course, picks, j);
    if (ok.includes(picks[j].lane)) break;
    picks[j] = { ...picks[j], lane: ok.reduce((a, b) => (Math.abs(b - picks[j].lane) < Math.abs(a - picks[j].lane) ? b : a)) };
  }
}

/** The lane a section starts in: where the one before it ends, and the first in the lane the lap finishes in. */
export function startLane(course: Course, picks: readonly Pick[], k: number): Lane {
  if (k > 0) return picks[k - 1]?.lane ?? 0;
  return picks.length === course.sections.length ? picks[picks.length - 1].lane : 0;
}

/** Words for where a section runs to, for the screen's subtitle. */
export function sectionText(s: Section): string {
  switch (s.end) {
    case 'board':
      return `To the ${s.board} m board`;
    case 'turn':
      return 'To the turn-in';
    case 'in':
      return 'Halfway to the apex';
    case 'apex':
      return 'To the apex';
    case 'out':
      return 'Halfway to the exit';
    case 'exit':
      return 'To the exit';
    case 'straight':
      return 'Down the straight';
    default:
      return 'To the line';
  }
}

/**
 * The whole planned lap walked by the same builder the server's validator
 * mirrors: its decimetre points, or null if it is not a legal lap.
 */
export function lapLine(t: Track, course: Course, picks: readonly Pick[]): number[] | null {
  if (picks.length !== course.sections.length) return null;
  const b = new LineBuilder(t);
  const pts = planPoints(t, course, picks);
  if (!b.start(pts[0].x, pts[0].y)) return null;
  for (let i = 1; i < pts.length; i++) {
    const r = b.extend(pts[i].x, pts[i].y);
    if (r === 'finish') return b.points.slice();
    if (r === 'offtrack' || r === 'backward') return null;
  }
  return null;
}
