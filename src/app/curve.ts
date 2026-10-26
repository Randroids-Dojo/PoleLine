// Easy drawing, tap and bend: the line is laid as a chain of smooth curves.
// Each curve leaves the tip in the direction the line already points (so the
// chain never kinks) and ends where the player tapped, arriving there along
// the circuit's own direction until the next tap shows where the line goes on
// (the draw screen then settles the end direction between the two, like a
// Catmull-Rom spline). A handle at its middle bends it: the curve passes
// through the handle and its far end turns to suit. Display side only: the curve is
// sampled into ordinary points that the LineBuilder validates like any other.

export interface Vec {
  x: number;
  y: number;
}

export interface Curve {
  from: Vec;
  /** Unit direction the line leaves `from` in. */
  dir: Vec;
  to: Vec;
  /** Unit direction the curve arrives at `to` in until it is bent (the circuit's direction there). */
  toDir: Vec;
  /** Once bent: where the middle of the curve passes, and the start handle length it was bent with. */
  bend: { x: number; y: number; reach: number } | null;
}

/** Cubic Bézier control points [p0, p1, p2, p3]. */
export function controls(c: Curve): [Vec, Vec, Vec, Vec] {
  const { from, dir, to } = c;
  const L = Math.hypot(to.x - from.x, to.y - from.y);
  if (L < 1e-6) return [from, from, to, to];
  if (!c.bend) {
    // Equal handles sized like a circular arc turning from `dir` to `toDir`:
    // a third of the chord when they agree, two thirds for a half turn.
    const cos = Math.max(-0.95, dir.x * c.toDir.x + dir.y * c.toDir.y);
    // cos^2 of a quarter of the turn, from the cosine of the whole turn.
    const cosHalf = Math.sqrt((1 + cos) / 2);
    const q = (1 + cosHalf) / 2;
    const a = Math.min(0.9 * L, L / (3 * q));
    return [from, { x: from.x + dir.x * a, y: from.y + dir.y * a }, { x: to.x - c.toDir.x * a, y: to.y - c.toDir.y * a }, to];
  }
  // Through the handle at t = 0.5: B(0.5) = (p0 + 3 p1 + 3 p2 + p3) / 8, with
  // p1 held on the start direction so the join with the line stays smooth.
  const m = c.bend;
  const p1 = { x: from.x + dir.x * m.reach, y: from.y + dir.y * m.reach };
  const p2 = { x: (8 * m.x - from.x - to.x - 3 * p1.x) / 3, y: (8 * m.y - from.y - to.y - 3 * p1.y) / 3 };
  return [from, p1, p2, to];
}

/** Start bending a curve: the handle starts where the middle already is, so nothing jumps. */
export function startBend(c: Curve): Curve {
  if (c.bend) return c;
  const p = controls(c);
  const m = at(p, 0.5);
  return { ...c, bend: { x: m.x, y: m.y, reach: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) } };
}

function at(p: [Vec, Vec, Vec, Vec], t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * p[0].x + b * p[1].x + c * p[2].x + d * p[3].x, y: a * p[0].y + b * p[1].y + c * p[2].y + d * p[3].y };
}

/** The point the bend handle sits on. */
export function midpoint(c: Curve): Vec {
  return c.bend ? { x: c.bend.x, y: c.bend.y } : at(controls(c), 0.5);
}

