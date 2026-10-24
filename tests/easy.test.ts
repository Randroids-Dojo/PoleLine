import { beforeEach, describe, expect, it } from 'vitest';

// A browser-free stand-in for localStorage (the settings part reads it).
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

const { controls, endDir, fitEnd, midpoint, sampleCurve, startBend } = await import('../src/app/curve');
const { blend, tidyStroke } = await import('../src/app/tidy');
const { DRAW_MODES, drawModeText } = await import('../src/app/draw-mode');
const { TUTORIAL_COPY } = await import('../src/app/tutorial-copy');
const { currentSetup, getSettings, sameSetup, saveSettings } = await import('../src/app/store');
const { CATALOG } = await import('../src/data/catalog');
const spielberg = (await import('../src/data/geometry/spielberg')).default;
const rookie = (await import('../src/data/geometry/rookie-ring')).default;
const { LineBuilder } = await import('../src/sim/builder');
const { UNITS_PER_METRE, decodePath, encodePath, validatePath } = await import('../src/sim/path');
const { buildTrack, frameAt, projectNear } = await import('../src/sim/track');
const { minCurvatureOffsets } = await import('../scripts/optimal');

const track = buildTrack(CATALOG.find((m) => m.slug === 'spielberg')!, spielberg);
const deg = (a: { x: number; y: number }, b: { x: number; y: number }) => (Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) * 180) / Math.PI;
const unit = (x: number, y: number) => {
  const l = Math.hypot(x, y);
  return { x: x / l, y: y / l };
};

describe('tap and bend curves', () => {
  const c = { from: { x: 0, y: 0 }, dir: { x: 0, y: -1 }, to: { x: 18, y: -60 }, toDir: unit(0.5, -1), bend: null };

  it('leave along the line, end on the tap, and arrive along the given direction', () => {
    const pts = sampleCurve(c, 1);
    expect(pts[pts.length - 1]).toEqual(c.to);
    expect(deg(unit(pts[0].x, pts[0].y), c.dir)).toBeLessThan(2);
    expect(deg(endDir(c), c.toDir)).toBeLessThan(0.01);
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      expect(d).toBeGreaterThan(0.6);
      expect(d).toBeLessThan(1.6);
    }
  });

  it('do not move when bending starts, then pass through the handle', () => {
    const b = startBend(c);
    const before = sampleCurve(c, 1);
    const after = sampleCurve(b, 1);
    expect(after.length).toBe(before.length);
    after.forEach((p, i) => expect(Math.hypot(p.x - before[i].x, p.y - before[i].y)).toBeLessThan(1e-6));
    const bent = { ...b, bend: { ...b.bend!, x: b.bend!.x - 6, y: b.bend!.y } };
    const p = controls(bent);
    const mid = { x: (p[0].x + 3 * p[1].x + 3 * p[2].x + p[3].x) / 8, y: (p[0].y + 3 * p[1].y + 3 * p[2].y + p[3].y) / 8 };
    expect(Math.hypot(mid.x - midpoint(bent).x, mid.y - midpoint(bent).y)).toBeLessThan(1e-9);
    // Bending keeps the start smooth with the line.
    expect(deg(unit(p[1].x - p[0].x, p[1].y - p[0].y), c.dir)).toBeLessThan(1e-6);
  });

  it('read the heading at the end of a rounded, jittery line', () => {
    const pts: number[] = [];
    for (let k = 0; k <= 30; k++) {
      const a = k * 0.02;
      pts.push(Math.round(Math.cos(a) * 400) / 10, Math.round(Math.sin(a) * 400) / 10);
    }
    const f = fitEnd(pts)!;
    expect(deg(f.dir, { x: -Math.sin(0.6), y: Math.cos(0.6) })).toBeLessThan(2);
    expect(Math.hypot(f.x - Math.cos(0.6) * 40, f.y - Math.sin(0.6) * 40)).toBeLessThan(0.1);
  });
});

