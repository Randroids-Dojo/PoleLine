import { beforeEach, describe, expect, it } from 'vitest';

// A browser-free stand-in for localStorage (saved laps and settings read it).
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

const { blendTail, findJoin, headingAt, indexAt, lineProgress, nearestPoint, pointAt, sameLine, tailFrom } = await import('../src/app/splice');
const { tidyStroke } = await import('../src/app/tidy');
const { addLap, getLaps } = await import('../src/app/laps');
const { setBest } = await import('../src/app/store');
const { CATALOG } = await import('../src/data/catalog');
const spielberg = (await import('../src/data/geometry/spielberg')).default;
const { LineBuilder } = await import('../src/sim/builder');
const { UNITS_PER_METRE, decodePath, encodePath, validatePath } = await import('../src/sim/path');
const { SIM_VERSION } = await import('../src/sim/version');
const { buildTrack, frameAt } = await import('../src/sim/track');
const { minCurvatureOffsets, offsetsToLine, wobble } = await import('../scripts/optimal');

const track = buildTrack(CATALOG.find((m) => m.slug === 'spielberg')!, spielberg);
const L = track.length;
// A saved lap: a hand-like wobble on the racing line, and the racing line itself.
const ideal = minCurvatureOffsets(track);
const saved = offsetsToLine(track, wobble(track, ideal, 3, 0.9, 50, 0.1));
const racing = (s: number) => {
  const f = frameAt(track, s);
  return { x: f.x + f.nx * ideal[f.seg], y: f.y + f.ny * ideal[f.seg] };
};
const valid = (pts: readonly number[]) => validatePath(track, decodePath(encodePath(pts.slice()))).ok;
const deg = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) * 180) / Math.PI;

describe('line builder holding a saved lap', () => {
  it('loads a whole legal lap as finished, and refuses a part lap', () => {
    const b = new LineBuilder(track);
    expect(b.load(saved)).toBe(true);
    expect(b.status).toBe('done');
    expect(b.points).toEqual(saved);
    expect(b.load(saved.slice(0, saved.length / 2 - (saved.length / 2) % 2))).toBe(false);
    expect(b.status).toBe('idle');
  });

  it('refuses a lap that leaves the track', () => {
    const bad = saved.slice();
    const i = 400;
    const f = frameAt(track, lineProgress(track, saved)[i]);
    bad[i * 2] += Math.round(f.nx * 40 * UNITS_PER_METRE);
    bad[i * 2 + 1] += Math.round(f.ny * 40 * UNITS_PER_METRE);
    expect(new LineBuilder(track).load(bad)).toBe(false);
  });

  it('puts everything back from a snapshot', () => {
    const b = new LineBuilder(track);
    b.preload(saved.slice(0, 600));
    const snap = b.snapshot();
    b.beginStroke();
    const from = b.progress;
    for (let s = from + 1; s < from + 60; s += 0.8) b.extend(racing(s).x, racing(s).y);
    expect(b.count).toBeGreaterThan(330);
    b.restore(snap);
    expect(b.points).toEqual(saved.slice(0, 600));
    expect(b.status).toBe('drawing');
    expect(b.canUndo).toBe(false);
  });

  it('runs a cut line on through the rest of the old one to the finish, all or nothing', () => {
    const b = new LineBuilder(track);
    expect(b.preload(saved.slice(0, 1200))).toBe(true);
    const kept = b.points.slice();
    // Across the grass: refused, the line as it was.
    const f = frameAt(track, 900);
    expect(b.finishThrough([{ x: f.x + f.nx * 40, y: f.y + f.ny * 40 }])).toBe(false);
    expect(b.points).toEqual(kept);
    // Not as far as the finish: refused too.
    expect(b.finishThrough(tailFrom(saved, 600).slice(0, 50))).toBe(false);
    expect(b.points).toEqual(kept);
    // The rest of the old line: the lap is whole again, point for point.
    expect(b.finishThrough(tailFrom(saved, 600))).toBe(true);
    expect(b.status).toBe('done');
    expect(valid(b.points)).toBe(true);
    expect(b.points.slice(0, saved.length - 2)).toEqual(saved.slice(0, saved.length - 2));
  });
});

