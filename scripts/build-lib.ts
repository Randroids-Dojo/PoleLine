// The track build, shared by the web edition (scripts/build-tracks.ts, real
// circuits from data-src/) and the Toybox edition (scripts/toybox/build-tracks.ts,
// made-up circuits). The centreline is projected to metres, rounded off where
// the source polyline has corners tighter than a real circuit allows,
// resampled every 2 m, and stored as decimetre integer deltas so every client
// decodes identical floating point geometry.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { catmullRomLoop, closeLoop, curvatureRadii, loopLength, projectToMeters, readCircuit, resampleLoop, smoothLoop } from './geo.js';
import type { TrackConfig } from './track-config.js';

const STEP = 2; // stored centreline spacing in metres
const FINE = 0.5;
const MIN_RADIUS_DEFAULT = 12;

type Pt = [number, number];

export interface Calibration {
  grip: number;
  sectors: [number, number, number];
  clipRef?: number;
  /** Reference pole time (s) for circuits whose config leaves it to the calibration. */
  poleRef?: number;
}

export interface BuildOptions {
  tracks: TrackConfig[];
  /** Directory holding <source>.geojson files. */
  srcDir: string;
  /** Where src/data/geometry/<slug>.ts files go. */
  geomDir: string;
  catalogPath: string;
  loadersPath: string;
  /** Static map of every circuit for the server; omitted for editions without one. */
  allPath?: string;
  calibrationPath: string;
  /** Second header line of the catalog file (the data credit). */
  credit: string;
  /** Minimum corner radius per slug, where the default is too strict. */
  minRadius?: Record<string, number>;
}

function rotateToOffset(pts: Pt[], offset: number): Pt[] {
  const n = pts.length;
  const total = loopLength(pts);
  const k = Math.round(((offset % total) / total) * n) % n;
  return pts.slice(k).concat(pts.slice(0, k));
}

// Local Laplacian relaxation wherever the radius (measured across +-2 m) is
// below the minimum. Pulls overly sharp source vertices into a plausible arc.
function relaxTightCorners(pts: Pt[], minRadius: number): { pts: Pt[]; iterations: number } {
  let cur = pts.map((p) => [p[0], p[1]] as Pt);
  const n = cur.length;
  const span = Math.round(2 / FINE);
  let it = 0;
  for (; it < 1500; it++) {
    const radii = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const a = cur[(i - span + n) % n], b = cur[i], c = cur[(i + span) % n];
      const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const k = Math.abs((2 * cross) / (ab * bc * ca || 1));
      radii[i] = k === 0 ? Infinity : 1 / k;
    }
    const bad: number[] = [];
    for (let i = 0; i < n; i++) if (radii[i] < minRadius) bad.push(i);
    if (!bad.length) break;
    const mark = new Uint8Array(n);
    const W = 10;
    for (const i of bad) for (let k = -W; k <= W; k++) mark[(i + k + n) % n] = 1;
    const next = cur.map((p) => [p[0], p[1]] as Pt);
    for (let i = 0; i < n; i++) {
      if (!mark[i]) continue;
      const a = cur[(i - 1 + n) % n], c = cur[(i + 1) % n];
      next[i] = [cur[i][0] * 0.5 + (a[0] + c[0]) * 0.25, cur[i][1] * 0.5 + (a[1] + c[1]) * 0.25];
    }
    cur = next;
  }
  return { pts: cur, iterations: it };
}

function airDensity(altitude: number, airTempC: number): number {
  const p = 101325 * Math.pow(1 - 2.25577e-5 * altitude, 5.25588);
  return p / (287.05 * (airTempC + 273.15));
}

