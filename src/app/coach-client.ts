// Starts the segment by segment analysis in a worker and hands its reports to
// whichever screen is showing: the results while it finishes, then Edit
// segments. Only the latest lap is analysed; starting another stops the last.

import type { CoachReport } from './coach';
import type { CoachMessage, CoachRequest } from './coach.worker';
import { encodePicks, type Course, type Pick } from './segments';
import type { Track } from '../sim/track';
import type { Compound } from '../sim/types';

export class Coach {
  report: CoachReport | null = null;
  /** How long the worker has taken so far (ms). */
  ms = 0;
  private listeners = new Set<(r: CoachReport) => void>();
  private worker: Worker | null = null;

  /** The plan analysed (encodePicks). */
  readonly picks: string;

  constructor(
    readonly slug: string,
    req: CoachRequest,
  ) {
    this.picks = encodePicks(req.picks);
    try {
      this.worker = new Worker(new URL('./coach.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<CoachMessage>) => {
        this.report = e.data.report;
        this.ms = e.data.ms;
        for (const fn of this.listeners) fn(e.data.report);
        if (e.data.report.done) this.stop();
      };
      this.worker.onerror = (e) => {
        console.error('coach worker failed', e.message);
        this.stop();
      };
      this.worker.postMessage(req);
    } catch (err) {
      console.error('coach worker could not start', err);
      this.worker = null;
    }
  }

  /** Call `fn` with every report from now on (and the latest one, if any). Returns a function that stops it. */
  watch(fn: (r: CoachReport) => void): () => void {
    this.listeners.add(fn);
    if (this.report) fn(this.report);
    return () => this.listeners.delete(fn);
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

let latest: Coach | null = null;

/** Analyse a lap just laid; the previous analysis stops. */
export function startCoach(track: Track, course: Course, picks: Pick[], compound: Compound): Coach {
  latest?.stop();
  // Typed arrays and plain objects only: the track goes over as a copy.
  latest = new Coach(track.meta.slug, { track, course, picks: picks.map((p) => ({ ...p })), compound });
  return latest;
}

/** The analysis of the latest lap on a circuit, if it was this plan. */
export function coachFor(slug: string, picks: string): Coach | null {
  return latest && latest.slug === slug && latest.picks === picks ? latest : null;
}