describe('tidy strokes', () => {
  // A wobbly stroke from the start line along the main straight and into turn 1.
  const line: number[] = [track.x[0], track.y[0]];
  for (let s = 0.8; s < 160; s += 0.8) {
    const f = frameAt(track, s);
    const lat = 1.5 * Math.sin(s / 5) + 0.3 * Math.sin(s * 1.7);
    line.push(f.x + f.nx * lat, f.y + f.ny * lat);
  }
  const start = frameAt(track, 0);
  const t = tidyStroke(track, line, 0, { x: start.tx, y: start.ty }, 0)!;

  const wiggle = (pts: { x: number; y: number }[]) => {
    let sum = 0;
    for (let i = 2; i < pts.length; i++) {
      const a = Math.atan2(pts[i - 1].y - pts[i - 2].y, pts[i - 1].x - pts[i - 2].x);
      const b = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x);
      sum += Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
    }
    return sum;
  };

  it('straightens the wobble and keeps the end where the finger lifted', () => {
    expect(wiggle(t.tidy)).toBeLessThan(wiggle(t.raw) * 0.25);
    const end = t.tidy[t.tidy.length - 1];
    expect(Math.hypot(end.x - line[line.length - 2], end.y - line[line.length - 1])).toBeLessThan(0.6);
  });

  it('stays inside the white lines', () => {
    let hint = 0;
    for (const p of t.tidy) {
      const q = projectNear(track, p.x, p.y, hint, 12);
      hint = q.seg;
      expect(q.dist).toBeLessThan(track.limit);
    }
  });

  it('joins the line before it without a kink', () => {
    // A second stroke drawn off at an angle from the end of the first.
    const b = new LineBuilder(track);
    b.start(track.x[0], track.y[0]);
    for (const p of t.tidy) b.extend(p.x, p.y);
    b.beginStroke();
    const tip = b.lastPoint!;
    for (let s = 162; s < 260; s += 0.8) {
      const f = frameAt(track, s);
      b.extend(f.x + f.nx * -2, f.y + f.ny * -2);
    }
    const metres = Array.from(b.points, (v) => v / UNITS_PER_METRE);
    const t2 = tidyStroke(track, metres, b.strokeAnchor, { x: start.tx, y: start.ty }, b.strokeHint)!;
    const into = fitEnd(metres.slice(0, (b.strokeAnchor + 1) * 2))!.dir;
    // The finger landed 3 m to the side of the tip: drawn, the join turns sharply.
    const out = unit(t2.tidy[1].x - tip.x, t2.tidy[1].y - tip.y);
    const raw = unit(t2.raw[1].x - tip.x, t2.raw[1].y - tip.y);
    expect(deg(into, raw)).toBeGreaterThan(30);
    expect(deg(into, out)).toBeLessThan(6);
  });

  it('turns a corner drawn down the middle into a racing line', () => {
    // The tightest corner in the first kilometre, drawn on the centreline from 120 m before it to 120 m after.
    let apex = 200;
    let tight = 0;
    for (let s = 200; s < 1000; s += 2) {
      const a = frameAt(track, s - 10);
      const b = frameAt(track, s + 10);
      const turn = Math.abs(a.tx * b.ty - a.ty * b.tx);
      if (turn > tight) {
        tight = turn;
        apex = s;
      }
    }
    const pts: number[] = [];
    for (let s = apex - 120; s <= apex + 120; s += 0.8) {
      const f = frameAt(track, s);
      pts.push(f.x, f.y);
    }
    const before = frameAt(track, apex - 120);
    const c = tidyStroke(track, pts, 0, { x: before.tx, y: before.ty }, before.seg)!;
    const bend = (q: { x: number; y: number }[]) => {
      let e = 0;
      for (let i = 1; i < q.length - 1; i++) {
        const ax = q[i].x - q[i - 1].x, ay = q[i].y - q[i - 1].y, bx = q[i + 1].x - q[i].x, by = q[i + 1].y - q[i].y;
        const ang = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
        e += (ang * ang) / Math.hypot(ax, ay);
      }
      return e;
    };
    expect(bend(c.tidy)).toBeLessThan(bend(c.raw) * 0.6);
    // At the apex the corrected line has moved well over to the inside of the turn.
    const a = frameAt(track, apex - 2);
    const b = frameAt(track, apex + 2);
    const inside = a.tx * b.ty - a.ty * b.tx > 0 ? 1 : -1;
    let hint = before.seg;
    let atApex = 0;
    let best = Infinity;
    for (const q of c.tidy) {
      const p = projectNear(track, q.x, q.y, hint, 12);
      hint = p.seg;
      if (Math.abs(p.s - (apex % track.length)) < best) {
        best = Math.abs(p.s - (apex % track.length));
        atApex = p.d;
      }
    }
    expect(atApex * inside).toBeGreaterThan(1.5);
  });

  it('closes the lap where it began when the finishing stroke ran wide', () => {
    // The last 58 m to the line on the tutorial circuit, drawn against the left wall.
    const ring = buildTrack(CATALOG.find((m) => m.tutorial)!, rookie);
    const lat = -(ring.limit - 0.6);
    const pts: number[] = [];
    for (let s = 1500; s <= ring.length; s += 0.8) {
      const f = frameAt(ring, s);
      pts.push(f.x + f.nx * lat, f.y + f.ny * lat);
    }
    const anchor = Math.round((1572 - 1500) / 0.8);
    const f0 = frameAt(ring, 0);
    const endAt = { x: f0.x + f0.tx * 1.5, y: f0.y + f0.ty * 1.5 };
    const c = tidyStroke(ring, pts, anchor, { x: f0.tx, y: f0.ty }, projectNear(ring, pts[anchor * 2], pts[anchor * 2 + 1], ring.n - 30, 40).seg, undefined, endAt)!;
    expect(c.tidy[c.tidy.length - 1]).toEqual(endAt);
    // The stroke swings across to meet it instead of hugging the wall and jumping at the end.
    const beforeEnd = c.tidy[c.tidy.length - 2];
    expect(Math.abs(projectNear(ring, beforeEnd.x, beforeEnd.y, 0, 20).d)).toBeLessThan(1);
    for (const q of c.tidy) expect(projectNear(ring, q.x, q.y, 0, ring.n).dist).toBeLessThan(ring.limit);
  });

  it('blends point for point between drawn and tidied', () => {
    const half = blend(t, 0.5);
    expect(half).toHaveLength(t.raw.length);
    expect(half[10].x).toBeCloseTo((t.raw[10].x + t.tidy[10].x) / 2, 9);
  });
});

