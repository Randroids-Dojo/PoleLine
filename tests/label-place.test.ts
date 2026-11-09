import { describe, expect, it } from 'vitest';
import { placeLabels, type Box } from '../src/render/label-place';

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const within = (a: Box, b: Box) => a.x >= b.x - 1e-9 && a.y >= b.y - 1e-9 && a.x + a.w <= b.x + b.w + 1e-9 && a.y + a.h <= b.y + b.h + 1e-9;
const screen = { x: 8, y: 100, w: 374, h: 640 };

/** A small deterministic random sequence. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('placing the time labels on the whole track', () => {
  it('never overlaps labels whose segments sit side by side at the edge of the screen', () => {
    // As on the phone: three neighbouring segments near the left edge with
    // badges about. The placement before this one put two of these labels on
    // top of each other (it fell back to its first spot when its few others
    // were taken).
    const items = [
      { x: 47, y: 636, w: 185, h: 24 },
      { x: 62, y: 619, w: 185, h: 24 },
      { x: 73, y: 588, w: 185, h: 24 },
    ];
    const badges: Box[] = [
      { x: 45, y: 634, w: 36, h: 20 },
      { x: 112, y: 698, w: 36, h: 20 },
      { x: 128, y: 713, w: 36, h: 20 },
      { x: 4, y: 613, w: 36, h: 20 },
    ];
    const spots = placeLabels(items, badges, screen);
    const placed = spots.filter((b): b is Box => !!b);
    expect(placed.length).toBe(3);
    for (let i = 0; i < placed.length; i++) {
      expect(within(placed[i], screen)).toBe(true);
      for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j])).toBe(false);
    }
  });

  it('never overlaps, whatever the crowding: a thousand random layouts', () => {
    const r = rng(7);
    for (let n = 0; n < 1000; n++) {
      const count = 1 + Math.floor(r() * 6);
      const cx = 8 + r() * 374;
      const cy = 100 + r() * 640;
      const items = Array.from({ length: count }, () => ({ x: cx + (r() - 0.5) * 60, y: cy + (r() - 0.5) * 60, w: 150 + r() * 60, h: 24 }));
      const badges = Array.from({ length: 8 }, () => ({ x: cx + (r() - 0.5) * 200, y: cy + (r() - 0.5) * 200, w: 34, h: 18 }));
      const placed = placeLabels(items, badges, screen).filter((b): b is Box => !!b);
      for (let i = 0; i < placed.length; i++) {
        expect(within(placed[i], screen)).toBe(true);
        for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j])).toBe(false);
        // Nor over a badge: a label with no clear spot is left out.
        for (const b of badges) expect(overlap(placed[i], b)).toBe(false);
      }
      // Three labels always find room on a phone screen.
      if (count <= 3) expect(placed.length).toBe(count);
    }
  });

  it('keeps clear of the badges when there is room', () => {
    const badges: Box[] = [{ x: 140, y: 470, w: 40, h: 20 }];
    const [spot] = placeLabels([{ x: 160, y: 500, w: 160, h: 24 }], badges, screen);
    expect(spot).not.toBeNull();
    expect(overlap(spot!, badges[0])).toBe(false);
  });
});
