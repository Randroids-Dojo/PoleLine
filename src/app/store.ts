// Local persistence: player identity, personal bests (with the line, so the
// ghost can be re-simulated), and settings. Every read is defensive.

import type { Compound } from '../sim/types';
import { SIM_VERSION } from '../sim/version';

const PREFIX = 'poleline:v1:';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the game still works without it */
  }
}

export interface Player {
  id: string;
  name: string;
}

export function getPlayer(): Player {
  let p = read<Player | null>('player', null);
  if (!p || typeof p.id !== 'string' || !/^[a-f0-9-]{16,40}$/.test(p.id)) {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    p = { id, name: '' };
    write('player', p);
  }
  return p;
}

export function setPlayerName(name: string): Player {
  const p = getPlayer();
  p.name = name;
  write('player', p);
  return p;
}

export interface PersonalBest {
  /** Physics version the time was set under. */
  v?: number;
  timeMs: number;
  compound: Compound;
  sectorsMs: [number, number, number];
  code: number[];
  date: string;
  submitted?: boolean;
}

export function getBest(slug: string): PersonalBest | null {
  const b = read<PersonalBest | null>(`pb:${slug}`, null);
  if (!b || typeof b.timeMs !== 'number' || !Array.isArray(b.code) || (b.v ?? 1) !== SIM_VERSION) return null;
  return b;
}

export function setBest(slug: string, pb: PersonalBest): void {
  write(`pb:${slug}`, { ...pb, v: SIM_VERSION });
}

export function markSubmitted(slug: string): void {
  const b = getBest(slug);
  if (b) {
    b.submitted = true;
    setBest(slug, b);
  }
}

/** Best sector times ever on this circuit (any lap), for green sectors. */
export function getBestSectors(slug: string): [number, number, number] | null {
  return read<[number, number, number] | null>(`sectors:v${SIM_VERSION}:${slug}`, null);
}

export function updateBestSectors(slug: string, s: [number, number, number]): void {
  const cur = getBestSectors(slug);
  const next: [number, number, number] = cur
    ? [Math.min(cur[0], s[0]), Math.min(cur[1], s[1]), Math.min(cur[2], s[2])]
    : [s[0], s[1], s[2]];
  write(`sectors:v${SIM_VERSION}:${slug}`, next);
}

export interface Settings {
  sound: boolean;
  tutorialDone: boolean;
  lastTrack: string;
  attempts: number;
}

export function getSettings(): Settings {
  return { sound: true, tutorialDone: false, lastTrack: 'bahrain', attempts: 0, ...read<Partial<Settings>>('settings', {}) };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  write('settings', next);
  return next;
}

export function getTyre(slug: string): Compound {
  const t = read<string>(`tyre:${slug}`, 'soft');
  return t === 'medium' || t === 'hard' ? t : 'soft';
}

export function setTyre(slug: string, c: Compound): void {
  write(`tyre:${slug}`, c);
}

export function getAttempts(slug: string): number {
  return read<number>(`attempts:${slug}`, 0);
}

export function bumpAttempts(slug: string): number {
  const n = getAttempts(slug) + 1;
  write(`attempts:${slug}`, n);
  return n;
}
