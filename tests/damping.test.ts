import { describe, expect, it } from 'vitest';
import { CornerDamper, CORNER_DAMPING_OPTIONS } from '../src/app/damping';
import { CATALOG } from '../src/data/catalog';
import silverstone from '../src/data/geometry/silverstone';
import { buildTrack } from '../src/sim/track';

const track = buildTrack(CATALOG.find((m) => m.slug === 'silverstone')!, silverstone);
const damper = new CornerDamper(track);

// The slowest and fastest points according to the racing-pace profile.
let slowS = 0, fastS = 0, slow = Infinity, fast = -Infinity;
for (let s = 0; s < track.length; s += 2) {
  const p = damper.factor('pace', s);
  if (p < slow) { slow = p; slowS = s; }
  if (p > fast) { fast = p; fastS = s; }
}

describe('corner damping', () => {
  it('offers off plus at least three variations', () => {
    expect(CORNER_DAMPING_OPTIONS[0].id).toBe('off');
    expect(CORNER_DAMPING_OPTIONS.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves the scroll alone when off', () => {
    expect(damper.factor('off', slowS)).toBe(1);
    expect(damper.factor('off', fastS)).toBe(1);
  });

  it('slows every variation in the tightest corner compared with the fastest straight', () => {
    for (const mode of ['gentle', 'early', 'hold', 'pace'] as const) {
      expect(damper.factor(mode, slowS)).toBeLessThan(damper.factor(mode, fastS));
      expect(damper.factor(mode, fastS)).toBeGreaterThan(0.85);
    }
  });

  it('brakes early: slower than gentle on the approach to a corner', () => {
    const approach = slowS - 40;
    expect(damper.factor('early', approach)).toBeLessThan(damper.factor('gentle', approach));
  });

  it('corner hold nearly stops in the slowest corner', () => {
    expect(damper.factor('hold', slowS)).toBeLessThan(0.25);
  });
});
