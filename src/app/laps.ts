// The player's own quickest laps on each circuit, kept on the device with
// their lines so any of them can be watched again. The Toybox edition shows
// these where the web edition shows the world leaderboard.

import type { Compound } from '../sim/types';
import { SIM_VERSION } from '../sim/version';
import type { DrawSetup } from './store';

const PREFIX = 'poleline:v1:';
/** How many laps per circuit are kept. */
export const LAPS_KEPT = 10;

export interface SavedLap {
  timeMs: number;
  compound: Compound;
  sectorsMs: [number, number, number];
  code: number[];
  date: string;
  setup?: DrawSetup;
}

function key(slug: string): string {
  return `${PREFIX}laps:v${SIM_VERSION}:${slug}`;
}

/** Quickest first. Every read is defensive: a bad entry is dropped, never thrown. */
export function getLaps(slug: string): SavedLap[] {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter((l): l is SavedLap => l && typeof l.timeMs === 'number' && Array.isArray(l.code) && Array.isArray(l.sectorsMs) && typeof l.date === 'string')
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, LAPS_KEPT);
  } catch {
    return [];
  }
}

/** Records a lap. Returns its rank among the kept laps, or null when it was too slow to keep. */
export function addLap(slug: string, lap: SavedLap): { rank: number | null; total: number } {
  const laps = getLaps(slug);
  laps.push(lap);
  laps.sort((a, b) => a.timeMs - b.timeMs);
  const idx = laps.indexOf(lap);
  const kept = laps.slice(0, LAPS_KEPT);
  try {
    localStorage.setItem(key(slug), JSON.stringify(kept));
  } catch {
    /* storage full or unavailable: the game still works without it */
  }
  return { rank: idx < LAPS_KEPT ? idx + 1 : null, total: kept.length };
}

/** Everything this game saved on the device. */
export function eraseAllData(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  for (const k of keys) localStorage.removeItem(k);
}

/** "Today 14:02", "Yesterday 09:30", "3 Oct" or "3 Oct 2025". */
export function whenText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60000) / 86400000);
  const diff = day(now) - day(d);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
