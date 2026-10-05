// Calibrates each circuit's surface grip so that a minimum-curvature line on
// soft tyres (mediums on the tutorial circuit, which is set up for them) lands
// just under real-world pole pace, then reports how compounds
// and imperfect lines compare. Writes scripts/calibration.json; re-run
// `npm run tracks:build` afterwards to bake the values into the catalog.
//
//   npx tsx scripts/calibrate.ts [--report] [slug...]

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOG } from '../src/data/catalog.js';
import { decodePath, encodePath, validatePath } from '../src/sim/path.js';
import { simulateLap } from '../src/sim/lapsim.js';
import { buildTrack } from '../src/sim/track.js';
import { minCurvatureOffsets, offsetsToLine, wobble } from './optimal.js';

const OUT = join(import.meta.dirname, 'calibration.json');
/** The ideal line should be this much quicker than real pole. */
const IDEAL_MARGIN = 0.985;

const args = process.argv.slice(2);
const reportOnly = args.includes('--report');
const only = args.filter((a) => !a.startsWith('--'));
interface Cal { grip: number; sectors: [number, number, number]; clipRef?: number }
const existing: Record<string, Cal> = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const result: Record<string, Cal> = { ...existing };

const fmt = (ms: number) => {
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
};

for (const meta of CATALOG) {
  if (only.length && !only.includes(meta.slug)) continue;
  const geom = (await import(`../src/data/geometry/${meta.slug}.ts`)).default as number[];
  const track = buildTrack(meta, geom);
  const alpha = minCurvatureOffsets(track);
  const line = decodePath(encodePath(offsetsToLine(track, alpha)));
  const valid = validatePath(track, line);
  if (!valid.ok) {
    console.log(`${meta.slug}: ideal line invalid (${valid.error} at ${valid.at})`);
    continue;
  }
  const target = meta.poleRef * 1000 * IDEAL_MARGIN;
  const ref = meta.tutorial ? 'medium' : 'soft';
  let grip = reportOnly ? meta.grip : existing[meta.slug]?.grip ?? 1;
  if (!reportOnly) {
    // Secant iterations on surface grip.
    let g0 = grip, t0 = simulateLap(track, line, ref, { surfaceGrip: g0 }).timeMs;
    let g1 = grip * (t0 > target ? 1.03 : 0.97);
    let t1 = simulateLap(track, line, ref, { surfaceGrip: g1 }).timeMs;
    for (let it = 0; it < 12 && Math.abs(t1 - target) > 2; it++) {
      const g2 = g1 + ((target - t1) * (g1 - g0)) / (t1 - t0 || 1);
      g0 = g1; t0 = t1;
      g1 = g2;
      t1 = simulateLap(track, line, ref, { surfaceGrip: g1 }).timeMs;
    }
    grip = Number(g1.toFixed(5));
  }
  const soft = simulateLap(track, line, 'soft', { surfaceGrip: grip });
  const best = ref === 'soft' ? soft : simulateLap(track, line, ref, { surfaceGrip: grip });
  if (!reportOnly) {
    const f = best.sectorsMs.map((x) => Number((x / best.timeMs).toFixed(5))) as [number, number, number];
    const clip = Number.isFinite(best.stats.clipSpeed) ? Number(best.stats.clipSpeed.toFixed(2)) : undefined;
    result[meta.slug] = { grip, sectors: f, clipRef: clip };
  }
  const med = simulateLap(track, line, 'medium', { surfaceGrip: grip });
  const hard = simulateLap(track, line, 'hard', { surfaceGrip: grip });
  const noisy = [1, 2, 3].map((seed) => {
    const a = wobble(track, alpha, seed, 0.6, 60, 0.12);
    const p = decodePath(encodePath(offsetsToLine(track, a)));
    const ok = validatePath(track, p);
    return ok.ok ? simulateLap(track, p, 'soft', { surfaceGrip: grip }).timeMs : NaN;
  });
  const center = decodePath(encodePath(offsetsToLine(track, new Float64Array(track.n))));
  const ctr = simulateLap(track, center, 'soft', { surfaceGrip: grip }).timeMs;
  const pct = (t: number) => (((t / soft.timeMs) - 1) * 100).toFixed(2).padStart(5);
  console.log(
    `${meta.slug.padEnd(12)} grip ${grip.toFixed(3)} | S ${fmt(soft.timeMs)} M +${pct(med.timeMs)}% H +${pct(hard.timeMs)}% | ` +
      `wobbly +${noisy.map(pct).join('/')}% centre +${pct(ctr)}% | top ${(soft.stats.topSpeed * 3.6).toFixed(0)} ` +
      `min ${(soft.stats.minSpeed * 3.6).toFixed(0)} latG ${soft.stats.maxLatG.toFixed(1)} brkG ${soft.stats.maxBrakeG.toFixed(1)} ` +
      `tyre S ${soft.stats.tyreMin.toFixed(0)}-${soft.stats.tyreMax.toFixed(0)} M ${med.stats.tyreMin.toFixed(0)}-${med.stats.tyreMax.toFixed(0)} H ${hard.stats.tyreMin.toFixed(0)}-${hard.stats.tyreMax.toFixed(0)} | ` +
      `ERS used ${(soft.stats.energyUsed / 1e6).toFixed(1)} rec ${(soft.stats.energyRecovered / 1e6).toFixed(1)} left ${(soft.stats.energyLeft / 1e6).toFixed(1)} MJ` +
      (Number.isFinite(soft.stats.clipSpeed) ? ` clip ${(soft.stats.clipSpeed * 3.6).toFixed(0)} km/h` : ' no clip'),
  );
}

if (!reportOnly) {
  writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
  console.log(`wrote ${OUT}`);
}
