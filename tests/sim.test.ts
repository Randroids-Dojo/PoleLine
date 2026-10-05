import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/data/catalog';
import silverstone from '../src/data/geometry/silverstone';
import monaco from '../src/data/geometry/monaco';
import { LineBuilder } from '../src/sim/builder';
import { simulateLap } from '../src/sim/lapsim';
import { decodePath, encodePath, validatePath } from '../src/sim/path';
import { buildTrack, projectGlobal } from '../src/sim/track';
import { minCurvatureOffsets, offsetsToLine, wobble } from '../scripts/optimal';

const silverMeta = CATALOG.find((m) => m.slug === 'silverstone')!;
const monacoMeta = CATALOG.find((m) => m.slug === 'monaco')!;
const silver = buildTrack(silverMeta, silverstone);
const mc = buildTrack(monacoMeta, monaco);
const idealSilver = minCurvatureOffsets(silver);
const idealCode = encodePath(offsetsToLine(silver, idealSilver));

describe('track catalog', () => {
  it('has 24 circuits with sane lengths', () => {
    expect(CATALOG).toHaveLength(24);
    for (const m of CATALOG) {
      expect(Math.abs(m.length - m.officialLength) / m.officialLength).toBeLessThan(0.02);
      // Energy-hungry circuits need more grip to match pre-2026 pole pace.
      expect(m.grip).toBeGreaterThan(0.75);
      expect(m.grip).toBeLessThan(1.45);
    }
  });
});

describe('path codec', () => {
  it('round-trips through the integer encoding', () => {
    const pts = decodePath(idealCode);
    const again = encodePath(Array.from(pts, (v) => Math.round(v * 10)));
    expect(again).toEqual(idealCode);
  });
});

describe('validation', () => {
  it('accepts the ideal line', () => {
    expect(validatePath(silver, decodePath(idealCode)).ok).toBe(true);
  });

  it('rejects a line that cuts across the grass', () => {
    const alpha = new Float64Array(idealSilver);
    for (let i = 600; i < 640; i++) alpha[i] = silver.limit + 3;
    const res = validatePath(silver, decodePath(encodePath(offsetsToLine(silver, alpha))));
    expect(res.ok).toBe(false);
    expect(res.error).toBe('offtrack');
  });

  it('rejects an unfinished lap', () => {
    const code = idealCode.slice(0, Math.floor(idealCode.length / 2 / 2) * 2);
    expect(validatePath(silver, decodePath(code)).error).toBe('incomplete');
  });

  it('rejects a line that does not start on the start line', () => {
    const pts = decodePath(idealCode);
    const shifted = pts.slice(40);
    expect(validatePath(silver, shifted).error).toBe('bad-start');
  });
});

describe('lap simulation', () => {
  it('is idempotent for the same line and tyre', () => {
    const a = simulateLap(silver, decodePath(idealCode), 'soft');
    const b = simulateLap(silver, decodePath(idealCode), 'soft');
    expect(a.timeMs).toBe(b.timeMs);
    expect(a.sectorsMs).toEqual(b.sectorsMs);
    expect(Array.from(a.t)).toEqual(Array.from(b.t));
  });

  it('lands in the ballpark of real pole pace', () => {
    const lap = simulateLap(silver, decodePath(idealCode), 'soft');
    const ratio = lap.timeMs / (silverMeta.poleRef * 1000);
    expect(ratio).toBeGreaterThan(0.95);
    expect(ratio).toBeLessThan(1.05);
    expect(lap.sectorsMs[0] + lap.sectorsMs[1] + lap.sectorsMs[2]).toBe(lap.timeMs);
  });

  it('reacts to tiny line changes', () => {
    const base = simulateLap(silver, decodePath(idealCode), 'soft');
    // One point moved 10 cm: the unrounded lap time changes.
    const tweaked = decodePath(idealCode);
    tweaked[2001] += 0.1;
    const nudged = simulateLap(silver, tweaked, 'soft');
    expect(nudged.t[nudged.n]).not.toBe(base.t[base.n]);
    // Half a metre through a corner shows up on the stopwatch.
    const alpha = new Float64Array(idealSilver);
    for (let i = 440; i < 470; i++) alpha[i] -= 0.5 * Math.sin(((i - 440) / 30) * Math.PI);
    const corner = simulateLap(silver, decodePath(encodePath(offsetsToLine(silver, alpha))), 'soft');
    expect(corner.timeMs).toBeGreaterThan(base.timeMs);
  });

  it('punishes a wobbly line and a centre line', () => {
    const ideal = simulateLap(silver, decodePath(idealCode), 'soft').timeMs;
    const wob = simulateLap(silver, decodePath(encodePath(offsetsToLine(silver, wobble(silver, idealSilver, 7, 0.8, 50, 0.1)))), 'soft').timeMs;
    const centre = simulateLap(silver, decodePath(encodePath(offsetsToLine(silver, new Float64Array(silver.n)))), 'soft').timeMs;
    expect(wob).toBeGreaterThan(ideal);
    expect(centre).toBeGreaterThan(wob);
  });

  it('orders compounds soft < medium < hard on a cool track', () => {
    const line = decodePath(idealCode);
    const s = simulateLap(silver, line, 'soft').timeMs;
    const m = simulateLap(silver, line, 'medium').timeMs;
    const h = simulateLap(silver, line, 'hard').timeMs;
    expect(s).toBeLessThan(m);
    expect(m).toBeLessThan(h);
  });
});

