// Posts personal bests that never reached the leaderboard (set before the
// player chose a name, or while offline). Sequential, stops at the first
// failure so it never hammers the rate limit.

import { CATALOG } from '../data/catalog';
import { submitLap } from './api';
import { getBest, getPlayer, markSubmitted } from './store';

let running = false;

export async function flushUnsubmitted(skip?: string): Promise<void> {
  const p = getPlayer();
  if (!p.name || running) return;
  running = true;
  try {
    for (const m of CATALOG) {
      if (m.slug === skip) continue;
      const pb = getBest(m.slug);
      if (!pb || pb.submitted) continue;
      try {
        await submitLap({ track: m.slug, compound: pb.compound, line: pb.code, playerId: p.id, name: p.name, setup: pb.setup });
        markSubmitted(m.slug);
      } catch (err) {
        // A lap the server refuses will never post (say, a tutorial lap from an older opening):
        // stop retrying it and carry on. Anything else (offline, busy) waits for next time.
        if (err instanceof Error && /^line rejected|^lap time out of range/.test(err.message)) {
          markSubmitted(m.slug);
          continue;
        }
        break;
      }
    }
  } finally {
    running = false;
  }
}
