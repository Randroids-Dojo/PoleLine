// Thin client for the global leaderboard. Every call degrades gracefully: the
// game is fully playable offline, the board just shows as unavailable.

import type { Compound } from '../sim/types';
import type { DrawSetup } from './store';

export interface BoardEntry {
  rank: number;
  name: string;
  timeMs: number;
  compound: Compound;
  date: string;
  /** How they drew their best lap; null for laps posted before setups were recorded. */
  setup: DrawSetup | null;
  you: boolean;
}

export interface Board {
  entries: BoardEntry[];
  total: number;
  you: { rank: number; timeMs: number } | null;
}

export interface Records {
  [slug: string]: { name: string; timeMs: number; compound: Compound };
}

export interface SubmitResult {
  timeMs: number;
  rank: number | null;
  total: number;
  improved: boolean;
  bestMs: number;
}

async function request<T>(url: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export function fetchBoard(track: string, playerId: string, limit = 50): Promise<Board> {
  const q = new URLSearchParams({ track, player: playerId, limit: String(limit) });
  return request<Board>(`/api/leaderboard?${q}`);
}

let recordsCache: { at: number; data: Records } | null = null;

export async function fetchRecords(force = false): Promise<Records> {
  if (!force && recordsCache && Date.now() - recordsCache.at < 60000) return recordsCache.data;
  const data = await request<{ records: Records }>('/api/leaderboard?summary=1');
  recordsCache = { at: Date.now(), data: data.records ?? {} };
  return recordsCache.data;
}

export function submitLap(payload: { track: string; compound: Compound; line: number[]; playerId: string; name: string; setup?: DrawSetup }): Promise<SubmitResult> {
  recordsCache = null;
  return request<SubmitResult>(
    '/api/leaderboard',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    15000,
  );
}

export function renamePlayer(playerId: string, name: string): Promise<{ name: string; updated: number }> {
  recordsCache = null;
  return request('/api/leaderboard', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ playerId, name }) });
}
