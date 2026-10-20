import { describe, expect, it } from 'vitest';
import { CATALOG as WEB } from '../src/data/catalog';
import { CATALOG } from '../src/data/toybox/catalog';
import { GEOMETRY_LOADERS } from '../src/data/toybox/geometry-loaders';
import { CIRCUITS } from '../scripts/toybox/circuits';
import { layout } from '../scripts/toybox/plan';
import { minCurvatureOffsets, offsetsToLine } from '../scripts/optimal';
import { simulateLap } from '../src/sim/lapsim';
import { decodePath, encodePath, validatePath } from '../src/sim/path';
import { buildTrack } from '../src/sim/track';

/** Names and words that must never appear in the Toybox edition's circuit data. */
const REAL = /formula|f1\b|grand prix|silverstone|monaco|monza|spa\b|suzuka|melbourne|shanghai|bahrain|jeddah|miami|imola|barcelona|montr|spielberg|hungar|zandvoort|baku|singapore|austin|mexico|interlagos|vegas|lusail|yas|ferrari|mclaren|mercedes|red bull|aston|alpine|williams|haas|audi|cadillac/i;

describe('toybox circuits', () => {
  it('lists the shared tutorial circuit first, then twenty made-up rounds', () => {
    expect(CATALOG).toHaveLength(21);
    expect(CATALOG[0].tutorial).toBe(true);
    expect(CATALOG[0]).toEqual(WEB.find((m) => m.tutorial));
    expect(CATALOG.slice(1).map((m) => m.slug)).toEqual(CIRCUITS.map((c) => c.slug));
    for (const m of CATALOG) expect(GEOMETRY_LOADERS[m.slug]).toBeTypeOf('function');
  });

  it('never names a real circuit, place or team', () => {
    for (const m of CATALOG) {
      for (const text of [m.name, m.short, m.country, m.slug]) expect(text, `${m.slug}: ${text}`).not.toMatch(REAL);
    }
    for (const c of CIRCUITS) expect(c.character).not.toMatch(REAL);
  });

  it('closes every plan and keeps its sections apart', () => {
    for (const c of CIRCUITS) {
      const r = layout(c.corners, c.scale ?? 1);
      expect(r.problems, c.slug).toEqual([]);
      expect(r.minSeparation).toBeGreaterThanOrEqual(46);
      expect(r.length).toBeGreaterThan(2800);
      expect(r.length).toBeLessThan(6500);
    }
  });

  it('has a lap time, a legal ideal line and a quickest tyre that beats pole on every round', async () => {
    for (const m of CATALOG) {
      if (m.tutorial) continue;
      const geom = (await GEOMETRY_LOADERS[m.slug]()).default;
      const track = buildTrack(m, geom);
      const line = decodePath(encodePath(offsetsToLine(track, minCurvatureOffsets(track))));
      expect(validatePath(track, line).ok, m.slug).toBe(true);
      const quickest = Math.min(...(['soft', 'medium', 'hard'] as const).map((c) => simulateLap(track, line, c).timeMs));
      // The ideal line beats pole by about 1.5 percent, as on the real circuits.
      expect(quickest / 1000, m.slug).toBeLessThan(m.poleRef);
      expect(quickest / 1000, m.slug).toBeGreaterThan(m.poleRef * 0.97);
      expect(m.poleRef).toBeGreaterThan(38);
      expect(m.poleRef).toBeLessThan(120);
      expect(m.poleSectors[0] + m.poleSectors[1] + m.poleSectors[2]).toBeCloseTo(1, 2);
      expect(m.straights.length).toBeGreaterThan(0);
      expect(m.grip).toBeGreaterThan(0.85);
      expect(m.grip).toBeLessThan(1.25);
    }
  }, 120000);
});
