// Local persistence: player identity, personal bests (with the line, so the
// ghost can be re-simulated), and settings. Every read is defensive.

import type { Compound } from '../sim/types';
import { SIM_VERSION } from '../sim/version';
import type { CornerDamping } from './damping';

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

/**
 * What happens when the map needs to move to show more track while drawing.
 * `pause`: the stroke ends, the map glides on, and the player lifts and carries
 * on from the tip. `continuous`: the map scrolls under the finger while drawing.
 */
export type ScrollMode = 'pause' | 'continuous';

export interface Settings {
  sound: boolean;
  tutorialDone: boolean;
  lastTrack: string;
  attempts: number;
  scrollMode: ScrollMode;
  /** Continuous scroll speed multiplier, 0.25 to 2. */
  scrollSpeed: number;
  /** Continuous mode only: how the scroll slows near corners. */
  cornerDamping: CornerDamping;
  keepAwake: boolean;
  /** Turn the map so the road ahead points up. Off: the player sets the angle. */
  autoRotate: boolean;
  /** The one-time "drag the grass" demo has been shown. */
  panCoachSeen: boolean;
  /** Car livery id (see src/render/liveries.ts). */
  livery: string;
  /** The after-lap "add to home screen" prompt has been shown. */
  installPrompted: boolean;
  /** The after-lap lap alerts prompt has been shown. */
  alertsPrompted: boolean;
  /** Push a notification when someone beats one of this player's times. */
  alerts: boolean;
}

export const SCROLL_SPEED_MIN = 0.25;
export const SCROLL_SPEED_MAX = 2;
export const SCROLL_SPEED_DEFAULT = 0.35;

/**
 * Stored settings only hold what the player actually changed, so a new default
 * reaches everyone who never touched that setting. Version 2 dropped the
 * scroll speeds that version 1 saved implicitly alongside other settings.
 */
const SETTINGS_VERSION = 2;

function storedSettings(): Partial<Settings> & { v?: number } {
  const raw = read<Partial<Settings> & { v?: number }>('settings', {});
  if ((raw.v ?? 1) < SETTINGS_VERSION) {
    delete raw.scrollSpeed;
    raw.v = SETTINGS_VERSION;
    write('settings', raw);
  }
  return raw;
}

export function getSettings(): Settings {
  const { v: _v, ...stored } = storedSettings();
  void _v;
  const s: Settings = {
    sound: true,
    tutorialDone: false,
    lastTrack: 'spielberg',
    attempts: 0,
    scrollMode: 'pause',
    scrollSpeed: SCROLL_SPEED_DEFAULT,
    cornerDamping: 'off',
    keepAwake: true,
    autoRotate: true,
    panCoachSeen: false,
    livery: 'poleline',
    installPrompted: false,
    alertsPrompted: false,
    alerts: false,
    ...stored,
  };
  if (s.scrollMode !== 'pause' && s.scrollMode !== 'continuous') s.scrollMode = 'pause';
  if (!['off', 'gentle', 'early', 'hold', 'pace'].includes(s.cornerDamping)) s.cornerDamping = 'off';
  const sp = Number(s.scrollSpeed);
  s.scrollSpeed = Number.isFinite(sp) ? Math.min(SCROLL_SPEED_MAX, Math.max(SCROLL_SPEED_MIN, sp)) : SCROLL_SPEED_DEFAULT;
  return s;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  write('settings', { ...storedSettings(), ...patch, v: SETTINGS_VERSION });
  return getSettings();
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
