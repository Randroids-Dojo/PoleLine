import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/data/catalog';
import { GEOMETRY_LOADERS } from '../src/data/geometry-loaders';
import { CATALOG as TOYBOX } from '../src/data/toybox/catalog';
import { GEOMETRY_LOADERS as TOYBOX_LOADERS } from '../src/data/toybox/geometry-loaders';
import {
  brakeZones,
  buildCourse,
  decodePicks,
  encodePicks,
  gate,
  laneOffset,
  laneOptions,
  maxStep,
  reachableLanes,
  settleLanes,
  solveOffsets,
  startLane,
  type Pick,
} from '../src/app/segments';
import { simulateLap } from '../src/sim/lapsim';
import { decodePath, encodePath, validatePath } from '../src/sim/path';
import { buildTrack, type Track } from '../src/sim/track';
import type { TrackMeta } from '../src/sim/types';
import { carefulPlan, lapTime, planLine } from '../scripts/segmentplan';
import type { CoachReport } from '../src/app/coach';

async function load(meta: TrackMeta, loaders: Record<string, () => Promise<{ default: number[] }>>): Promise<Track> {
  return buildTrack(meta, (await loaders[meta.slug]()).default);
}

const all: [string, TrackMeta, Record<string, () => Promise<{ default: number[] }>>][] = [
  ...CATALOG.map((m) => ['web', m, GEOMETRY_LOADERS] as [string, TrackMeta, typeof GEOMETRY_LOADERS]),
  ...TOYBOX.filter((m) => !m.tutorial).map((m) => ['toybox', m, TOYBOX_LOADERS] as [string, TrackMeta, typeof TOYBOX_LOADERS]),
];

describe('cutting a circuit into segments', () => {
  it.each(all.map(([ed, m, l]) => [`${ed} ${m.slug}`, m, l] as const))('%s: segments run end to end, none too short, and a careful plan is a legal lap', async (_name, meta, loaders) => {
    const t = await load(meta, loaders);
    const c = buildCourse(t);
    expect(c.segments.length).toBeGreaterThan(10);
    expect(c.segments[0].from).toBe(0);
    expect(c.segments[c.segments.length - 1].to).toBe(t.length);
    expect(c.segments[c.segments.length - 1].v).toBe(t.n);
    c.segments.forEach((s, k) => {
      if (k) expect(s.from).toBe(c.segments[k - 1].to);
      expect(s.to - s.from).toBeGreaterThanOrEqual(20);
      expect(s.to - s.from).toBeLessThanOrEqual(430);
      if (s.end === 'board') expect([50, 100, 150, 200]).toContain(s.board);
    });
    // Brake boards count down towards the corner they belong to.
    for (let k = 1; k < c.segments.length; k++) {
      const a = c.segments[k - 1];
      const b = c.segments[k];
      if (a.end === 'board' && b.end === 'board' && a.corner === b.corner) expect(b.board!).toBe(a.board! - 50);
    }
    const plan = carefulPlan(t, c);
    const line = planLine(t, c, plan);
    expect(line).not.toBeNull();
    expect(validatePath(t, decodePath(encodePath(line!))).ok).toBe(true);
  });

  it.each(all.map(([ed, m, l]) => [`${ed} ${m.slug}`, m, l] as const))('%s: laying the lap a segment at a time never folds the line across the road, and it closes inside every reach', async (_name, meta, loaders) => {
    const t = await load(meta, loaders);
    const c = buildCourse(t);
    const plan = carefulPlan(t, c);
    let prev: Float64Array | null = null;
    let worst = 0;
    for (let k = 1; k < plan.length; k++) {
      prev = solveOffsets(t, c, plan.slice(0, k), prev);
      worst = Math.max(worst, maxStep(prev));
    }
    expect(worst).toBeLessThanOrEqual(2.5);
    expect(maxStep(solveOffsets(t, c, plan))).toBeLessThanOrEqual(2.5);
    // The lap starts in the lane it finishes in, which the first segment must reach from.
    expect(Math.abs(plan[plan.length - 1].lane - plan[0].lane)).toBeLessThanOrEqual(c.segments[0].reach);
  });

  it('finds about as many corners as a circuit has turns', async () => {
    for (const slug of ['spielberg', 'silverstone', 'spa', 'monza']) {
      const meta = CATALOG.find((m) => m.slug === slug)!;
      const c = buildCourse(await load(meta, GEOMETRY_LOADERS));
      expect(Math.abs(c.corners.length - meta.turns)).toBeLessThanOrEqual(4);
    }
  });
});