function straightZones(pts: Pt[], step: number, maxCurv = 1 / 300, minLen = 320): [number, number][] {
  // Curvature measured over +-6 m.
  const n = pts.length;
  const straight = new Uint8Array(n);
  const span = 3;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - span + n) % n], b = pts[i], c = pts[(i + span) % n];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const k = Math.abs((2 * cross) / (ab * bc * ca || 1));
    straight[i] = k < maxCurv ? 1 : 0;
  }
  // Find runs (with wrap) of straight samples longer than 320 m. Straight mode
  // opens 50 m into a straight and the zone ends 30 m before the next corner
  // (the simulation also closes the wings whenever the car brakes).
  const zones: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < n; i++) if (!straight[i]) { start = i; break; }
  if (start < 0) return zones;
  let runStart = -1;
  for (let j = 1; j <= n; j++) {
    const i = (start + j) % n;
    if (straight[i] && runStart < 0) runStart = j;
    if ((!straight[i] || j === n) && runStart >= 0) {
      const len = (j - runStart) * step;
      if (len > minLen) {
        const s0 = ((start + runStart) * step + 50) % (n * step);
        const s1 = ((start + j) * step - 30) % (n * step);
        zones.push([Math.round(s0), Math.round(s1)]);
      }
      runStart = -1;
    }
  }
  // Twisty street circuits (Monaco) still get their straightest run.
  if (!zones.length && minLen > 200) return straightZones(pts, step, 1 / 150, 200);
  // Keep up to six of the longest straights, ordered along the lap.
  const lenOf = (z: [number, number]) => (z[1] - z[0] + n * step) % (n * step);
  return zones
    .sort((a, b) => lenOf(b) - lenOf(a))
    .slice(0, 6)
    .sort((a, b) => a[0] - b[0]);
}

