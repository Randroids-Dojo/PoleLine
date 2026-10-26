// Editing a saved line. The player touches the line where a change starts,
// redraws from there, and rejoins the old line further on: everything after
// the join is the old line again, so one corner can be fixed without drawing
// the whole lap. These helpers work on the old line (decimetre points, flat
// [x, y, ...]) and its lap progress at every point. Display side only: the
// spliced line is walked by the LineBuilder like any other.

import { UNITS_PER_METRE, startState, walkSegment } from '../sim/path';
import type { Track } from '../sim/track';
import type { Vec } from './curve';

/** Lap progress (metres from the start line, the furthest reached so far) at every point of a line. */
export function lineProgress(track: Track, pts: readonly number[]): Float64Array {
  const n = pts.length / 2;
  const out = new Float64Array(n);
  if (n < 1) return out;
  const st = startState(track, pts[0] / UNITS_PER_METRE, pts[1] / UNITS_PER_METRE);
  if (!st) return out;
  const state = st.state;
  out[0] = Math.max(0, state.sMax);
  for (let i = 1; i < n; i++) {
    walkSegment(track, pts[i * 2 - 2] / UNITS_PER_METRE, pts[i * 2 - 1] / UNITS_PER_METRE, pts[i * 2] / UNITS_PER_METRE, pts[i * 2 + 1] / UNITS_PER_METRE, state);
    out[i] = state.sMax;
  }
  return out;
}

/** The first index whose progress reaches `s` (the length when none does). Progress never falls, so this is a binary search. */
export function indexAt(progress: Float64Array, s: number): number {
  let lo = 0;
  let hi = progress.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (progress[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function pointAt(pts: readonly number[], i: number): Vec {
  return { x: pts[i * 2] / UNITS_PER_METRE, y: pts[i * 2 + 1] / UNITS_PER_METRE };
}

/** The point of the line nearest (x, y) and how far away it is (metres), searching indices from..to. */
export function nearestPoint(pts: readonly number[], x: number, y: number, from = 0, to = pts.length / 2): { index: number; dist: number } {
  let best = -1;
  let bestD = Infinity;
  for (let i = Math.max(0, from); i < Math.min(to, pts.length / 2); i++) {
    const dx = pts[i * 2] / UNITS_PER_METRE - x;
    const dy = pts[i * 2 + 1] / UNITS_PER_METRE - y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return { index: best, dist: Math.sqrt(bestD) };
}

/** The direction the line runs at point i, read over a few metres either side. */
export function headingAt(pts: readonly number[], i: number, span = 3): Vec {
  const n = pts.length / 2;
  const p = pointAt(pts, i);
  let a = i;
  let b = i;
  while (a > 0 && Math.hypot(pts[a * 2] / UNITS_PER_METRE - p.x, pts[a * 2 + 1] / UNITS_PER_METRE - p.y) < span) a--;
  while (b < n - 1 && Math.hypot(pts[b * 2] / UNITS_PER_METRE - p.x, pts[b * 2 + 1] / UNITS_PER_METRE - p.y) < span) b++;
  const dx = (pts[b * 2] - pts[a * 2]) / UNITS_PER_METRE;
  const dy = (pts[b * 2 + 1] - pts[a * 2 + 1]) / UNITS_PER_METRE;
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

export interface Join {
  /** The old line's point nearest the tip. */
  index: number;
  dist: number;
}

/**
 * Can a new stretch ending at `tip` (lap progress `tipS`, heading `dir`) rejoin
 * the old line? Only points after `from` count (the part of the old line being
 * replaced), and only beside the tip: within `range` metres and running the
 * same way, so a line that crosses the old one is not caught by it.
 */
export function findJoin(pts: readonly number[], progress: Float64Array, from: number, tip: Vec, tipS: number, dir: Vec | null, range: number): Join | null {
  const lo = Math.max(from, indexAt(progress, tipS - 4));
  const hi = indexAt(progress, tipS + 4);
  if (hi <= lo) return null;
  const near = nearestPoint(pts, tip.x, tip.y, lo, hi);
  if (near.index < 0 || near.dist > range) return null;
  if (dir) {
    const h = headingAt(pts, near.index);
    if (h.x * dir.x + h.y * dir.y < 0.7) return null;
  }
  return { index: near.index, dist: near.dist };
}

/**
 * Freehand rejoin: the old line from beside the tip to the finish (metres),
 * with its first `blend` metres eased across from the tip so the new stretch
 * runs onto the old line instead of jumping to it.
 */
export function blendTail(pts: readonly number[], progress: Float64Array, tip: Vec, tipS: number, join: Join, blend = 8): Vec[] {
  const n = pts.length / 2;
  const near = pointAt(pts, join.index);
  const ox = tip.x - near.x;
  const oy = tip.y - near.y;
  const out: Vec[] = [];
  for (let i = indexAt(progress, tipS + 0.3); i < n; i++) {
    const p = pointAt(pts, i);
    const u = Math.min(1, Math.max(0, (progress[i] - tipS) / blend));
    const k = 1 - u * u * (3 - 2 * u);
    out.push({ x: p.x + ox * k, y: p.y + oy * k });
  }
  return out;
}

/** The old line from point i to the finish (metres). */
export function tailFrom(pts: readonly number[], i: number): Vec[] {
  const out: Vec[] = [];
  for (let k = Math.max(0, i); k < pts.length / 2; k++) out.push(pointAt(pts, k));
  return out;
}

/** Same points, so the same line. */
export function sameLine(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
