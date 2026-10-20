// Builds src/data/toybox/catalog.ts, geometry-loaders.ts and geometry/<slug>.ts
// from the made-up circuits in circuits.ts (via data-src/toybox/*.geojson,
// written by make-circuits.ts) plus the tutorial circuit, which both editions share.
//
//   npm run toybox:tracks

import { join } from 'node:path';
import { buildTracks } from '../build-lib.js';
import { TRACKS } from '../track-config.js';
import { CIRCUITS } from './circuits.js';
import { layout } from './plan.js';

const ROOT = join(import.meta.dirname, '..', '..');
const tutorial = TRACKS.find((t) => t.tutorial)!;
buildTracks({
  tracks: [
    { ...tutorial, source: join('..', tutorial.source) },
    ...CIRCUITS.map((c) => ({
      slug: c.slug,
      source: c.slug,
      name: c.name,
      short: c.short,
      country: c.region,
      flag: c.glyph,
      width: c.width,
      poleRef: 0, // derived from the circuit's grip by scripts/toybox/calibrate.ts
      turns: layout(c.corners, c.scale ?? 1).turns,
      airTemp: c.airTemp,
      trackTemp: c.trackTemp,
      windSpeed: c.windSpeed,
      windFrom: c.windFrom,
      night: c.night,
      downforce: c.downforce,
      street: c.street,
    })),
  ],
  srcDir: join(ROOT, 'data-src', 'toybox'),
  geomDir: join(ROOT, 'src', 'data', 'toybox', 'geometry'),
  catalogPath: join(ROOT, 'src', 'data', 'toybox', 'catalog.ts'),
  loadersPath: join(ROOT, 'src', 'data', 'toybox', 'geometry-loaders.ts'),
  calibrationPath: join(ROOT, 'scripts', 'toybox', 'calibration.json'),
  credit: 'Toybox edition: made-up circuits from scripts/toybox/circuits.ts. No real place.',
});
