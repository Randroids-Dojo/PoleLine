import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/data/catalog';
import rookie from '../src/data/geometry/rookie-ring';
import { TUTORIAL } from '../src/data/tutorial';
import { LineBuilder } from '../src/sim/builder';
import { simulateLap } from '../src/sim/lapsim';
import { decodePath, encodePath, validatePath } from '../src/sim/path';
import { buildTrack } from '../src/sim/track';

const meta = CATALOG.find((m) => m.slug === TUTORIAL.slug)!;
const track = buildTrack(meta, rookie);

/** Absolute decimetre points from delta code. */
function absolute(code: readonly number[]): number[] {
  const out: number[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < code.length; i += 2) {
    x += code[i];
    y += code[i + 1];
    out.push(x, y);
  }
  return out;
}

describe('tutorial circuit', () => {
  it('is a short made-up circuit, not a round, set up for mediums', () => {
    expect(meta.tutorial).toBe(true);
    expect(meta.length).toBeGreaterThan(1400);
    expect(meta.length).toBeLessThan(1900);
    const line = decodePath(TUTORIAL.line);
    expect(validatePath(track, line).ok).toBe(true);
    const [s, m, h] = (['soft', 'medium', 'hard'] as const).map((c) => simulateLap(track, line, c).timeMs);
    // About 30 seconds, so a whole lap is worth watching.
    expect(m).toBeGreaterThan(29000);
    expect(m).toBeLessThan(31000);
    expect(m).toBeLessThan(s);
    expect(m).toBeLessThan(h);
  });

  it('starts the player from the drawn line and lets them finish the last corner', () => {
    const all = absolute(TUTORIAL.line);
    const prefix = all.slice(0, TUTORIAL.prefixPoints * 2);
    const b = new LineBuilder(track);
    expect(b.preload(prefix)).toBe(true);
    expect(b.status).toBe('drawing');
    expect(b.preloaded).toBe(TUTORIAL.prefixPoints);
    expect(b.canUndo).toBe(false);
    expect(b.progress).toBeGreaterThan(TUTORIAL.handoff - 5);
    expect(b.progress).toBeLessThan(TUTORIAL.cornerIn);
    // Undo never eats into the drawn line.
    b.beginStroke();
    expect(b.extend(all[prefix.length] / 10, all[prefix.length + 1] / 10)).toBe('ok');
    expect(b.undoStroke()).toBe(true);
    expect(b.count).toBe(TUTORIAL.prefixPoints);
    expect(b.undoStroke()).toBe(false);
    // Finish along the ideal line.
    let r = '';
    for (let i = prefix.length; i < all.length && r !== 'finish'; i += 2) r = b.extend(all[i] / 10, all[i + 1] / 10);
    expect(b.status).toBe('done');
    const code = encodePath(b.points as number[]);
    expect(code.slice(0, prefix.length)).toEqual(TUTORIAL.line.slice(0, prefix.length));
    expect(validatePath(track, decodePath(code)).ok).toBe(true);
  });
});
