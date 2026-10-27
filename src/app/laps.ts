// The player's own quickest laps on each circuit, kept on the device with
// their lines so any of them can be watched again or edited. The Toybox
// edition shows these where the web edition shows the world leaderboard.

import { packLine, unpackLine } from '../sim/pack';
import type { Compound } from '../sim/types';
import { SIM_VERSION } from '../sim/version';
import { getBest, type DrawSetup } from './store';

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

/** On the device a lap's line is packed (src/sim/pack.ts), less than half the size of the numbers. Older saves hold the numbers. */
type StoredLap = Omit<SavedLap, 'code'> & { code?: number[]; line?: string };

function stored(slug: string): SavedLap[] {
  try {
    const raw = localStorage.getItem(key(slug));
    if (!raw) return [];
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    const out: SavedLap[] = [];
    for (const l of v as StoredLap[]) {
      if (!l || typeof l.timeMs !== 'number' || !Array.isArray(l.sectorsMs) || typeof l.date !== 'string') continue;
      let code: number[] | null = Array.isArray(l.code) ? l.code : null;
      if (!code && typeof l.line === 'string') {
        try {
          code = unpackLine(l.line);
        } catch {
          code = null;
        }
      }
      if (!code) continue;
      const { line: _line, ...rest } = l;
      void _line;
      out.push({ ...rest, code });
    }
    return out;
  } catch {
    return [];
  }
}

function sameCode(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Quickest first. Every read is defensive: a bad entry is dropped, never
 * thrown. The personal best is always among them: the web edition kept only
 * that before it kept laps.
 */
export function getLaps(slug: string): SavedLap[] {
  const laps = stored(slug);
  const pb = getBest(slug);
  if (pb && !laps.some((l) => l.timeMs === pb.timeMs && sameCode(l.code, pb.code))) {
    laps.push({ timeMs: pb.timeMs, compound: pb.compound, sectorsMs: pb.sectorsMs, code: pb.code, date: pb.date, setup: pb.setup });
  }
  return laps.sort((a, b) => a.timeMs - b.timeMs).slice(0, LAPS_KEPT);
}

/** Records a lap. Returns its rank among the kept laps, or null when it was too slow to keep. */
export function addLap(slug: string, lap: SavedLap): { rank: number | null; total: number } {
  const laps = getLaps(slug);
  // A new best is saved as the personal best first, so getLaps may list it already.
  let entry = laps.find((l) => l.timeMs === lap.timeMs && sameCode(l.code, lap.code));
  if (!entry) {
    entry = lap;
    laps.push(lap);
  }
  laps.sort((a, b) => a.timeMs - b.timeMs);
  const idx = laps.indexOf(entry);
  const kept = laps.slice(0, LAPS_KEPT);
  try {
    localStorage.setItem(key(slug), JSON.stringify(kept.map(({ code, ...rest }): StoredLap => ({ ...rest, line: packLine(code) }))));
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

/** "14:02" for today, then "Yesterday", "3 Oct" or "3 Oct 2025". Short, so it fits beside a grid slot. */
export function whenText(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60000) / 86400000);
  const diff = day(now) - day(d);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diff === 0) return time;
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}
