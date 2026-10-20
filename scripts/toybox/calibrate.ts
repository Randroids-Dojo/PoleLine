// Sets each made-up circuit's pole pace from its surface grip: a minimum
// curvature line on softs is simulated at the grip in circuits.ts, and pole
// is the time it beats by the same margin the real circuits use. Also records
// the ideal lap's sector split and clipping speed. The tutorial circuit keeps
// the web edition's calibration so both editions time it identically.
// Writes scripts/toybox/calibration.json; run `npm run toybox:tracks` afterwards.
//
//   npx tsx scripts/toybox/calibrate.ts [--report]

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG } from '../../src/data/toybox/catalog.js';
import { decodePath, encodePath, validatePath } from '../../src/sim/path.js';
import { simulateLap } from '../../src/sim/lapsim.js';
import { buildTrack } from '../../src/sim/track.js';
import { minCurvatureOffsets, offsetsToLine, wobble } from '../optimal.js';
import type { Calibration } from '../build-lib.js';
import { CIRCUITS } from './circuits.js';

const OUT = join(import.meta.dirname, 'calibration.json');
const WEB = join(import.meta.dirname, '..', 'calibration.json');
/** The ideal line beats pole by this much, as on the real circuits. */
const IDEAL_MARGIN = 0.985;
const reportOnly = process.argv.includes('--report');

const web: Record<string, Calibration> = JSON.parse(readFileSync(WEB, 'utf8'));
const result: Record<string, Calibration> = {};
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}`;

for (const meta of CATALOG) {
  if (meta.tutorial) {
    result[meta.slug] = web[meta.slug];
    continue;
  }
  const cfg = CIRCUITS.find((c) => c.slug === meta.slug)!;
  const geom = (await import(`../../src/data/toybox/geometry/${meta.slug}.ts`)).default as number[];
  const track = buildTrack(meta, geom);
  const alpha = minCurvatureOffsets(track);
  const line = decodePath(encodePath(offsetsToLine(track, alpha)));
  const valid = validatePath(track, line);
  if (!valid.ok) throw new Error(`${meta.slug}: ideal line invalid (${valid.error} at ${valid.at})`);
  const grip = cfg.grip;
  const soft = simulateLap(track, line, 'soft', { surfaceGrip: grip });
  const med = simulateLap(track, line, 'medium', { surfaceGrip: grip });
  const hard = simulateLap(track, line, 'hard', { surfaceGrip: grip });
  const poleRef = Number((soft.timeMs / 1000 / IDEAL_MARGIN).toFixed(3));
  const sectors = soft.sectorsMs.map((x) => Number((x / soft.timeMs).toFixed(5))) as [number, number, number];
  const clipRef = Number.isFinite(soft.stats.clipSpeed) ? Number(soft.stats.clipSpeed.toFixed(2)) : undefined;
  result[meta.slug] = { grip, sectors, clipRef, poleRef };
  const noisy = [1, 2, 3].map((seed) => {
    const a = wobble(track, alpha, seed, 0.6, 60, 0.12);
    const p = decodePath(encodePath(offsetsToLine(track, a)));
    const ok = validatePath(track, p);
    return ok.ok ? simulateLap(track, p, 'soft', { surfaceGrip: grip }).timeMs : NaN;
  });
  const pct = (t: number) => (((t / soft.timeMs) - 1) * 100).toFixed(2).padStart(5);
  console.log(
    `${meta.slug.padEnd(16)} grip ${grip.toFixed(2)} pole ${fmt(poleRef * 1000)} | S ${fmt(soft.timeMs)} M +${pct(med.timeMs)}% H +${pct(hard.timeMs)}% | ` +
      `wobbly +${noisy.map(pct).join('/')}% | top ${(soft.stats.topSpeed * 3.6).toFixed(0)} min ${(soft.stats.minSpeed * 3.6).toFixed(0)} ` +
      `tyre S ${soft.stats.tyreMin.toFixed(0)}-${soft.stats.tyreMax.toFixed(0)} M ${med.stats.tyreMin.toFixed(0)}-${med.stats.tyreMax.toFixed(0)} H ${hard.stats.tyreMin.toFixed(0)}-${hard.stats.tyreMax.toFixed(0)} | ` +
      `ERS left ${(soft.stats.energyLeft / 1e6).toFixed(1)} MJ` +
      (clipRef ? ` clip ${(clipRef * 3.6).toFixed(0)} km/h` : ' no clip'),
  );
}
if (!reportOnly) {
  writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
}
