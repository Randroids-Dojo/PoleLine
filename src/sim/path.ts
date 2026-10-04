// The canonical racing line. A line is a list of points quantised to whole
// decimetres, starting on the start/finish line and ending where it crosses
// that line again one lap later. The quantised integers ARE the line: the
// client simulates exactly what it would submit, and the server re-validates
// and re-simulates the same integers, which is what makes a lap idempotent.

import { projectNear, type Projection, type Track } from './track.js';

export const UNITS_PER_METRE = 10;
/** Minimum spacing between stored points (metres). */
export const MIN_POINT_SPACING = 0.6;
/** Sub-sample spacing used when checking a segment against track limits. */
const SUB_STEP = 0.5;
/** How far a line may drift backwards (projection noise) before it counts as reversing. */
const BACKTRACK_TOLERANCE = 0.25;
const WINDOW = 12;
/** The first point must sit this close to the start line. */
export const START_TOLERANCE = 1.0;
/** The last point must reach at least this close to the finish line. */
export const FINISH_TOLERANCE = 1.0;
export const MAX_POINTS = 20000;

export interface WalkState {
  hint: number;
  /** Raw projected s of the last checked sample, in [0, length). */
  sRaw: number;
  /** Unwrapped progress since the start line. */
  sUn: number;
  /** Furthest progress reached. */
  sMax: number;
}

export type StepResult =
  | { kind: 'ok' }
  | { kind: 'offtrack'; x: number; y: number }
  | { kind: 'backward' }
  | { kind: 'finish'; u: number };

export function quantize(v: number): number {
  return Math.round(v * UNITS_PER_METRE);
}

export function cloneState(s: WalkState): WalkState {
  return { hint: s.hint, sRaw: s.sRaw, sUn: s.sUn, sMax: s.sMax };
}

/** Initialise progress tracking from the first point of a line. */
export function startState(track: Track, x: number, y: number): { state: WalkState; proj: Projection } | null {
  const proj = projectNear(track, x, y, 0, WINDOW);
  let s = proj.s;
  if (s > track.length / 2) s -= track.length;
  if (s > START_TOLERANCE || s < -START_TOLERANCE || proj.dist > track.limit) return null;
  return { state: { hint: proj.seg, sRaw: proj.s, sUn: s, sMax: s }, proj };
}

/**
 * Walk the straight segment a -> b in small steps, checking track limits and
 * forward progress. Mutates `state` up to the last good sample.
 */
export function walkSegment(track: Track, ax: number, ay: number, bx: number, by: number, state: WalkState): StepResult {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(len / SUB_STEP));
  const proj: Projection = { seg: 0, s: 0, d: 0, dist: 0 };
  const L = track.length;
  let prevU = 0;
  let prevS = state.sUn;
  for (let k = 1; k <= steps; k++) {
    const u = k / steps;
    const px = ax + dx * u;
    const py = ay + dy * u;
    projectNear(track, px, py, state.hint, WINDOW, proj);
    let delta = proj.s - state.sRaw;
    if (delta < -L / 2) delta += L;
    else if (delta > L / 2) delta -= L;
    const sUn = state.sUn + delta;
    if (proj.dist > track.limit) return { kind: 'offtrack', x: px, y: py };
    if (sUn < state.sMax - BACKTRACK_TOLERANCE) return { kind: 'backward' };
    if (sUn >= L) {
      const span = sUn - prevS;
      const uc = span > 0 ? prevU + ((u - prevU) * (L - prevS)) / span : u;
      state.hint = proj.seg;
      state.sRaw = proj.s;
      state.sUn = sUn;
      if (sUn > state.sMax) state.sMax = sUn;
      return { kind: 'finish', u: uc };
    }
    state.hint = proj.seg;
    state.sRaw = proj.s;
    state.sUn = sUn;
    if (sUn > state.sMax) state.sMax = sUn;
    prevU = u;
    prevS = sUn;
  }
  return { kind: 'ok' };
}

/** [x0, y0, dx1, dy1, ...] in decimetres. */
export function encodePath(points: Int32Array | number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += 2) {
    if (i === 0) out.push(points[0], points[1]);
    else out.push(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  }
  return out;
}

export function decodePath(code: number[]): Float64Array {
  const out = new Float64Array(code.length);
  let x = 0, y = 0;
  for (let i = 0; i < code.length; i += 2) {
    x += code[i];
    y += code[i + 1];
    out[i] = x / UNITS_PER_METRE;
    out[i + 1] = y / UNITS_PER_METRE;
  }
  return out;
}

export type ValidationError = 'too-short' | 'too-long' | 'bad-start' | 'offtrack' | 'backward' | 'past-finish' | 'incomplete';

export interface ValidationResult {
  ok: boolean;
  error?: ValidationError;
  /** Point index where the failure happened. */
  at?: number;
}

/** Full re-validation of a decoded line (metres, flat [x, y, ...]). */
export function validatePath(track: Track, pts: Float64Array): ValidationResult {
  const count = pts.length / 2;
  if (count < 20) return { ok: false, error: 'too-short' };
  if (count > MAX_POINTS) return { ok: false, error: 'too-long' };
  const start = startState(track, pts[0], pts[1]);
  if (!start) return { ok: false, error: 'bad-start', at: 0 };
  const state = start.state;
  for (let i = 1; i < count; i++) {
    const r = walkSegment(track, pts[i * 2 - 2], pts[i * 2 - 1], pts[i * 2], pts[i * 2 + 1], state);
    if (r.kind === 'offtrack') return { ok: false, error: 'offtrack', at: i };
    if (r.kind === 'backward') return { ok: false, error: 'backward', at: i };
    if (r.kind === 'finish' && i !== count - 1) return { ok: false, error: 'past-finish', at: i };
  }
  if (state.sUn < track.length - FINISH_TOLERANCE) return { ok: false, error: 'incomplete' };
  return { ok: true };
}