describe('line builder for tidy strokes and tap and bend', () => {
  const alpha = minCurvatureOffsets(track);
  const ideal = (s: number) => {
    const f = frameAt(track, s);
    const i = f.seg;
    return { x: f.x + f.nx * alpha[i], y: f.y + f.ny * alpha[i] };
  };

  it('adds a stroke all or nothing', () => {
    const b = new LineBuilder(track);
    b.start(ideal(0).x, ideal(0).y);
    const good = Array.from({ length: 60 }, (_, k) => ideal(1 + k));
    expect(b.probe(good).kind).toBe('ok');
    expect(b.addStroke(good)).toBe('ok');
    const n = b.count;
    const bad = Array.from({ length: 30 }, (_, k) => {
      const f = frameAt(track, 61 + k);
      return { x: f.x + f.nx * (k * 0.5), y: f.y + f.ny * (k * 0.5) };
    });
    expect(b.probe(bad).kind).toBe('offtrack');
    expect(b.addStroke(bad)).toBe('offtrack');
    expect(b.count).toBe(n);
    expect(b.offTrack).toBeNull();
    expect(b.undoStroke()).toBe(true);
    expect(b.count).toBe(1);
  });

  it('swaps a stroke for a tidier one and still undoes it whole', () => {
    const b = new LineBuilder(track);
    b.start(ideal(0).x, ideal(0).y);
    for (let s = 1; s < 80; s += 0.8) b.extend(ideal(s).x, ideal(s).y);
    b.beginStroke();
    const before = b.count;
    for (let s = 80; s < 160; s += 0.8) b.extend(ideal(s).x + 0.3 * Math.sin(s), ideal(s).y);
    const swap = Array.from({ length: 80 }, (_, k) => ideal(81 + k));
    expect(b.replaceStroke(swap)).toBe(true);
    expect(b.count).toBeGreaterThan(before);
    expect(b.undoStroke()).toBe(true);
    expect(b.count).toBe(before);
    // A swap that would leave the track changes nothing.
    b.beginStroke();
    for (let s = 81; s < 120; s += 0.8) b.extend(ideal(s).x, ideal(s).y);
    const kept = b.points.slice();
    const off = Array.from({ length: 30 }, (_, k) => ({ x: ideal(81 + k).x + k, y: ideal(81 + k).y }));
    expect(b.replaceStroke(off)).toBe(false);
    expect(b.points).toEqual(kept);
  });

  it('keeps a finished lap finished when its last stroke is swapped, and the server accepts it', () => {
    const b = new LineBuilder(track);
    b.start(ideal(0).x, ideal(0).y);
    for (let s = 1; s < track.length - 100; s += 0.8) b.extend(ideal(s).x, ideal(s).y);
    b.beginStroke();
    for (let s = track.length - 100; s < track.length + 5 && b.status === 'drawing'; s += 0.8) b.extend(ideal(s).x + 0.2, ideal(s).y);
    expect(b.status).toBe('done');
    const swap = Array.from({ length: 100 }, (_, k) => ideal(track.length - 99 + k));
    expect(b.replaceStroke(swap)).toBe(true);
    expect(b.status).toBe('done');
    expect(validatePath(track, decodePath(encodePath(b.points.slice()))).ok).toBe(true);
  });
});