describe('line builder', () => {
  function drawIdeal(track: typeof mc, alpha: Float64Array, step = 3) {
    const b = new LineBuilder(track);
    const p0 = { x: track.x[0] + alpha[0] * track.nx[0], y: track.y[0] + alpha[0] * track.ny[0] };
    expect(b.start(p0.x + 0.3, p0.y - 0.2)).toBe(true);
    for (let i = step; i <= track.n + step; i += step) {
      const k = i % track.n;
      const r = b.extend(track.x[k] + alpha[k] * track.nx[k], track.y[k] + alpha[k] * track.ny[k]);
      if (r === 'finish') break;
      expect(r === 'ok' || r === 'skip').toBe(true);
    }
    return b;
  }

  it('produces a line the server validator accepts', () => {
    const alpha = minCurvatureOffsets(mc);
    const b = drawIdeal(mc, alpha);
    expect(b.status).toBe('done');
    const code = encodePath(b.points as number[]);
    expect(validatePath(mc, decodePath(code)).ok).toBe(true);
    const lap = simulateLap(mc, decodePath(code), 'soft');
    expect(lap.timeMs).toBeGreaterThan(60000);
    expect(lap.timeMs).toBeLessThan(80000);
  });

  it('runs the line to the white line on a track-limits hit, then allows undo or carrying on', () => {
    const b = new LineBuilder(mc);
    expect(b.start(mc.x[0], mc.y[0])).toBe(true);
    expect(b.extend(mc.x[10], mc.y[10])).toBe('ok');
    b.beginStroke();
    expect(b.extend(mc.x[16], mc.y[16])).toBe('ok');
    const before = b.count;
    const k = 24;
    const r = b.extend(mc.x[k] + mc.nx[k] * (mc.limit + 2), mc.y[k] + mc.ny[k] * (mc.limit + 2));
    expect(r).toBe('offtrack');
    expect(b.status).toBe('drawing');
    // The line now ends at the white line, and the marker sits at its end.
    expect(b.count).toBe(before + 1);
    const tip = b.lastPoint!;
    const edge = projectGlobal(mc, tip.x, tip.y).dist;
    expect(edge).toBeLessThanOrEqual(mc.limit);
    expect(edge).toBeGreaterThan(mc.limit - 0.4);
    expect(Math.hypot(b.offTrack!.x - tip.x, b.offTrack!.y - tip.y)).toBeLessThan(0.4);
    // Carrying on from the wall works and clears the marker.
    expect(b.extend(mc.x[30], mc.y[30])).toBe('ok');
    expect(b.offTrack).toBeNull();
    // Or undo the stroke that went wide.
    b.extend(mc.x[38] + mc.nx[38] * (mc.limit + 2), mc.y[38] + mc.ny[38] * (mc.limit + 2));
    expect(b.undoStroke()).toBe(true);
    expect(b.offTrack).toBeNull();
    expect(b.count).toBeLessThan(before);
  });

  it('keeps a line that touched the wall valid for the server', () => {
    const alpha = minCurvatureOffsets(mc);
    const b = new LineBuilder(mc);
    expect(b.start(mc.x[0] + alpha[0] * mc.nx[0], mc.y[0] + alpha[0] * mc.ny[0])).toBe(true);
    let walls = 0;
    for (let i = 3; i <= mc.n + 3; i += 3) {
      const k = i % mc.n;
      if (i % 300 === 0) {
        // Swing out over the white line a little way ahead, then carry on.
        const j = (k + 6) % mc.n;
        const side = alpha[j] >= 0 ? 1 : -1;
        if (b.extend(mc.x[j] + mc.nx[j] * side * (mc.limit + 3), mc.y[j] + mc.ny[j] * side * (mc.limit + 3)) === 'offtrack') walls++;
      }
      const r = b.extend(mc.x[k] + alpha[k] * mc.nx[k], mc.y[k] + alpha[k] * mc.ny[k]);
      if (r === 'finish') break;
      expect(r === 'ok' || r === 'skip' || r === 'backward').toBe(true);
    }
    expect(walls).toBeGreaterThan(2);
    expect(b.status).toBe('done');
    expect(validatePath(mc, decodePath(encodePath(b.points as number[]))).ok).toBe(true);
  });

  it('ignores backwards strokes and supports undo', () => {
    const b = new LineBuilder(mc);
    b.start(mc.x[0], mc.y[0]);
    expect(b.extend(mc.x[10], mc.y[10])).toBe('ok');
    b.beginStroke();
    expect(b.extend(mc.x[20], mc.y[20])).toBe('ok');
    expect(b.extend(mc.x[5], mc.y[5])).toBe('backward');
    const before = b.count;
    expect(b.undoStroke()).toBe(true);
    expect(b.count).toBeLessThan(before);
    expect(b.extend(mc.x[15], mc.y[15])).toBe('ok');
  });
});