export function buildTracks(o: BuildOptions): void {
  mkdirSync(o.geomDir, { recursive: true });
  const calibration: Record<string, Calibration> = existsSync(o.calibrationPath) ? JSON.parse(readFileSync(o.calibrationPath, 'utf8')) : {};
  const catalog: unknown[] = [];
  for (const cfg of o.tracks) {
    const raw = readCircuit(o.srcDir, cfg.source);
    let pts = closeLoop(projectToMeters(raw.lonLat)) as Pt[];
    if (cfg.reverse) pts = [pts[0], ...pts.slice(1).reverse()];
    let fine = resampleLoop(catmullRomLoop(pts, 0.25) as Pt[], FINE) as Pt[];
    if (cfg.startOffset) fine = rotateToOffset(fine, cfg.startOffset);
    fine = smoothLoop(fine, 12, 3) as Pt[];
    const relaxed = relaxTightCorners(fine, o.minRadius?.[cfg.slug] ?? MIN_RADIUS_DEFAULT);
    fine = smoothLoop(relaxed.pts, 2, 2) as Pt[];
    const center = resampleLoop(fine, STEP) as Pt[];
    const length = loopLength(center);

    // Recentre on the bounding box so coordinates stay small.
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of center) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const ints = center.map(([x, y]) => [Math.round((x - cx) * 10), Math.round((y - cy) * 10)]);
    const deltas: number[] = [ints[0][0], ints[0][1]];
    for (let i = 1; i < ints.length; i++) deltas.push(ints[i][0] - ints[i - 1][0], ints[i][1] - ints[i - 1][1]);
    writeFileSync(
      join(o.geomDir, `${cfg.slug}.ts`),
      `// Generated by scripts/build-tracks.ts from data-src/${cfg.source}.geojson. Do not edit.\n` +
        `// Centreline every ~${STEP} m as decimetre deltas: [x0, y0, dx1, dy1, ...].\n` +
        `export default [${deltas.join(',')}];\n`,
    );

    const radii = curvatureRadii(center);
    const minR = Math.min(...radii);

    // Thumbnail outline: ~180 points normalised into a 1000 unit box.
    const scale = 1000 / Math.max(maxX - minX, maxY - minY);
    const outline: number[] = [];
    const stride = Math.max(1, Math.floor(center.length / 180));
    for (let i = 0; i < center.length; i += stride) {
      outline.push(Math.round((center[i][0] - minX) * scale), Math.round((center[i][1] - minY) * scale));
    }

    const theta = (cfg.windFrom * Math.PI) / 180;
    const rho = airDensity(raw.altitude, cfg.airTemp);
    const cal = calibration[cfg.slug];
    const entry = {
      slug: cfg.slug,
      name: cfg.name,
      short: cfg.short,
      country: cfg.country,
      flag: cfg.flag,
      street: cfg.street,
      night: cfg.night,
      width: cfg.width,
      turns: cfg.turns,
      length: Math.round(length),
      officialLength: raw.officialLength,
      altitude: raw.altitude,
      poleRef: cfg.poleRef || cal?.poleRef || 0,
      airTemp: cfg.airTemp,
      trackTemp: cfg.trackTemp,
      windSpeed: cfg.windSpeed,
      windFrom: cfg.windFrom,
      wind: [Number((-Math.sin(theta) * cfg.windSpeed).toFixed(4)), Number((Math.cos(theta) * cfg.windSpeed).toFixed(4))],
      rho: Number(rho.toFixed(5)),
      downforce: cfg.downforce,
      grip: cal?.grip ?? 1,
      poleSectors: cal?.sectors ?? [0.3333, 0.3333, 0.3334],
      clipRef: cal?.clipRef ?? 0,
      straights: straightZones(center, length / center.length),
      size: [Math.round(maxX - minX), Math.round(maxY - minY)],
      outline,
      ...(cfg.tutorial ? { tutorial: true } : {}),
    };
    catalog.push(entry);
    console.log(
      `${cfg.slug.padEnd(12)} len ${length.toFixed(0).padStart(5)} (official ${raw.officialLength}) ` +
        `minR ${minR.toFixed(1).padStart(5)} relax ${String(relaxed.iterations).padStart(4)} ` +
        `rho ${rho.toFixed(3)} straights ${entry.straights.length} pts ${center.length}`,
    );
  }

  const header =
    '// Generated by scripts/build-tracks.ts. Do not edit by hand.\n' +
    `// ${o.credit}\n` +
    "import type { TrackMeta } from '../sim/types.js';\n\n";
  writeFileSync(o.catalogPath, header.replace("'../sim/types.js'", `'${relativeToSim(o.catalogPath)}'`) + `export const CATALOG: TrackMeta[] = ${JSON.stringify(catalog, null, 0).replace(/},{/g, '},\n  {')};\n`);

  const loaders =
    '// Generated by scripts/build-tracks.ts. Do not edit by hand.\n' +
    'export const GEOMETRY_LOADERS: Record<string, () => Promise<{ default: number[] }>> = {\n' +
    o.tracks.map((t) => `  '${t.slug}': () => import('./geometry/${t.slug}'),`).join('\n') +
    '\n};\n';
  writeFileSync(o.loadersPath, loaders);

  if (o.allPath) {
    // Static map for the server, which needs every circuit to re-simulate laps.
    const ident = (slug: string) => 'g_' + slug.replace(/-/g, '_');
    const all =
      '// Generated by scripts/build-tracks.ts. Do not edit by hand. Server use only.\n' +
      o.tracks.map((t) => `import ${ident(t.slug)} from './geometry/${t.slug}.js';`).join('\n') +
      '\n\nexport const GEOMETRY: Record<string, number[]> = {\n' +
      o.tracks.map((t) => `  '${t.slug}': ${ident(t.slug)},`).join('\n') +
      '\n};\n';
    writeFileSync(o.allPath, all);
  }
  console.log(`wrote ${o.tracks.length} tracks`);
}

/** Import path from the catalog file to src/sim/types.js. */
function relativeToSim(catalogPath: string): string {
  const depth = catalogPath.split('/src/data/')[1].split('/').length - 1;
  return `${'../'.repeat(depth + 1)}sim/types.js`;
}
