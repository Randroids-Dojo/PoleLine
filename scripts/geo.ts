// Shared helpers for the offline track pipeline. Converts the GeoJSON circuit
// outlines (lon/lat) into a local metric frame and resamples them.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RawCircuit {
  id: string;
  name: string;
  location: string;
  officialLength: number;
  altitude: number;
  lonLat: [number, number][];
}

export function readCircuit(dir: string, id: string): RawCircuit {
  const json = JSON.parse(readFileSync(join(dir, `${id}.geojson`), 'utf8'));
  const feature = json.features[0];
  const props = feature.properties;
  const coords = feature.geometry.coordinates as [number, number][];
  return {
    id,
    name: props.Name,
    location: props.Location,
    officialLength: props.length,
    altitude: props.altitude,
    lonLat: coords,
  };
}

// Equirectangular projection around the outline's centre. Output is metres with
// +x east and +y south, so it maps directly onto canvas space with north up.
export function projectToMeters(lonLat: [number, number][]): [number, number][] {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of lonLat) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  const lon0 = (minLon + maxLon) / 2;
  const lat0 = (minLat + maxLat) / 2;
  const phi = (lat0 * Math.PI) / 180;
  const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
  const mPerDegLon = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
  return lonLat.map(([lon, lat]) => [(lon - lon0) * mPerDegLon, -(lat - lat0) * mPerDegLat]);
}

export function closeLoop(pts: [number, number][]): [number, number][] {
  const out = pts.slice();
  while (out.length > 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) out.pop();
    else break;
  }
  return out;
}

export function loopLength(pts: [number, number][]): number {
  let len = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

// Uniformly resample a closed polyline at `step` metres, starting at vertex 0.
export function resampleLoop(pts: [number, number][], step: number): [number, number][] {
  const total = loopLength(pts);
  const n = Math.max(8, Math.round(total / step));
  const ds = total / n;
  const out: [number, number][] = [];
  let seg = 0;
  let segStart = 0;
  let a = pts[0];
  let b = pts[1 % pts.length];
  let segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    while (s > segStart + segLen && seg < pts.length - 1) {
      segStart += segLen;
      seg++;
      a = pts[seg];
      b = pts[(seg + 1) % pts.length];
      segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const t = segLen > 0 ? (s - segStart) / segLen : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

// Circular moving-average smoothing, applied `passes` times (three passes of a
// box filter approximate a Gaussian).
export function smoothLoop(pts: [number, number][], radius: number, passes = 3): [number, number][] {
  let cur = pts;
  const n = pts.length;
  for (let p = 0; p < passes; p++) {
    const next: [number, number][] = new Array(n);
    for (let i = 0; i < n; i++) {
      let sx = 0, sy = 0;
      for (let k = -radius; k <= radius; k++) {
        const q = cur[(i + k + n) % n];
        sx += q[0];
        sy += q[1];
      }
      const c = 2 * radius + 1;
      next[i] = [sx / c, sy / c];
    }
    cur = next;
  }
  return cur;
}

// Signed area with +y south. Negative means clockwise on a north-up map.
export function signedAreaScreen(pts: [number, number][]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  // In screen space (+y down) a positive shoelace sum is clockwise visually.
  return -a / 2;
}

export function curvatureRadii(pts: [number, number][]): number[] {
  const n = pts.length;
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[i];
    const c = pts[(i + 1) % n];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const k = (2 * cross) / (ab * bc * ca || 1);
    out[i] = k === 0 ? Infinity : 1 / Math.abs(k);
  }
  return out;
}

// Centripetal Catmull-Rom through the source vertices of a closed loop. The
// GeoJSON outlines draw corners as short chords; a spline spreads each bend
// across the arc instead of concentrating it at the vertices.
export function catmullRomLoop(pts: [number, number][], step: number): [number, number][] {
  const n = pts.length;
  const out: [number, number][] = [];
  const knot = (a: [number, number], b: [number, number]) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m = Math.max(1, Math.ceil(segLen / step));
    for (let k = 0; k < m; k++) {
      const t = t1 + ((t2 - t1) * k) / m;
      const lerp = (a: [number, number], b: [number, number], ta: number, tb: number): [number, number] => {
        const u = (t - ta) / (tb - ta);
        return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
      };
      const a1 = lerp(p0, p1, t0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2), b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}