/** Unit direction the curve arrives at `to` in: where the next curve starts from. */
export function endDir(c: Curve): Vec {
  const p = controls(c);
  let dx = p[3].x - p[2].x;
  let dy = p[3].y - p[2].y;
  if (dx * dx + dy * dy < 1e-6) {
    dx = p[3].x - p[1].x;
    dy = p[3].y - p[1].y;
  }
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/** Points every `step` metres along the curve, after `from`, ending exactly on `to`. */
export function sampleCurve(c: Curve, step = 1): Vec[] {
  const p = controls(c);
  const rough = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) + Math.hypot(p[2].x - p[1].x, p[2].y - p[1].y) + Math.hypot(p[3].x - p[2].x, p[3].y - p[2].y);
  const n = Math.max(8, Math.ceil(rough * 6));
  const out: Vec[] = [];
  let prev = p[0];
  let run = 0;
  for (let k = 1; k <= n; k++) {
    const q = at(p, k / n);
    run += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
    if (run >= step && k < n) {
      out.push(q);
      run = 0;
    }
  }
  // Land exactly on the tapped point; drop a sample that would crowd it.
  if (out.length && run < step * 0.5) out.pop();
  out.push({ x: c.to.x, y: c.to.y });
  return out;
}

/**
 * Where a polyline (metres, flat [x, y, ...]) ends and the direction it is
 * heading there, from a quadratic fitted to its last `span` metres: true on a
 * curve, and free of fingertip jitter and decimetre rounding. Null if the
 * polyline is too short to read.
 */
export function fitEnd(pts: ArrayLike<number>, span = 8): { x: number; y: number; dir: Vec } | null {
  const n = pts.length / 2;
  if (n < 2) return null;
  const ex = pts[(n - 1) * 2];
  const ey = pts[(n - 1) * 2 + 1];
  // Arc length back from the end (negative), for each point inside the span.
  const s: number[] = [0];
  const xs: number[] = [ex];
  const ys: number[] = [ey];
  let acc = 0;
  for (let i = n - 2; i >= 0 && acc < span; i--) {
    const x = pts[i * 2];
    const y = pts[i * 2 + 1];
    acc += Math.hypot(x - xs[xs.length - 1], y - ys[ys.length - 1]);
    s.push(-acc);
    xs.push(x);
    ys.push(y);
  }
  if (acc < 0.3) return null;
  // Least squares x(s) = a + b s + c s^2 (and y): a is the end, b its heading.
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, x0 = 0, x1 = 0, x2 = 0, y0 = 0, y1 = 0, y2 = 0;
  const m = s.length;
  for (let k = 0; k < m; k++) {
    const t = s[k];
    const t2 = t * t;
    s1 += t; s2 += t2; s3 += t2 * t; s4 += t2 * t2;
    x0 += xs[k]; x1 += xs[k] * t; x2 += xs[k] * t2;
    y0 += ys[k]; y1 += ys[k] * t; y2 += ys[k] * t2;
  }
  const det = m * (s2 * s4 - s3 * s3) - s1 * (s1 * s4 - s3 * s2) + s2 * (s1 * s3 - s2 * s2);
  let ax = ex, ay = ey, bx: number, by: number;
  if (m >= 4 && Math.abs(det) > 1e-9) {
    // Cramer's rule for the constant and linear coefficients.
    const solveA = (r0: number, r1: number, r2: number) => (r0 * (s2 * s4 - s3 * s3) - s1 * (r1 * s4 - s3 * r2) + s2 * (r1 * s3 - s2 * r2)) / det;
    const solveB = (r0: number, r1: number, r2: number) => (m * (r1 * s4 - s3 * r2) - r0 * (s1 * s4 - s3 * s2) + s2 * (s1 * r2 - r1 * s2)) / det;
    ax = solveA(x0, x1, x2);
    ay = solveA(y0, y1, y2);
    bx = solveB(x0, x1, x2);
    by = solveB(y0, y1, y2);
  } else {
    bx = ex - xs[m - 1];
    by = ey - ys[m - 1];
  }
  const l = Math.hypot(bx, by);
  if (l < 1e-9) return null;
  return { x: ax, y: ay, dir: { x: bx / l, y: by / l } };
}

/** The direction a polyline (metres, flat) is heading at its end; see fitEnd. */
export function headingAtEnd(pts: ArrayLike<number>, span = 8): Vec | null {
  return fitEnd(pts, span)?.dir ?? null;
}