describe('draw mode setting', () => {
  beforeEach(() => mem.clear());

  it('defaults to tap and bend (easy) and ignores junk', () => {
    expect(getSettings().drawMode).toBe('curves');
    localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, drawMode: 'sideways' }));
    expect(getSettings().drawMode).toBe('curves');
    expect(saveSettings({ drawMode: 'freehand' }).drawMode).toBe('freehand');
  });

  it('travels with the setup, and an old setup without it reads as freehand', () => {
    saveSettings({ drawMode: 'smooth' });
    const setup = currentSetup();
    expect(setup.drawMode).toBe('smooth');
    const old = { scrollMode: setup.scrollMode, scrollSpeed: setup.scrollSpeed, cornerDamping: setup.cornerDamping, autoRotate: setup.autoRotate };
    expect(sameSetup(old, { ...setup, drawMode: 'freehand' })).toBe(true);
    expect(sameSetup(old, setup)).toBe(false);
    expect(drawModeText(undefined)).toBe('Freehand (hard)');
    expect(drawModeText('smooth')).toBe('Tidy my strokes (medium)');
    expect(drawModeText('curves')).toBe('Tap and bend (easy)');
  });
});

describe('tutorial copy', () => {
  it('has every line for every mode, in that mode\'s words', () => {
    for (const m of DRAW_MODES) {
      const c = TUTORIAL_COPY[m.id];
      expect(c.tips).toHaveLength(4);
      for (const line of [c.turn, c.start, c.going, c.yourCorner, c.wholeGame, ...c.tips]) {
        expect(line.length).toBeGreaterThan(8);
        expect(line).not.toMatch(/[\u2013\u2014]/);
      }
    }
    const all = (id: 'curves' | 'smooth' | 'freehand') => Object.values(TUTORIAL_COPY[id]).flat().join(' ');
    expect(TUTORIAL_COPY.curves.turn).toMatch(/Tap/);
    expect(all('curves')).not.toMatch(/finger|draw through/i);
    expect(TUTORIAL_COPY.smooth.turn).toMatch(/corrected/);
    expect(all('freehand')).not.toMatch(/\btap\b|corrected|bend/i);
  });
});
