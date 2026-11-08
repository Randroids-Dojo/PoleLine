// Places labels near the points they belong to without ever overlapping each
// other. Each label tries spots in rings around its point, nearest first: a
// spot clear of the other labels and of the obstacles (badges already on the
// map) wins; failing that, one clear of the other labels only. A label with no
// room at all is left out rather than drawn over another. Spots stay inside
// the bounds (the free part of the screen).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Labels keep at least this far (px) from each other: more than a tap's slop around each. */
const GAP = 8;

function overlaps(a: Box, b: Box, gap: number): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

/**
 * Where to put each label (in order: the first gets the best spot), or null
 * for one with no room. `items` give each label's point (x, y) and size.
 */
export function placeLabels(items: readonly { x: number; y: number; w: number; h: number }[], obstacles: readonly Box[], bounds: Box): (Box | null)[] {
  const placed: Box[] = [];
  return items.map((it) => {
    // Spots around the point: rows above and below, nudged sideways, nearest first.
    const spots: Box[] = [];
    for (let row = 0; row < 7; row++) {
      for (const up of [true, false]) {
        const y = up ? it.y - it.h - 10 - row * (it.h + GAP) : it.y + 10 + row * (it.h + GAP);
        for (const shift of [0, -0.55, 0.55, -1.1, 1.1]) spots.push({ x: it.x - it.w / 2 + shift * it.w, y, w: it.w, h: it.h });
      }
    }
    const inside = (b: Box): Box => ({
      ...b,
      x: Math.max(bounds.x, Math.min(bounds.x + bounds.w - b.w, b.x)),
      y: Math.max(bounds.y, Math.min(bounds.y + bounds.h - b.h, b.y)),
    });
    const dist = (b: Box) => Math.hypot(b.x + b.w / 2 - it.x, b.y + b.h / 2 - it.y);
    const candidates = spots.map(inside).sort((a, b) => dist(a) - dist(b));
    const free = candidates.filter((b) => !placed.some((p) => overlaps(b, p, GAP)));
    const best = free.find((b) => !obstacles.some((o) => overlaps(b, o, 2))) ?? free[0] ?? null;
    if (best) placed.push(best);
    return best;
  });
}