describe('splicing a redraw into a saved lap', () => {
  const progress = lineProgress(track, saved);

  it('reads lap progress along the line, never falling, to the finish', () => {
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    expect(progress[progress.length - 1]).toBeGreaterThan(L - 1);
    const i = indexAt(progress, 1000);
    expect(progress[i]).toBeGreaterThanOrEqual(1000);
    expect(progress[i - 1]).toBeLessThan(1000);
    expect(indexAt(progress, L + 50)).toBe(progress.length);
  });

  it('finds the point of the line under a touch', () => {
    const p = pointAt(saved, 700);
    const near = nearestPoint(saved, p.x + 0.3, p.y - 0.2);
    expect(near.index).toBe(700);
    expect(near.dist).toBeCloseTo(Math.hypot(0.3, 0.2), 5);
  });

  it('rejoins beside the tip only, running the same way, and only past the cut', () => {
    const cut = indexAt(progress, 900);
    const s = 960;
    const k = indexAt(progress, s);
    const p = pointAt(saved, k);
    const dir = headingAt(saved, k);
    const f = frameAt(track, s);
    const tip = { x: p.x + f.nx * 1.2, y: p.y + f.ny * 1.2 };
    expect(findJoin(saved, progress, cut + 1, tip, s, dir, 1.6)).not.toBeNull();
    // Too far to the side.
    expect(findJoin(saved, progress, cut + 1, { x: p.x + f.nx * 3, y: p.y + f.ny * 3 }, s, dir, 1.6)).toBeNull();
    // Crossing the old line at a right angle.
    expect(findJoin(saved, progress, cut + 1, tip, s, { x: f.nx, y: f.ny }, 1.6)).toBeNull();
    // Beside the part of the line kept before the cut.
    expect(findJoin(saved, progress, indexAt(progress, 1100), tip, s, dir, 1.6)).toBeNull();
  });

  it('eases a freehand redraw onto the old line and keeps the rest of it exactly', () => {
    const cut = indexAt(progress, 900);
    const b = new LineBuilder(track);
    expect(b.preload(saved.slice(0, (cut + 1) * 2))).toBe(true);
    b.beginStroke();
    // Redraw along the racing line, ending a metre or so off the old one.
    for (let s = 901; s <= 960; s += 0.8) b.extend(racing(s).x, racing(s).y);
    const tip = b.lastPoint!;
    const join = findJoin(saved, progress, cut + 1, tip, b.progress, null, 2.5);
    expect(join).not.toBeNull();
    expect(b.finishThrough(blendTail(saved, progress, tip, b.progress, join!))).toBe(true);
    const line = b.points.slice();
    expect(valid(line)).toBe(true);
    expect(line.slice(0, (cut + 1) * 2)).toEqual(saved.slice(0, (cut + 1) * 2));
    // From 8 m past the lift on, the old line point for point (bar the last point, trimmed at the finish).
    const from = indexAt(progress, 960 + 8.5);
    const tail = saved.slice(from * 2, saved.length - 2);
    expect(line.slice(line.length - 2 - tail.length, line.length - 2)).toEqual(tail);
    expect(sameLine(line, saved)).toBe(false);
  });
});

describe('tidy strokes rejoining a saved lap', () => {
  it('ends on the given point and arrives along the points pinned after it', () => {
    const progress = lineProgress(track, saved);
    const anchor = indexAt(progress, 900);
    // A stroke from the anchor, wandering a metre off the racing line.
    const line: number[] = Array.from(saved.slice(0, (anchor + 1) * 2), (v) => v / UNITS_PER_METRE);
    for (let s = 902; s <= 960; s += 1) {
      const f = frameAt(track, s);
      const p = racing(s);
      const w = Math.sin(s / 6);
      line.push(p.x + f.nx * w, p.y + f.ny * w);
    }
    const end = indexAt(progress, 966);
    const endAt = pointAt(saved, end);
    const a1 = pointAt(saved, indexAt(progress, progress[end] + 2));
    const a2 = pointAt(saved, indexAt(progress, progress[end] + 4));
    const start = frameAt(track, 0);
    const t = tidyStroke(track, line, anchor, { x: start.tx, y: start.ty }, frameAt(track, 900).seg, undefined, endAt, [a1, a2])!;
    expect(t).not.toBeNull();
    const last = t.tidy[t.tidy.length - 1];
    expect(Math.hypot(last.x - endAt.x, last.y - endAt.y)).toBeLessThan(1e-9);
    const prev = t.tidy[t.tidy.length - 2];
    const arrive = { x: last.x - prev.x, y: last.y - prev.y };
    const al = Math.hypot(arrive.x, arrive.y);
    const onward = { x: a1.x - endAt.x, y: a1.y - endAt.y };
    const ol = Math.hypot(onward.x, onward.y);
    expect(deg({ x: arrive.x / al, y: arrive.y / al }, { x: onward.x / ol, y: onward.y / ol })).toBeLessThan(4);
  });
});

describe('saved laps on the device', () => {
  beforeEach(() => mem.clear());
  const lap = (timeMs: number, code = encodePath(saved)) => ({ timeMs, compound: 'soft' as const, sectorsMs: [1, 2, 3] as [number, number, number], code, date: '2026-10-20T10:00:00.000Z' });

  it('keeps lines packed, well under the size of the numbers, and reads them back exactly', () => {
    addLap('spielberg', lap(66000));
    const raw = localStorage.getItem(`poleline:v1:laps:v${SIM_VERSION}:spielberg`)!;
    expect(raw).not.toContain('"code"');
    expect(raw.length).toBeLessThan(JSON.stringify(encodePath(saved)).length * 0.6);
    expect(getLaps('spielberg')[0].code).toEqual(encodePath(saved));
  });

  it('still reads laps saved as numbers', () => {
    localStorage.setItem(`poleline:v1:laps:v${SIM_VERSION}:spielberg`, JSON.stringify([lap(66000)]));
    expect(getLaps('spielberg')[0].code).toEqual(encodePath(saved));
  });

  it('includes a personal best kept from before laps were, once', () => {
    setBest('spielberg', { ...lap(65000), submitted: true });
    expect(getLaps('spielberg').map((l) => l.timeMs)).toEqual([65000]);
    addLap('spielberg', lap(67000, [1, 2, 3, 4]));
    expect(getLaps('spielberg').map((l) => l.timeMs)).toEqual([65000, 67000]);
    // The same lap saved both ways is listed once.
    addLap('spielberg', lap(65000));
    expect(getLaps('spielberg').map((l) => l.timeMs)).toEqual([65000, 67000]);
  });

  it('keeps an old best when a new one replaces it, recorded the way a race records it', () => {
    setBest('spielberg', { ...lap(65000), submitted: true });
    // A quicker lap: recorded first, then made the best.
    addLap('spielberg', lap(64000, [5, 6, 7, 8]));
    setBest('spielberg', { ...lap(64000, [5, 6, 7, 8]), submitted: false });
    expect(getLaps('spielberg').map((l) => l.timeMs)).toEqual([64000, 65000]);
  });
});
