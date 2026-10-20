// Solves every Toybox circuit plan, checks it, writes data-src/toybox/<slug>.geojson
// and renders a contact sheet for review.
//
//   npx tsx scripts/toybox/make-circuits.ts [--sheet /tmp/toybox-circuits.png]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CIRCUITS } from './circuits.js';
import { layout, toGeoJson } from './plan.js';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'data-src', 'toybox');
mkdirSync(OUT, { recursive: true });
const sheetIdx = process.argv.indexOf('--sheet');
const sheet = sheetIdx > 0 ? process.argv[sheetIdx + 1] : '';

let failed = 0;
const cards: string[] = [];
for (const c of CIRCUITS) {
  const r = layout(c.corners, c.scale ?? 1);
  const ok = r.problems.length === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${c.slug.padEnd(16)} ${(r.length / 1000).toFixed(3)} km  ` +
      `sep ${r.minSeparation.toFixed(0).padStart(4)}  minR ${r.minRadius}  turns ${String(r.turns).padStart(2)}  box ${r.size.map((v) => v.toFixed(0)).join('x')}` +
      (ok ? '' : `\n     ${r.problems.join('; ')}`),
  );
  if (ok) writeFileSync(join(OUT, `${c.slug}.geojson`), toGeoJson(c.slug, c.name, c.region, r.pts, r.length, c.altitude));
  if (sheet) {
    const w = 300, h = 300, pad = 24;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of r.pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const s = Math.min((w - pad * 2) / (maxX - minX), (h - pad * 2) / (maxY - minY));
    const ox = (w - (maxX - minX) * s) / 2, oy = (h - (maxY - minY) * s) / 2;
    const d = r.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * s).toFixed(1)} ${(h - oy - (y - minY) * s).toFixed(1)}`).join('') + 'Z';
    const sx = ox + (r.pts[0][0] - minX) * s, sy = h - oy - (r.pts[0][1] - minY) * s;
    cards.push(
      `<g><rect width="${w}" height="${h + 44}" fill="${ok ? '#fff' : '#ffe8e8'}" stroke="#d3d9e0"/>` +
        `<path d="${d}" fill="none" stroke="#2c2f35" stroke-width="${Math.max(2, c.width * s)}" stroke-linejoin="round"/>` +
        `<path d="${d}" fill="none" stroke="#9b30ff" stroke-width="1.2"/>` +
        `<circle cx="${sx}" cy="${sy}" r="4" fill="#fff" stroke="#000" stroke-width="1.5"/>` +
        `<text x="12" y="${h + 18}" font-family="Helvetica" font-size="13" font-weight="700">${c.short}</text>` +
        `<text x="12" y="${h + 35}" font-family="Helvetica" font-size="11" fill="#4b535d">${(r.length / 1000).toFixed(2)} km, ${r.turns} turns, ${c.width} m, sep ${r.minSeparation.toFixed(0)} m</text></g>`,
    );
  }
}
if (sheet) {
  const cols = 5, w = 300, h = 344, gap = 12;
  const rows = Math.ceil(cards.length / cols);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * (w + gap) + gap}" height="${rows * (h + gap) + gap}" style="background:#eef1f4">` +
    cards.map((c, i) => `<g transform="translate(${gap + (i % cols) * (w + gap)},${gap + Math.floor(i / cols) * (h + gap)})">${c}</g>`).join('') +
    '</svg>';
  const svgPath = sheet.replace(/\.png$/, '.svg');
  writeFileSync(svgPath, svg);
  const { chromium } = await import('playwright-core');
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setViewportSize({ width: cols * (w + gap) + gap, height: rows * (h + gap) + gap });
  await p.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await p.screenshot({ path: sheet });
  await b.close();
  console.log(`sheet ${sheet}`);
}
console.log(failed ? `${failed} circuit(s) need work` : `all ${CIRCUITS.length} circuits close and clear`);
if (failed) process.exitCode = 1;
