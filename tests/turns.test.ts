import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/data/catalog';
import { GEOMETRY_LOADERS } from '../src/data/geometry-loaders';
import { TURNS } from '../src/data/turns';
import { CATALOG as TOYBOX } from '../src/data/toybox/catalog';
import { GEOMETRY_LOADERS as TOYBOX_LOADERS } from '../src/data/toybox/geometry-loaders';
import { TURNS as TOYBOX_TURNS } from '../src/data/toybox/turns';
import { buildTrack, frameAt, type Track } from '../src/sim/track';
import type { TrackMeta } from '../src/sim/types';

/** How far the road turns (degrees) over 60 m either side of s. */
function bend(t: Track, s: number): number {
  let total = 0;
  for (let d = -60; d < 60; d += 4) {
    const a = frameAt(t, s + d);
    const b = frameAt(t, s + d + 4);
    total += Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty));
  }
  return (total * 180) / Math.PI;
}

const all: [string, TrackMeta, Record<string, () => Promise<{ default: number[] }>>, Record<string, number[]>][] = [
  ...CATALOG.map((m) => ['web', m, GEOMETRY_LOADERS, TURNS] as [string, TrackMeta, typeof GEOMETRY_LOADERS, Record<string, number[]>]),
  ...TOYBOX.map((m) => ['toybox', m, TOYBOX_LOADERS, TOYBOX_TURNS] as [string, TrackMeta, typeof TOYBOX_LOADERS, Record<string, number[]>]),
];

describe('turn numbers', () => {
  it.each(all.map(([ed, m, l, turns]) => [`${ed} ${m.slug}`, m, l, turns] as const))('%s: one position per turn, in lap order, each on a bend', async (_name, meta, loaders, turns) => {
    const t = buildTrack(meta, (await loaders[meta.slug]()).default);
    const at = turns[meta.slug];
    expect(at, 'turn positions').toBeDefined();
    expect(at.length).toBe(meta.turns);
    // In lap order: increasing, with at most one wrap past the start line.
    let wraps = 0;
    for (let i = 0; i < at.length; i++) {
      expect(at[i]).toBeGreaterThanOrEqual(0);
      expect(at[i]).toBeLessThan(t.length);
      if (i && at[i] <= at[i - 1]) wraps++;
    }
    if (wraps) expect(at[at.length - 1]).toBeLessThan(at[0]);
    expect(wraps).toBeLessThanOrEqual(1);
    // Every turn is somewhere the road bends.
    for (const s of at) expect(bend(t, s)).toBeGreaterThan(6);
  });
});
