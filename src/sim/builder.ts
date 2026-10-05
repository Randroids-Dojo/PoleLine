// Incremental line drawing. The draw screen feeds finger positions (already in
// track metres) into a LineBuilder, which only ever stores points that pass the
// same checks the server's validatePath runs. Ink only flows forward: a finger
// dragged backwards simply stops adding points. A segment that would leave the
// track runs only as far as the white line (touching it is legal) and `offTrack`
// records where it went over, so a track-limits hit always happens at the end
// of the line, whatever the scroll mode. The player undoes the stroke or
// carries on from there.

import { MAX_POINTS, MIN_POINT_SPACING, UNITS_PER_METRE, cloneState, quantize, startState, walkSegment, type WalkState } from './path.js';
import { projectNear, type Track } from './track.js';

export type BuilderStatus = 'idle' | 'drawing' | 'done';

export type ExtendResult = 'skip' | 'ok' | 'backward' | 'offtrack' | 'finish';

/** How far from the start line (metres) a first touch may land and still snap onto it. */
export const START_TOUCH_RANGE = 16;

export class LineBuilder {
  readonly track: Track;
  status: BuilderStatus = 'idle';
  /** Quantised points (decimetres), flat [x, y, ...]. */
  private pts: number[] = [];
  private state: WalkState | null = null;
  private strokes: { count: number; state: WalkState }[] = [];
  /** Points that belong to a line drawn for the player (the tutorial); undo never removes them. */
  private base = 1;
  /** Where the most recent refused segment left the track. Cleared on undo or the next accepted point. */
  offTrack: { x: number; y: number } | null = null;

  constructor(track: Track) {
    this.track = track;
  }

  get count(): number {
    return this.pts.length / 2;
  }

  get points(): readonly number[] {
    return this.pts;
  }

  /** Progress through the lap in metres (0..length). */
  get progress(): number {
    return this.state ? Math.max(0, this.state.sMax) : 0;
  }

  get lastPoint(): { x: number; y: number } | null {
    if (!this.pts.length) return null;
    const n = this.pts.length;
    return { x: this.pts[n - 2] / UNITS_PER_METRE, y: this.pts[n - 1] / UNITS_PER_METRE };
  }

  /** Where the line started, so the player can aim to close the loop on it. */
  get firstPoint(): { x: number; y: number } | null {
    if (!this.pts.length) return null;
    return { x: this.pts[0] / UNITS_PER_METRE, y: this.pts[1] / UNITS_PER_METRE };
  }

  get hint(): number {
    return this.state ? this.state.hint : 0;
  }

  /** Is (x, y) close enough to the start line to begin a lap? */
  canStartAt(x: number, y: number): boolean {
    const t = this.track;
    const p = projectNear(t, x, y, 0, 12);
    let s = p.s;
    if (s > t.length / 2) s -= t.length;
    return Math.abs(s) <= START_TOUCH_RANGE && p.dist <= t.limit + 2;
  }

  /** Begin the lap at the start line, at the lateral position nearest (x, y). */
  start(x: number, y: number): boolean {
    if (this.status !== 'idle' || !this.canStartAt(x, y)) return false;
    const t = this.track;
    const p = projectNear(t, x, y, 0, 12);
    const max = t.limit - 0.15;
    const d = p.d > max ? max : p.d < -max ? -max : p.d;
    const qx = quantize(t.x[0] + t.nx[0] * d);
    const qy = quantize(t.y[0] + t.ny[0] * d);
    const st = startState(t, qx / UNITS_PER_METRE, qy / UNITS_PER_METRE);
    if (!st) return false;
    this.pts = [qx, qy];
    this.state = st.state;
    this.status = 'drawing';
    this.strokes = [{ count: 1, state: cloneState(st.state) }];
    return true;
  }

  /** Mark the start of a new finger stroke (for undo). */
  beginStroke(): void {
    if (this.status !== 'drawing' || !this.state) return;
    const last = this.strokes[this.strokes.length - 1];
    if (last && last.count === this.count) return;
    this.strokes.push({ count: this.count, state: cloneState(this.state) });
  }

  /** Remove the most recent stroke. */
  undoStroke(): boolean {
    if (this.status !== 'drawing' || this.strokes.length === 0) return false;
    let target = this.strokes[this.strokes.length - 1];
    if (target.count === this.count && this.strokes.length > 1) {
      this.strokes.pop();
      target = this.strokes[this.strokes.length - 1];
    }
    if (target.count === this.count) return false;
    this.pts.length = target.count * 2;
    this.state = cloneState(target.state);
    this.offTrack = null;
    return true;
  }

