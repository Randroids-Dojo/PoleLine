// Plans for made-up circuits: a closed polygon of corner points, each rounded
// off with a circular arc of its own radius, so the loop always closes and a
// layout reads as a list of corners. Trigonometry lives here, in the authoring
// step, never on the timing path.

/** A corner: where it is (metres, x east, y north) and the radius of its arc. */
export type Corner = [x: number, y: number, radius: number];

export interface Layout {
  pts: [number, number][];
  length: number;
  /** Shortest distance between two points of the centreline more than 90 m apart along the lap. */
  minSeparation: number;
  minRadius: number;
  turns: number;
  size: [number, number];
  problems: string[];
}

const STEP = 2;

/**
 * Walks the rounded polygon. The lap starts in the middle of the straight from
 * the first corner to the second, heading along it.
 */
export function layout(corners: Corner[], scale = 1): Layout {
  const problems: string[] = [];
  const n = corners.length;
  const c = corners.map(([x, y, r]) => [x * scale, y * scale, r * scale] as Corner);
  // Per corner: incoming/outgoing unit directions, turning angle and tangent length.
  const tan: number[] = new Array(n);
  const turn: number[] = new Array(n);
  let minRadius = Infinity;
  for (let i = 0; i < n; i++) {
    const p = c[(i - 1 + n) % n], q = c[i], s = c[(i + 1) % n];
    const a1 = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const a2 = Math.atan2(s[1] - q[1], s[0] - q[0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turn[i] = d;
    tan[i] = q[2] * Math.tan(Math.abs(d) / 2);
    if (Math.abs(d) > (170 * Math.PI) / 180) problems.push(`corner ${i} turns ${((Math.abs(d) * 180) / Math.PI).toFixed(0)} degrees; split a hairpin into two corners`);
    if (q[2] < minRadius) minRadius = q[2];
  }
  const straights: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const q = c[i], s = c[(i + 1) % n];
    const edge = Math.hypot(s[0] - q[0], s[1] - q[1]);
    straights[i] = edge - tan[i] - tan[(i + 1) % n];
    if (straights[i] < 4) problems.push(`corners ${i} and ${(i + 1) % n} overlap: edge ${edge.toFixed(0)} m, arcs need ${(tan[i] + tan[(i + 1) % n]).toFixed(0)} m`);
  }
  const pts: [number, number][] = [];
  const emitLine = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    const k = Math.max(1, Math.round(len / STEP));
    for (let i = 0; i < k; i++) pts.push([ax + ((bx - ax) * i) / k, ay + ((by - ay) * i) / k]);
  };
  const emitArc = (i: number) => {
    const p = c[(i - 1 + n) % n], q = c[i];
    const heading = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const sign = Math.sign(turn[i]);
    const r = q[2];
    // Arc starts tan[i] before the corner point along the incoming edge.
    const sx = q[0] - Math.cos(heading) * tan[i], sy = q[1] - Math.sin(heading) * tan[i];
    const cx = sx + Math.cos(heading + (sign * Math.PI) / 2) * r, cy = sy + Math.sin(heading + (sign * Math.PI) / 2) * r;
    const a0 = heading - (sign * Math.PI) / 2;
    const len = Math.abs(turn[i]) * r;
    const k = Math.max(2, Math.round(len / STEP));
    for (let j = 0; j < k; j++) {
      const a = a0 + (turn[i] * j) / k;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  // Start at the middle of the first straight (between corner 0 and corner 1).
  const h0 = Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]);
  const startX = c[0][0] + Math.cos(h0) * (tan[0] + straights[0] / 2);
  const startY = c[0][1] + Math.sin(h0) * (tan[0] + straights[0] / 2);
  const end0X = c[1][0] - Math.cos(h0) * tan[1], end0Y = c[1][1] - Math.sin(h0) * tan[1];
  emitLine(startX, startY, end0X, end0Y);
  for (let k = 1; k <= n; k++) {
    const i = k % n;
    emitArc(i);
    const q = c[i], s = c[(i + 1) % n];
    const h = Math.atan2(s[1] - q[1], s[0] - q[0]);
    const ax = q[0] + Math.cos(h) * tan[i], ay = q[1] + Math.sin(h) * tan[i];
    if (i === 0) emitLine(ax, ay, startX, startY);
    else emitLine(ax, ay, s[0] - Math.cos(h) * tan[(i + 1) % n], s[1] - Math.sin(h) * tan[(i + 1) % n]);
  }
  // Remove the odd duplicate where a zero-length piece met an arc.
  const clean: [number, number][] = [];
  for (const p of pts) {
    const l = clean[clean.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.3) clean.push(p);
  }
  if (Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) < 0.3) clean.pop();
  const length = clean.reduce((sum, p, i) => sum + Math.hypot(clean[(i + 1) % clean.length][0] - p[0], clean[(i + 1) % clean.length][1] - p[1]), 0);

  // Separation between distant parts of the lap (parallel sections need room for two roads and their run-off).
  let minSep = Infinity;
  const m = clean.length;
  const gap = Math.round(90 / STEP);
  for (let i = 0; i < m; i++) {
    for (let j = i + gap; j < m; j++) {
      if (j - i > m - gap) break;
      const d = Math.hypot(clean[i][0] - clean[j][0], clean[i][1] - clean[j][1]);
      if (d < minSep) minSep = d;
    }
  }
  let turns = 0;
  for (let i = 0; i < n; i++) {
    const deg = (Math.abs(turn[i]) * 180) / Math.PI;
    if (deg < 12) continue;
    // Two tight corners making one hairpin count once.
    const prev = (i - 1 + n) % n;
    if (straights[prev] < 60 && Math.sign(turn[prev]) === Math.sign(turn[i]) && (Math.abs(turn[prev]) * 180) / Math.PI >= 12) continue;
    turns++;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of clean) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  if (minSep < 46) problems.push(`sections pass within ${minSep.toFixed(0)} m of each other (need 46 m)`);
  if (minRadius < 11) problems.push(`a corner is tighter than 11 m (${minRadius} m)`);
  return { pts: clean, length, minSeparation: minSep, minRadius, turns, size: [maxX - minX, maxY - minY], problems };
}

/** The loop as GeoJSON like the real circuits, so it goes through the same build. */
export function toGeoJson(id: string, name: string, location: string, pts: [number, number][], length: number, altitude: number): string {
  // A made-up place: the coordinates only matter for the projection.
  const lat0 = 51.5, lon0 = -1.2;
  const phi = (lat0 * Math.PI) / 180;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  const coords = pts.map(([x, y]) => [Number((lon0 + x / mLon).toFixed(7)), Number((lat0 + y / mLat).toFixed(7))]);
  coords.push(coords[0]);
  return (
    JSON.stringify({
      type: 'FeatureCollection',
      name: id,
      features: [
        {
          type: 'Feature',
          properties: { id, Location: location, Name: name, opened: 2026, length: Math.round(length), altitude },
          geometry: { type: 'LineString', coordinates: coords },
        },
      ],
    }) + '\n'
  );
}
