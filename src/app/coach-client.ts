// Starts the segment by segment analysis in a worker and hands its reports to
// whichever screen is showing: the results while it finishes, then Edit
// segments, which asks again whenever the plan or tyre changes. Only one
// analysis runs at a time: starting another stops the last, unless it is the
// same plan on the same tyre. Finished analyses are kept for a while, so a plan
// seen before (an undo, the lap just raced) answers at once.

import type { CoachReport } from './coach';
import type { CoachMessage, CoachRequest } from './coach.worker';
import { encodePicks, type Course, type Pick } from './segments';
import type { Track } from '../sim/track';
import type { Compound } from '../sim/types';

/** Finished analyses kept, newest last. */
const KEEP = 24;
const done = new Map<string, CoachReport>();

const keyOf = (slug: string, picks: string, compound: Compound) => `${slug}|${compound}|${picks}`;

export class Coach {
  report: CoachReport | null = null;
  /** How long the worker has taken so far (ms). */
  ms = 0;
  private listeners = new Set<(r: CoachReport) => void>();
  private worker: Worker | null = null;

  /** The plan analysed (encodePicks) and its tyre. */
  readonly picks: string;
  readonly compound: Compound;

  constructor(
    readonly slug: string,
    req: CoachRequest,
  ) {
    this.picks = encodePicks(req.picks);
    this.compound = req.compound;
    const known = done.get(keyOf(slug, this.picks, this.compound));
    if (known) {
      this.report = known;
      return;
    }
    try {
      this.worker = new Worker(new URL('./coach.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<CoachMessage>) => {
        this.report = e.data.report;
        this.ms = e.data.ms;
        if (e.data.report.done) {
          const key = keyOf(slug, this.picks, this.compound);
          done.delete(key);
          done.set(key, e.data.report);
          if (done.size > KEEP) done.delete(done.keys().next().value!);
          this.stop();
        }
        for (const fn of this.listeners) fn(e.data.report);
      };
      this.worker.onerror = (e) => {
        console.error('coach worker failed', e.message);
        this.fail();
      };
      this.worker.postMessage(req);
    } catch (err) {
      console.error('coach worker could not start', err);
      this.fail();
    }
  }

  /** The worker failed: a last report with no tips, so nothing waits on it. Not kept, so the plan is tried again next time. */
  private fail(): void {
    this.stop();
    const r: CoachReport = { picks: this.picks, compound: this.compound, timeMs: 0, perfectMs: null, tips: [], checked: 0, done: true, failed: true };
    this.report = r;
    for (const fn of this.listeners) fn(r);
  }

  get running(): boolean {
    return !!this.worker;
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

/** Analyse a plan on a tyre. The analysis running for another plan stops; one already running for this plan carries on. */
export function startCoach(track: Track, course: Course, picks: Pick[], compound: Compound): Coach {
  const p = encodePicks(picks);
  if (latest && latest.slug === track.meta.slug && latest.picks === p && latest.compound === compound && (latest.running || (latest.report?.done && !latest.report.failed))) return latest;
  latest?.stop();
  // Typed arrays and plain objects only: the track goes over as a copy.
  latest = new Coach(track.meta.slug, { track, course, picks: picks.map((q) => ({ ...q })), compound });
  return latest;
}

/** A finished analysis of this plan on this tyre is at hand. */
export function analysed(slug: string, picks: Pick[], compound: Compound): boolean {
  return done.has(keyOf(slug, encodePicks(picks), compound));
}

/** The analysis of the latest lap on a circuit, if it was this plan on this tyre. */
export function coachFor(slug: string, picks: string, compound: Compound): Coach | null {
  return latest && latest.slug === slug && latest.picks === picks && latest.compound === compound ? latest : null;
}