describe('the planned line', () => {
  it('passes through the gate picked at every boundary and stays inside the limits', async () => {
    const t = await load(CATALOG.find((m) => m.slug === 'monaco')!, GEOMETRY_LOADERS);
    const c = buildCourse(t);
    const plan = carefulPlan(t, c);
    const a = solveOffsets(t, c, plan);
    expect(a.length).toBe(t.n + 1);
    const w = laneOffset(t);
    for (let q = 0; q < a.length; q++) expect(Math.abs(a[q])).toBeLessThanOrEqual(w + 1e-9);
    c.segments.forEach((s, k) => {
      const [lo, hi] = gate(t, plan[k].lane);
      expect(a[s.v]).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(a[s.v]).toBeLessThanOrEqual(hi + 1e-9);
    });
    // The lap closes where it began.
    expect(a[t.n]).toBe(a[0]);
  });

  it('gives the same line for the same picks however they were laid', async () => {
    const t = await load(CATALOG.find((m) => m.slug === 'spielberg')!, GEOMETRY_LOADERS);
    const c = buildCourse(t);
    const plan = carefulPlan(t, c);
    let prev: Float64Array | null = null;
    for (let k = 1; k < plan.length; k++) prev = solveOffsets(t, c, plan.slice(0, k), prev);
    // The whole lap is always solved whole, never from the line laid so far.
    expect(Array.from(solveOffsets(t, c, plan, prev))).toEqual(Array.from(solveOffsets(t, c, plan)));
    expect(planLine(t, c, plan)).toEqual(planLine(t, c, plan.map((p) => ({ ...p }))));
  });

  it('starts the lap in the lane it finishes in', () => {
    const course = { length: 100, corners: [], segments: [] as never[] };
    const picks: Pick[] = [
      { pedal: 'gas', lane: 1 },
      { pedal: 'gas', lane: -1 },
    ];
    expect(startLane({ ...course, segments: [{}, {}, {}] as never }, picks, 0)).toBe(0);
    expect(startLane({ ...course, segments: [{}, {}] as never }, picks, 0)).toBe(-1);
    expect(startLane({ ...course, segments: [{}, {}] as never }, picks, 1)).toBe(1);
  });

  it('carries later lanes along when a short segment can no longer reach them', () => {
    const sec = (reach: 1 | 2) => ({ from: 0, to: 30, end: 'apex' as const, corner: null, reach, v: 0 });
    const course = { length: 120, corners: [], segments: [sec(2), sec(1), sec(1), sec(2)] };
    const picks: Pick[] = [
      { pedal: 'gas', lane: 0 },
      { pedal: 'gas', lane: 1 },
      { pedal: 'brake', lane: 1 },
      { pedal: 'gas', lane: -1 },
    ];
    picks[0] = { pedal: 'gas', lane: -1 };
    settleLanes(course, picks, 0);
    expect(picks.map((p) => p.lane)).toEqual([-1, 0, 1, -1]);
    expect(reachableLanes(course.segments[1], -1)).toEqual([-1, 0]);
  });

  it('keeps the first segment inside its reach once the lap closes', () => {
    const sec = (reach: 1 | 2) => ({ from: 0, to: 30, end: 'apex' as const, corner: null, reach, v: 0 });
    const course = { length: 200, corners: [], segments: [sec(1), sec(2), sec(2), sec(2)] };
    // The first segment moved left from the middle; the lap will start where it finishes.
    const picks: Pick[] = [
      { pedal: 'gas', lane: -1 },
      { pedal: 'gas', lane: 1 },
      { pedal: 'gas', lane: 1 },
    ];
    // Ending on the right would start the lap two lanes from the first gate, past a reach of one.
    expect(laneOptions(course, picks, 3)).toEqual([-1, 0]);
    picks.push({ pedal: 'brake', lane: 0 });
    // Changing the last lane carries round to the first segment.
    picks[3] = { pedal: 'brake', lane: 1 };
    picks[0] = { pedal: 'gas', lane: -1 };
    settleLanes(course, picks, 3);
    expect(picks[0].lane).toBe(0);
    // Changing the first segment's gate is offered only what it can reach from the last.
    expect(laneOptions(course, picks, 0)).toEqual([0, 1]);
  });

  it('saves picks as short text and reads them back', () => {
    const picks: Pick[] = [
      { pedal: 'gas', lane: -1 },
      { pedal: 'brake', lane: 0 },
      { pedal: 'brake', lane: 1 },
    ];
    expect(encodePicks(picks)).toBe('glbmbr');
    expect(decodePicks('glbmbr')).toEqual(picks);
    expect(decodePicks('gx')).toBeNull();
  });
});

