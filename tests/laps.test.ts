import { beforeEach, describe, expect, it } from 'vitest';

// A browser-free stand-in for localStorage.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() {
    return mem.size;
  },
} as Storage;

const { addLap, eraseAllData, getLaps, LAPS_KEPT, whenText } = await import('../src/app/laps');

const lap = (timeMs: number) => ({ timeMs, compound: 'soft' as const, sectorsMs: [1, 2, 3] as [number, number, number], code: [0, 0, 1, 1], date: '2026-10-20T10:00:00.000Z' });

describe('saved laps', () => {
  beforeEach(() => mem.clear());

  it('keeps the quickest laps in order and reports where a lap landed', () => {
    expect(addLap('x', lap(70000))).toEqual({ rank: 1, total: 1 });
    expect(addLap('x', lap(72000))).toEqual({ rank: 2, total: 2 });
    expect(addLap('x', lap(69000))).toEqual({ rank: 1, total: 3 });
    expect(getLaps('x').map((l) => l.timeMs)).toEqual([69000, 70000, 72000]);
  });

  it('drops laps slower than the kept set once it is full', () => {
    for (let i = 0; i < LAPS_KEPT; i++) addLap('y', lap(60000 + i * 100));
    expect(addLap('y', lap(99000))).toEqual({ rank: null, total: LAPS_KEPT });
    expect(addLap('y', lap(59000)).rank).toBe(1);
    expect(getLaps('y')).toHaveLength(LAPS_KEPT);
    expect(getLaps('y')[LAPS_KEPT - 1].timeMs).toBe(60000 + (LAPS_KEPT - 2) * 100);
  });

  it('survives junk in storage and erases only its own keys', () => {
    localStorage.setItem('poleline:v1:laps:v2:z', '{"not":"a list"}');
    expect(getLaps('z')).toEqual([]);
    localStorage.setItem('other', '1');
    addLap('z', lap(1));
    eraseAllData();
    expect(getLaps('z')).toEqual([]);
    expect(localStorage.getItem('other')).toBe('1');
  });

  it('describes when a lap was set relative to today', () => {
    const now = new Date(2026, 9, 20, 15, 0);
    expect(whenText(new Date(2026, 9, 20, 9, 5).toISOString(), now)).toMatch(/^\d{1,2}:05/);
    expect(whenText(new Date(2026, 9, 19, 23, 59).toISOString(), now)).toBe('Yesterday');
    expect(whenText(new Date(2026, 9, 3).toISOString(), now)).toMatch(/Oct/);
    expect(whenText(new Date(2025, 9, 3).toISOString(), now)).toMatch(/2025/);
    expect(whenText('garbage', now)).toBe('');
  });
});
