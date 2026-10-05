// Generates data-src/poleline-rookie-ring.geojson, the made-up tutorial
// circuit, from a plan of straights and arcs. The plan is built in metres
// (x east, y north) starting on the start/finish line heading east, two of the
// straights are solved so the loop closes exactly, and the result is written as
// lon/lat like the real circuits so it goes through the same build.
//
//   npx tsx scripts/rookie-ring.ts && npm run tracks:build

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Seg = { straight: number } | { arc: number; radius: number }; // arc degrees: + left, - right

/** Everything scales together, so the lap length can be tuned with one number. */
export const SCALE = 1.0;

function plan(b: number, c: number): Seg[] {
  const s = SCALE;
  return [
    { straight: 220 * s }, // start/finish to turn 1
    { arc: -90, radius: 38 * s }, // T1 right
    { straight: 140 * s },
    { arc: -60, radius: 75 * s }, // T2 right, fast
    { arc: 60, radius: 75 * s }, // T3 left, fast
    { straight: b }, // solved: down to the hairpin
    { arc: -180, radius: 19 * s }, // T4 right hairpin
    { straight: 260 * s }, // out of the hairpin
    { arc: 90, radius: 55 * s }, // T5 left onto the back straight
    { straight: 260 * s }, // back straight
    { arc: -180, radius: 42 * s }, // T6 right, the final corner
    { straight: c }, // solved: final straight to the line
  ];
}

function walk(segs: Seg[], step = 2): { pts: [number, number][]; end: [number, number]; heading: number } {
  let x = 0, y = 0, h = 0; // heading in degrees, 0 = east
  const pts: [number, number][] = [[0, 0]];
  for (const seg of segs) {
    if ('straight' in seg) {
      const n = Math.max(1, Math.round(seg.straight / step));
      for (let i = 1; i <= n; i++) {
        const d = (seg.straight * i) / n;
        pts.push([x + Math.cos((h * Math.PI) / 180) * d, y + Math.sin((h * Math.PI) / 180) * d]);
      }
      x += Math.cos((h * Math.PI) / 180) * seg.straight;
      y += Math.sin((h * Math.PI) / 180) * seg.straight;
    } else {
      const len = (Math.abs(seg.arc) * Math.PI * seg.radius) / 180;
      const n = Math.max(2, Math.round(len / step));
      const sign = Math.sign(seg.arc);
      // Centre of the arc sits to the left (left turn) or right (right turn).
      const cx = x + Math.cos(((h + 90 * sign) * Math.PI) / 180) * seg.radius;
      const cy = y + Math.sin(((h + 90 * sign) * Math.PI) / 180) * seg.radius;
      const a0 = h - 90 * sign;
      for (let i = 1; i <= n; i++) {
        const a = a0 + (seg.arc * i) / n;
        pts.push([cx + Math.cos((a * Math.PI) / 180) * seg.radius, cy + Math.sin((a * Math.PI) / 180) * seg.radius]);
      }
      h += seg.arc;
      x = pts[pts.length - 1][0];
      y = pts[pts.length - 1][1];
    }
  }
  return { pts, end: [x, y], heading: ((h % 360) + 360) % 360 };
}

// Solve the two free straights so the loop closes: b runs south, c runs east.
const open = walk(plan(0, 0));
const b = open.end[1];
const c = -open.end[0];
if (b <= 0 || c <= 0) throw new Error(`plan does not close with positive straights (b ${b.toFixed(1)}, c ${c.toFixed(1)})`);
const loop = walk(plan(b, c));
const closeErr = Math.hypot(loop.end[0], loop.end[1]);
const pts = loop.pts.slice(0, -1); // the last point is the first again
const length = pts.reduce((sum, p, i) => sum + Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]), 0);

// A made-up place: the coordinates only matter for the projection.
const lat0 = 51.5, lon0 = -1.2;
const phi = (lat0 * Math.PI) / 180;
const mLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
const coords = pts.map(([x, y]) => [Number((lon0 + x / mLon).toFixed(7)), Number((lat0 + y / mLat).toFixed(7))]);
coords.push(coords[0]);

const geojson = {
  type: 'FeatureCollection',
  name: 'poleline-rookie-ring',
  features: [
    {
      type: 'Feature',
      properties: { id: 'poleline-rookie-ring', Location: 'PoleLine', Name: 'Rookie Ring', opened: 2026, length: Math.round(length), altitude: 40 },
      geometry: { type: 'LineString', coordinates: coords },
    },
  ],
};
writeFileSync(join(import.meta.dirname, '..', 'data-src', 'poleline-rookie-ring.geojson'), JSON.stringify(geojson) + '\n');
console.log(`rookie ring: ${Math.round(length)} m, hairpin straight ${b.toFixed(0)} m, final straight ${c.toFixed(0)} m, closure error ${closeErr.toFixed(3)} m, heading ${loop.heading.toFixed(1)}`);
