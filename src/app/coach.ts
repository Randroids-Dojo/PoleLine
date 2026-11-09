// Segment by segment: where a lap lost time. For every segment the lap is run
// again with just that one pick changed (the other pedal, then each other gate
// the segment can reach) and the change that makes it quickest is kept as a
// tip, with exactly how much quicker. It also runs the same line with the car
// choosing the pedals itself, which is what perfect pedals would give.
//
// Pure: it runs in a worker (src/app/coach.worker.ts) during the race, and in
// the tests and scripts directly. It yields a report as it goes, so the screens
// can show what is known so far.

import { simulateLap } from '../sim/lapsim';
import { decodePath, encodePath } from '../sim/path';
import type { Track } from '../sim/track';
import type { Compound } from '../sim/types';
import { brakeZones, encodePicks, laneOptions, lapLine, settleLanes, type Course, type Lane, type Pedal, type Pick } from './segments';

export interface Tip {
  segment: number;
  /** The one change: the other pedal, or another gate. */
  pedal?: Pedal;
  lane?: Lane;
  /** How much quicker the lap is with only this change (ms). */
  gain: number;
}

export interface CoachReport {
  /** The plan analysed (encodePicks) and its tyre. */
  picks: string;
  compound: Compound;
  timeMs: number;
  /** The same line with the car choosing the pedals itself (ms), once known. */
  perfectMs: number | null;
  /** The best tip for each segment, or null where no single change helps. */
  tips: (Tip | null)[];
  /** Segments whose pedal and gates have all been tried. */
  checked: number;
  done: boolean;
}

/** A change has to win at least this much (ms) to be worth a tip. */
export const MIN_GAIN = 20;

/**
 * The lap's time as it is scored (src/sim/lapsim.ts simulatePlan): the plan
 * driven to its brake zones, never quicker than the same line driven freely
 * (`freeMs`, which the caller works out once per line).
 */
function lapMs(track: Track, line: number[], compound: Compound, course: Course, picks: readonly Pick[], freeMs: number): number {
  const planned = simulateLap(track, decodePath(encodePath(line)), compound, { brakes: brakeZones(course, picks) }).timeMs;
  return planned < freeMs ? freeMs : planned;
}

function freeMs(track: Track, line: number[], compound: Compound): number {
  return simulateLap(track, decodePath(encodePath(line)), compound).timeMs;
}

/** Yields a report after every few segments; the last one has `done` set. */
export function* analysePlan(track: Track, course: Course, picks: readonly Pick[], compound: Compound): Generator<CoachReport> {
  const total = course.segments.length;
  const report: CoachReport = { picks: encodePicks(picks), compound, timeMs: 0, perfectMs: null, tips: new Array(total).fill(null), checked: 0, done: false };
  const line = lapLine(track, course, picks);
  if (!line) {
    report.done = true;
    yield report;
    return;
  }
  report.perfectMs = freeMs(track, line, compound);
  report.timeMs = lapMs(track, line, compound, course, picks, report.perfectMs);
  yield { ...report, tips: report.tips.slice() };
  const keep = (tip: Tip) => {
    const cur = report.tips[tip.segment];
    if (tip.gain >= MIN_GAIN && (!cur || tip.gain > cur.gain)) report.tips[tip.segment] = tip;
  };
  for (let k = 0; k < total; k++) {
    // The other pedal: the line stays the same.
    const flipped = picks.map((p) => ({ ...p }));
    flipped[k] = { ...flipped[k], pedal: picks[k].pedal === 'gas' ? 'brake' : 'gas' };
    keep({ segment: k, pedal: flipped[k].pedal, gain: report.timeMs - lapMs(track, line, compound, course, flipped, report.perfectMs) });
    // Each other gate the segment can reach: the line is laid again.
    for (const lane of laneOptions(course, picks, k)) {
      if (lane === picks[k].lane) continue;
      const trial = picks.map((p) => ({ ...p }));
      trial[k] = { ...trial[k], lane };
      settleLanes(course, trial, k);
      const other = lapLine(track, course, trial);
      if (other) keep({ segment: k, lane, gain: report.timeMs - lapMs(track, other, compound, course, trial, freeMs(track, other, compound)) });
    }
    report.checked = k + 1;
    if (k % 3 === 2) yield { ...report, tips: report.tips.slice() };
  }
  report.done = true;
  yield { ...report, tips: report.tips.slice() };
}

/** The tips with the most to win, biggest first. */
export function bestTips(report: CoachReport | null, count = Infinity): Tip[] {
  if (!report) return [];
  return report.tips.filter((t): t is Tip => !!t).sort((a, b) => b.gain - a.gain).slice(0, count);
}

/** The change in plain words: "Brake", "Gas" (the pad's buttons), or the side of the road: "Left side", "Middle of the road", "Right side". */
export function tipAction(tip: Tip): string {
  if (tip.pedal) return tip.pedal === 'brake' ? 'Brake' : 'Gas';
  return tip.lane === -1 ? 'Left side' : tip.lane === 1 ? 'Right side' : 'Middle of the road';
}

/** Seconds a tip wins, to two places: "0.42". */
export function tipSeconds(tip: Tip): string {
  return (tip.gain / 1000).toFixed(2);
}
