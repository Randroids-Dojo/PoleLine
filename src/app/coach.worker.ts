// Runs the segment by segment analysis (src/app/coach.ts) off the main
// thread, so the race playing in the meantime never stutters.

import { analysePlan, type CoachReport } from './coach';
import type { Course, Pick } from './segments';
import type { Track } from '../sim/track';
import type { Compound } from '../sim/types';

export interface CoachRequest {
  track: Track;
  course: Course;
  picks: Pick[];
  compound: Compound;
}

export interface CoachMessage {
  report: CoachReport;
  ms: number;
}

self.onmessage = (e: MessageEvent<CoachRequest>) => {
  const { track, course, picks, compound } = e.data;
  const t0 = performance.now();
  for (const report of analysePlan(track, course, picks, compound)) {
    (self as unknown as Worker).postMessage({ report, ms: performance.now() - t0 } satisfies CoachMessage);
  }
};
