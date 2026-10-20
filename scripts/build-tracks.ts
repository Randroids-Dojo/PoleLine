// Builds src/data/catalog.ts and src/data/geometry/<slug>.ts from the GeoJSON
// sources in data-src/ plus the hand-curated table in track-config.ts.
//
//   npm run tracks:build
//
// The work is in scripts/build-lib.ts, which the Toybox edition shares.

import { join } from 'node:path';
import { buildTracks } from './build-lib.js';
import { TRACKS } from './track-config.js';

const ROOT = join(import.meta.dirname, '..');
buildTracks({
  tracks: TRACKS,
  srcDir: join(ROOT, 'data-src'),
  geomDir: join(ROOT, 'src', 'data', 'geometry'),
  catalogPath: join(ROOT, 'src', 'data', 'catalog.ts'),
  loadersPath: join(ROOT, 'src', 'data', 'geometry-loaders.ts'),
  allPath: join(ROOT, 'src', 'data', 'geometry-all.ts'),
  calibrationPath: join(ROOT, 'scripts', 'calibration.json'),
  credit: 'Circuit outlines derived from bacinger/f1-circuits (MIT).',
  minRadius: { monaco: 8 },
});
