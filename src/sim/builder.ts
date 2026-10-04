// Incremental line drawing. The draw screen feeds finger positions (already in
// track metres) into a LineBuilder, which only ever stores points that pass the
// same checks the server's validatePath runs. Ink only flows forward: a finger
// dragged backwards simply stops adding points.

import { MAX_POINTS, MIN_POINT_SPACING, UNITS_PER_METRE, cloneState, quantize, startState, walkSegment, type WalkState } from './path.js';
import { projectNear, type Track } from './track.js';

export type BuilderStatus = 'idle' | 'drawing' | 'done' | 'failed';

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
  /** Where the line left the track, when failed. */
  failPoint: { x: number; y: number } | null = null;

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

  /** Remove the most recent stroke. Not available once the line has failed. */
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
    return true;
  }

  get canUndo(): boolean {
    return this.status === 'drawing' && this.count > 1;
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
      this.status = 'failed';
      this.failPoint = { x: r.x, y: r.y };
      return 'offtrack';
    }
    if (r.kind === 'finish') {
      const fx = quantize(last.x + (bx - last.x) * r.u);
      const fy = quantize(last.y + (by - last.y) * r.u);
      const check = cloneState(this.state);
      const r2 = walkSegment(this.track, last.x, last.y, fx / UNITS_PER_METRE, fy / UNITS_PER_METRE, check);
      if (r2.kind === 'offtrack') {
        this.status = 'failed';
        this.failPoint = { x: r2.x, y: r2.y };
        return 'offtrack';
      }
      this.pts.push(fx, fy);
      this.state = check;
      this.status = 'done';
      return 'finish';
    }
    this.pts.push(qx, qy);
    this.state = trial;
    return 'ok';
  }

  reset(): void {
    this.status = 'idle';
    this.pts = [];
    this.state = null;
    this.strokes = [];
    this.failPoint = null;
  }
}
