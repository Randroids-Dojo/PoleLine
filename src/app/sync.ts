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
      } catch {
        break;
      }
    }
  } finally {
    running = false;
  }
}
