// Segment by segment, headless: how each circuit is cut into segments, whether
// every planned line is a legal lap, and how quick a careful plan gets against
// the ideal line. Also builds the plans the browser test plays.
//
//   npx tsx scripts/segmentplan.ts [slug,...] [--search]
// --search improves each plan by flipping pedals and lanes one segment at a time.

import { pathToFileURL } from 'node:url';
import { simulateLap } from '../src/sim/lapsim.js';
import { decodePath, encodePath } from '../src/sim/path.js';
import { buildTrack, type Track } from '../src/sim/track.js';
import { brakeZones, buildCourse, lapLine, laneOffset, laneOptions, type Course, type Lane, type Pick } from '../src/app/segments.js';
import { minCurvatureOffsets, offsetsToLine } from './optimal.js';

/** The planned line as the game lays it: decimetre points, or null if it is not a legal lap. */
export function planLine(track: Track, course: Course, picks: readonly Pick[]): number[] | null {
  return lapLine(track, course, picks);
}

export function lapTime(track: Track, course: Course, picks: readonly Pick[], compound: 'soft' | 'medium' | 'hard' = 'soft'): number | null {
  const line = planLine(track, course, picks);
  if (!line) return null;
  return simulateLap(track, decodePath(encodePath(line)), compound, { brakes: brakeZones(course, picks) }).timeMs;
}

/** Lanes nearest the ideal line at each boundary, pedals from where the ideal speed profile brakes. */
export function carefulPlan(track: Track, course: Course, compound: 'soft' | 'medium' | 'hard' = 'soft'): Pick[] {
  const ideal = minCurvatureOffsets(track);
  const w = laneOffset(track);
  const at = (s: number) => {
    let best = 0;
    for (let i = 0; i < track.n; i++) if (Math.abs(track.s[i] - s) < Math.abs(track.s[best] - s)) best = i;
    return ideal[best];
  };
  const picks: Pick[] = [];
  course.segments.forEach((sec, k) => {
    const a = at(sec.to >= course.length ? 0 : sec.to) / w;
    const want = (a < -1 / 3 ? -1 : a > 1 / 3 ? 1 : 0) as Lane;
    const options = laneOptions(course, picks, k);
    picks.push({ pedal: 'gas', lane: options.reduce((x, y) => (Math.abs(y - want) < Math.abs(x - want) ? y : x)) });
  });
  const line = planLine(track, course, picks);
  if (!line) return picks;
  const free = simulateLap(track, decodePath(encodePath(line)), compound);
  course.segments.forEach((sec, k) => {
    let braking = 0;
    let samples = 0;
    for (let i = 0; i < free.n; i++) {
      if (free.s[i] >= sec.from && free.s[i] < sec.to) {
        samples++;
        if (free.brake[i] > 0.05) braking++;
      }
    }
    if (samples && braking / samples > 0.35) picks[k].pedal = 'brake';
  });
  return picks;
}

/** One pass of flipping each segment's pedal, then each lane, keeping what is quicker. */
export function improve(track: Track, course: Course, picks: Pick[], compound: 'soft' | 'medium' | 'hard' = 'soft'): { picks: Pick[]; time: number } {
  let best = lapTime(track, course, picks, compound) ?? Infinity;
  const cur = picks.map((p) => ({ ...p }));
  for (let k = 0; k < cur.length; k++) {
    const was = cur[k].pedal;
    cur[k].pedal = was === 'gas' ? 'brake' : 'gas';
    const t = lapTime(track, course, cur, compound) ?? Infinity;
    if (t < best) best = t;
    else cur[k].pedal = was;
  }
  for (let k = 0; k < cur.length; k++) {
    const was = cur[k].lane;
    for (const l of laneOptions(course, cur, k)) {
      if (l === was) continue;
      const next = course.segments[(k + 1) % cur.length];
      if (Math.abs(cur[(k + 1) % cur.length].lane - l) > next.reach) continue;
      cur[k].lane = l;
      const t = lapTime(track, course, cur, compound) ?? Infinity;
      if (t < best) best = t;
      else cur[k].lane = was;
    }
  }
  return { picks: cur, time: best };
}

async function main(): Promise<void> {
  const { CATALOG } = await import('../src/data/catalog.js');
  const want = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2].split(',') : CATALOG.map((m) => m.slug);
  const search = process.argv.includes('--search');
  const fmt = (ms: number | null) => (ms === null ? '  invalid' : (ms / 1000).toFixed(3).padStart(9));
  for (const slug of want) {
    const meta = CATALOG.find((m) => m.slug === slug)!;
    const track = buildTrack(meta, (await import(`../src/data/geometry/${slug}.ts`)).default);
    const t0 = performance.now();
    const course = buildCourse(track);
    const ms = performance.now() - t0;
    const lens = course.segments.map((s) => s.to - s.from);
    const ideal = simulateLap(track, decodePath(encodePath(offsetsToLine(track, minCurvatureOffsets(track)))), 'soft').timeMs;
    const plan = carefulPlan(track, course);
    const careful = lapTime(track, course, plan);
    let line = `${slug.padEnd(14)} turns ${String(meta.turns).padStart(2)} corners ${String(course.corners.length).padStart(2)} (brake ${String(course.corners.filter((c) => c.brakes).length).padStart(2)}) segments ${String(course.segments.length).padStart(3)} len ${Math.min(...lens).toFixed(0)}..${Math.max(...lens).toFixed(0)} build ${ms.toFixed(0)}ms | ideal ${fmt(ideal)} careful ${fmt(careful)}`;
    if (search) {
      let r = improve(track, course, plan);
      r = improve(track, course, r.picks);
      line += ` searched ${fmt(r.time)} (+${((r.time - ideal) / 1000).toFixed(3)})`;
    }
    console.log(line);
    const allGas = lapTime(track, course, plan.map((p) => ({ ...p, pedal: 'gas' as const })));
    const allBrake = lapTime(track, course, plan.map((p) => ({ ...p, pedal: 'brake' as const })));
    console.log(`${''.padEnd(14)} all gas ${fmt(allGas)} all brake ${fmt(allBrake)} pole ${meta.poleRef.toFixed(3)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
