// One or two lines of race-engineer feedback derived from the lap, so every
// attempt tells the player what to try next.

import { COMPOUND_SPECS } from '../sim/car';
import type { LapResult } from '../sim/lapsim';
import { projectNear, type Projection, type Track } from '../sim/track';
import { formatDelta } from './format';

export function engineerNotes(track: Track, lap: LapResult, pts: Float64Array): string[] {
  const notes: string[] = [];
  const spec = COMPOUND_SPECS[lap.compound];
  const name = spec.label.toLowerCase() + 's';
  const n = lap.n;

  // Tyre temperature.
  const hotLimit = spec.tOpt + spec.window;
  const coldLimit = spec.tOpt - spec.window;
  let hotAt = -1;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += lap.tyre[i];
    if (hotAt < 0 && lap.tyre[i] > hotLimit + 2) hotAt = i;
  }
  const avg = sum / n;
  if (hotAt >= 0) {
    const sector = Math.min(3, 1 + Math.floor((lap.s[hotAt] / track.length) * 3));
    notes.push(`Your ${name} overheated in sector ${sector}, peaking at ${Math.round(lap.stats.tyreMax)}°C. A smoother line or a harder compound keeps them in the window.`);
  } else if (avg < coldLimit) {
    notes.push(`The ${name} never reached their window on a ${track.meta.trackTemp}°C track (average ${Math.round(avg)}°C). A softer compound will grip much better here.`);
  }

  // Closing the loop.
  const m = pts.length / 2;
  const gap = Math.hypot(pts[0] - pts[(m - 1) * 2], pts[1] - pts[(m - 1) * 2 + 1]);
  if (gap > 2.5) {
    notes.push(`You crossed the line ${gap.toFixed(1)} m from where you started, so the car had to cut across the straight. Finish where you began.`);
  }

  // Energy (2026 power units): clipping earlier than an ideal lap means the
  // line spent more battery than it won back.
  const clip = lap.stats.clipSpeed;
  const ref = track.meta.clipRef;
  if (notes.length < 2 && Number.isFinite(clip) && ref > 0 && clip < ref - 2.2) {
    const early = Math.round((ref - clip) * 3.6);
    notes.push(
      `The battery only lasted by clipping at ${Math.round(clip * 3.6)} km/h, ${early} km/h earlier than an ideal lap. Carry more speed through the corners so exits need less deployment; every hard braking zone recharges it.`,
    );
  }

  // Width usage.
  if (notes.length < 2) {
    const proj: Projection = { seg: 0, s: 0, d: 0, dist: 0 };
    let hint = 0;
    let wide = 0;
    for (let k = 0; k < m; k++) {
      projectNear(track, pts[k * 2], pts[k * 2 + 1], hint, 12, proj);
      hint = proj.seg;
      if (proj.dist > track.limit * 0.62) wide++;
    }
    if (wide / m < 0.16) {
      notes.push('You stayed near the middle of the road. Swing out wide before each corner and clip the apex to open it up.');
    }
  }

  // Where the time is.
  if (notes.length < 2) {
    let worst = 0;
    let worstGap = -Infinity;
    for (let k = 0; k < 3; k++) {
      const ref = track.meta.poleRef * 1000 * track.meta.poleSectors[k];
      const g = lap.sectorsMs[k] - ref;
      if (g / ref > worstGap) {
        worstGap = g / ref;
        worst = k;
      }
    }
    const ref = track.meta.poleRef * 1000 * track.meta.poleSectors[worst];
    const g = lap.sectorsMs[worst] - ref;
    if (g > 0) notes.push(`Most of your gap to pole pace is in sector ${worst + 1} (${formatDelta(g)}). Rework the corners there first.`);
    else notes.push('Every sector is on pole pace. Now shave the tenths: tighter apexes, earlier power.');
  }
  return notes.slice(0, 2);
}
