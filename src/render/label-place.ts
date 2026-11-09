// Places labels near the points they belong to without ever overlapping each
// other or the obstacles (badges already on the map). Each label tries spots
// in rows above and below its point, nearest first, and takes the first one
// clear of both. A label with no such room is left out rather than drawn over
// anything (its segment is still shaded and can be tapped). Spots stay inside
// the bounds (the free part of the screen).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Labels keep at least this far (px) from each other: more than a tap's slop around each. */
const GAP = 8;
/** Rows of spots tried above and below a point. */
const ROWS = 10;

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
    for (let row = 0; row < ROWS; row++) {
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
    const best = candidates.find((b) => !placed.some((p) => overlaps(b, p, GAP)) && !obstacles.some((o) => overlaps(b, o, 2))) ?? null;
    if (best) placed.push(best);
    return best;
  });
}