  get canUndo(): boolean {
    return this.status === 'drawing' && this.count > this.base;
  }

  /** Points drawn for the player before they take over (0 without a preloaded line). */
  get preloaded(): number {
    return this.base > 1 ? this.base : 0;
  }

  /**
   * Begin from a line already drawn for the player (decimetre points, flat
   * [x, y, ...]). It is walked exactly as the server's validator walks it, and
   * undo stops at its end. Returns false if it is not a legal opening.
   */
  preload(points: readonly number[]): boolean {
    this.reset();
    if (points.length < 4 || points.length % 2) return false;
    const st = startState(this.track, points[0] / UNITS_PER_METRE, points[1] / UNITS_PER_METRE);
    if (!st) return false;
    const state = st.state;
    for (let i = 2; i < points.length; i += 2) {
      const r = walkSegment(this.track, points[i - 2] / UNITS_PER_METRE, points[i - 1] / UNITS_PER_METRE, points[i] / UNITS_PER_METRE, points[i + 1] / UNITS_PER_METRE, state);
      if (r.kind !== 'ok') {
        this.reset();
        return false;
      }
    }
    this.pts = points.slice();
    this.state = state;
    this.status = 'drawing';
    this.base = this.count;
    this.strokes = [{ count: this.count, state: cloneState(state) }];
    return true;
  }

  extend(x: number, y: number): ExtendResult {
    if (this.status !== 'drawing' || !this.state) return 'skip';
    const last = this.lastPoint!;
    const ddx = x - last.x;
    const ddy = y - last.y;
    if (ddx * ddx + ddy * ddy < MIN_POINT_SPACING * MIN_POINT_SPACING) return 'skip';
    if (this.count >= MAX_POINTS - 1) return 'skip';
    const qx = quantize(x);
    const qy = quantize(y);
    const bx = qx / UNITS_PER_METRE;
    const by = qy / UNITS_PER_METRE;
    const trial = cloneState(this.state);
    const r = walkSegment(this.track, last.x, last.y, bx, by, trial);
    if (r.kind === 'backward') return 'backward';
    if (r.kind === 'offtrack') {
      this.runToLimit(last, bx, by);
      return 'offtrack';
    }
    if (r.kind === 'finish') {
      const fx = quantize(last.x + (bx - last.x) * r.u);
      const fy = quantize(last.y + (by - last.y) * r.u);
      const check = cloneState(this.state);
      const r2 = walkSegment(this.track, last.x, last.y, fx / UNITS_PER_METRE, fy / UNITS_PER_METRE, check);
      if (r2.kind === 'offtrack') {
        this.offTrack = { x: r2.x, y: r2.y };
        return 'offtrack';
      }
      this.pts.push(fx, fy);
      this.state = check;
      this.status = 'done';
      this.offTrack = null;
      return 'finish';
    }
    this.pts.push(qx, qy);
    this.state = trial;
    this.offTrack = null;
    return 'ok';
  }

  /**
   * The segment from the tip towards (bx, by) leaves the track: run the line
   * along it to the white line and mark where it crosses. Every stored point
   * still passes the same walk the server's validator runs.
   */
  private runToLimit(last: { x: number; y: number }, bx: number, by: number): void {
    const state = this.state!;
    const dx = bx - last.x;
    const dy = by - last.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    const inside = (u: number) => walkSegment(this.track, last.x, last.y, last.x + dx * u, last.y + dy * u, cloneState(state)).kind === 'ok';
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (inside(mid)) lo = mid;
      else hi = mid;
    }
    this.offTrack = { x: last.x + dx * hi, y: last.y + dy * hi };
    // Back off a few centimetres so the quantised point stays inside the line.
    for (let back = 0.05; back < 1; back += 0.1) {
      const reach = lo * len - back;
      if (reach < MIN_POINT_SPACING) return;
      const qx = quantize(last.x + (dx * reach) / len);
      const qy = quantize(last.y + (dy * reach) / len);
      const check = cloneState(state);
      if (walkSegment(this.track, last.x, last.y, qx / UNITS_PER_METRE, qy / UNITS_PER_METRE, check).kind !== 'ok') continue;
      this.pts.push(qx, qy);
      this.state = check;
      return;
    }
  }

  reset(): void {
    this.status = 'idle';
    this.pts = [];
    this.state = null;
    this.strokes = [];
    this.offTrack = null;
    this.base = 1;
  }
}