describe('gas and brake in the lap sim', () => {
  it('drives the picks: no braking on the gas, no throttle on the brakes', async () => {
    const t = await load(CATALOG.find((m) => m.slug === 'spielberg')!, GEOMETRY_LOADERS);
    const c = buildCourse(t);
    const plan = carefulPlan(t, c);
    const pts = decodePath(encodePath(planLine(t, c, plan)!));
    const zones = brakeZones(c, plan);
    const lap = simulateLap(t, pts, 'soft', { brakes: zones });
    // Zones are in decimetres.
    const inZone = (s: number) => {
      for (let k = 0; k < zones.length; k += 2) if (s >= zones[k] / 10 && s < zones[k + 1] / 10) return true;
      return false;
    };
    let braking = 0;
    for (let i = 0; i < lap.n; i++) {
      if (inZone(lap.s[i])) expect(lap.throttle[i]).toBe(0);
      else expect(lap.brake[i]).toBe(0);
      if (lap.brake[i] > 0) braking++;
    }
    expect(braking).toBeGreaterThan(50);
    // Calling the pedals never beats the quickest speed for the line. (Here and
    // there a sample can be a touch quicker: coasting saves battery and heat.)
    const free = simulateLap(t, pts, 'soft');
    expect(lap.timeMs).toBeGreaterThanOrEqual(free.timeMs);
  });

  it('costs time for braking late, braking early and never braking', async () => {
    const t = await load(CATALOG.find((m) => m.slug === 'spielberg')!, GEOMETRY_LOADERS);
    const c = buildCourse(t);
    const plan = carefulPlan(t, c);
    const best = lapTime(t, c, plan)!;
    // Gas everywhere: the car can only lift for the corners.
    expect(lapTime(t, c, plan.map((p) => ({ ...p, pedal: 'gas' as const })))!).toBeGreaterThan(best + 10000);
    // Moving every brake zone a segment earlier or later both lose time.
    const shift = (by: 1 | -1) => plan.map((p, k) => ({ ...p, pedal: plan[(k + by + plan.length) % plan.length].pedal }));
    expect(lapTime(t, c, shift(1))!).toBeGreaterThan(best);
    expect(lapTime(t, c, shift(-1))!).toBeGreaterThan(best);
  });

  it('a careful plan runs close to the ideal line on the real circuits', async () => {
    const { minCurvatureOffsets, offsetsToLine } = await import('../scripts/optimal');
    for (const slug of ['spielberg', 'monza', 'silverstone']) {
      const t = await load(CATALOG.find((m) => m.slug === slug)!, GEOMETRY_LOADERS);
      const c = buildCourse(t);
      const ideal = simulateLap(t, decodePath(encodePath(offsetsToLine(t, minCurvatureOffsets(t)))), 'soft').timeMs;
      const careful = lapTime(t, c, carefulPlan(t, c))!;
      expect(careful).toBeGreaterThan(ideal);
      expect(careful - ideal).toBeLessThan(3500);
    }
  });
});

describe('where a lap laid segment by segment lost time', () => {
  it('finds a missing brake and a wrong gate, each with exactly the time it cost', async () => {
    const { analysePlan, bestTips, tipAction } = await import('../src/app/coach');
    const t = await load(CATALOG.find((m) => m.slug === 'spielberg')!, GEOMETRY_LOADERS);
    const c = buildCourse(t);
    const plan = carefulPlan(t, c);
    const base = lapTime(t, c, plan)!;
    // Plant two mistakes: no brakes in the segment running to a turn-in, and the outside gate at an apex.
    const brakeAt = c.segments.findIndex((s, k) => s.end === 'turn' && plan[k].pedal === 'brake');
    const apexAt = c.segments.findIndex((s, k) => s.end === 'apex' && k > brakeAt + 2 && plan[k].lane !== 0 && laneOptions(c, plan, k).includes((-plan[k].lane) as -1 | 1));
    expect(brakeAt).toBeGreaterThan(0);
    expect(apexAt).toBeGreaterThan(0);
    const bad = plan.map((p) => ({ ...p }));
    bad[brakeAt].pedal = 'gas';
    const right = bad[apexAt].lane;
    bad[apexAt].lane = (-right) as -1 | 1;
    settleLanes(c, bad, apexAt);
    const badTime = lapTime(t, c, bad)!;
    expect(badTime).toBeGreaterThan(base);
    let last: CoachReport | null = null;
    let reports = 0;
    for (const r of analysePlan(t, c, bad, 'soft')) {
      last = r;
      reports++;
    }
    if (!last) throw new Error('no report');
    expect(reports).toBeGreaterThan(5);
    expect(last.done).toBe(true);
    expect(last.timeMs).toBe(badTime);
    expect(last.perfectMs!).toBeLessThan(badTime);
    const tips = bestTips(last);
    const brakeTip = last.tips[brakeAt]!;
    expect(tipAction(brakeTip)).toBe('Brake');
    // Exact: the lap with just that one change made is quicker by the tip's gain.
    const fixedBrake = bad.map((p) => ({ ...p }));
    fixedBrake[brakeAt].pedal = 'brake';
    expect(badTime - lapTime(t, c, fixedBrake)!).toBe(brakeTip.gain);
    // The apex gate: the tip there is a gate, and taking it wins its gain exactly.
    const gateTip = last.tips[apexAt]!;
    expect(gateTip.lane).toBeDefined();
    const fixedGate = bad.map((p) => ({ ...p }));
    fixedGate[apexAt].lane = gateTip.lane!;
    settleLanes(c, fixedGate, apexAt);
    expect(badTime - lapTime(t, c, fixedGate)!).toBe(gateTip.gain);
    // The two planted mistakes are among the biggest gains.
    const top = tips.slice(0, 4).map((x) => x.segment);
    expect(top).toContain(brakeAt);
    expect(top).toContain(apexAt);
  }, 120000);
});
