// Renders every source circuit to a PNG contact sheet so start/finish position
// and racing direction can be checked by eye. Usage:
//   npx tsx scripts/inspect-tracks.ts [outDir] [ids...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { closeLoop, loopLength, projectToMeters, readCircuit, resampleLoop, signedAreaScreen } from './geo.js';

const SRC = join(import.meta.dirname, '..', 'data-src');
const outDir = process.argv[2] ?? '/tmp/poleline-inspect';
const ids = process.argv.slice(3);
const ALL = [
  'bh-2002', 'sa-2021', 'au-1953', 'jp-1962', 'cn-2004', 'us-2022', 'it-1953', 'mc-1929',
  'ca-1978', 'es-1991', 'at-1969', 'gb-1948', 'hu-1986', 'be-1925', 'nl-1948', 'it-1922',
  'az-2016', 'sg-2008', 'us-2012', 'mx-1962', 'br-1940', 'us-2023', 'qa-2004', 'ae-2009',
];

mkdirSync(outDir, { recursive: true });

function svgFor(id: string): string {
  const c = readCircuit(SRC, id);
  const pts = closeLoop(projectToMeters(c.lonLat));
  const len = loopLength(pts);
  const dense = resampleLoop(pts, 5);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = 120;
  const w = maxX - minX + pad * 2;
  const h = maxY - minY + pad * 2;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0] - minX + pad).toFixed(1)},${(p[1] - minY + pad).toFixed(1)}`).join(' ') + 'Z';
  const marks: string[] = [];
  const step = Math.round(len / 5 / dense.length) || 1;
  void step;
  const every = 250;
  for (let s = 0; s < len; s += every) {
    const i = Math.min(dense.length - 1, Math.round((s / len) * dense.length));
    const p = dense[i];
    const q = dense[(i + 2) % dense.length];
    const x = p[0] - minX + pad, y = p[1] - minY + pad;
    const ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI;
    marks.push(`<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${ang.toFixed(1)})"><path d="M-14,-10 L10,0 L-14,10" fill="none" stroke="#e33" stroke-width="5"/></g>`);
    marks.push(`<text x="${(x + 14).toFixed(1)}" y="${(y - 14).toFixed(1)}" font-size="34" fill="#036">${s}</text>`);
  }
  const v = pts.map((p) => `<circle cx="${(p[0] - minX + pad).toFixed(1)}" cy="${(p[1] - minY + pad).toFixed(1)}" r="4" fill="#888"/>`).join('');
  const s0 = pts[0];
  const area = signedAreaScreen(pts);
  return `<div style="display:inline-block;margin:6px;border:1px solid #ccc;vertical-align:top">
  <div style="font:16px sans-serif;padding:4px">${id} ${c.name} | ${len.toFixed(0)}m (official ${c.officialLength}) | ${area < 0 ? 'CW' : 'CCW'} | verts ${pts.length}</div>
  <svg width="640" height="${((640 * h) / w).toFixed(0)}" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}" style="background:#f7f7f2">
  <path d="${d}" fill="none" stroke="#222" stroke-width="12" stroke-linejoin="round"/>
  ${v}${marks.join('')}
  <circle cx="${(s0[0] - minX + pad).toFixed(1)}" cy="${(s0[1] - minY + pad).toFixed(1)}" r="26" fill="none" stroke="#0a0" stroke-width="8"/>
  </svg></div>`;
}

const list = ids.length ? ids : ALL;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1340, height: 800 } });
for (let i = 0; i < list.length; i += 2) {
  const chunk = list.slice(i, i + 2);
  const html = `<html><body style="margin:0">${chunk.map(svgFor).join('')}</body></html>`;
  await page.setContent(html);
  const file = join(outDir, `${chunk.join('_')}.png`);
  await page.screenshot({ path: file, fullPage: true });
  writeFileSync(join(outDir, 'last.txt'), file);
  console.log(file);
}
await browser.close();
