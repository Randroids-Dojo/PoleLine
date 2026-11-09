// Draws a circuit north up with its start line, direction of travel, a tick
// every 100 m (labelled every 500 m) and the corners the game finds, so turn
// positions can be read off against an official turn map. With turn positions
// (metres along the lap) it draws them as T1, T2 ... to check them.
//
//   npx tsx scripts/turnmap.ts <slug> <out.png> [turns.json | --data]
// turns.json: { "turns": [s1, s2, ...] }. --data draws the ones in src/data/turns.ts.
// EDITION=toybox for the made-up circuits.

import { chromium } from 'playwright-core';
import { buildCourse } from '../src/app/segments.js';
import { frameAt, buildTrack } from '../src/sim/track.js';
import { readFileSync } from 'node:fs';

const TOYBOX = process.env.EDITION === 'toybox';
const DATA = TOYBOX ? '../src/data/toybox' : '../src/data';
const { CATALOG } = (await import(`${DATA}/catalog.ts`)) as typeof import('../src/data/catalog.js');
const slug = process.argv[2];
const out = process.argv[3];
const meta = CATALOG.find((m) => m.slug === slug);
if (!meta || !out) {
  console.log('usage: npx tsx scripts/turnmap.ts <slug> <out.png> [turns.json | --data]');
  process.exit(1);
}
const t = buildTrack(meta, (await import(`${DATA}/geometry/${slug}.ts`)).default);
let turns: number[] | null = null;
if (process.argv[4] === '--data') turns = ((await import(`${DATA}/turns.ts`)) as { TURNS: Record<string, number[]> }).TURNS[slug] ?? null;
else if (process.argv[4]) turns = (JSON.parse(readFileSync(process.argv[4], 'utf8')) as { turns: number[] }).turns;

const course = buildCourse(t);
const SIZE = 1600;
const PAD = 90;
let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
for (let i = 0; i < t.n; i++) {
  minX = Math.min(minX, t.x[i]);
  maxX = Math.max(maxX, t.x[i]);
  minY = Math.min(minY, t.y[i]);
  maxY = Math.max(maxY, t.y[i]);
}
const k = (SIZE - 2 * PAD) / Math.max(maxX - minX, maxY - minY);
const X = (x: number) => PAD + (x - minX) * k;
const Y = (y: number) => PAD + (y - minY) * k;
const parts: string[] = [];
const path = Array.from({ length: t.n + 1 }, (_, i) => `${i ? 'L' : 'M'}${X(t.x[i % t.n]).toFixed(1)},${Y(t.y[i % t.n]).toFixed(1)}`).join('');
parts.push(`<path d="${path}" fill="none" stroke="#9aa3ad" stroke-width="${Math.max(5, meta.width * k)}" stroke-linejoin="round"/>`);
parts.push(`<path d="${path}" fill="none" stroke="#2b2f36" stroke-width="1.5"/>`);
/** A label beside the track at lap distance s, `side` 1 right of travel, -1 left, `off` px out. */
const label = (s: number, text: string, color: string, side: number, off: number, size = 15, weight = 700) => {
  const f = frameAt(t, s);
  const x = X(f.x) + f.nx * side * off;
  const y = Y(f.y) + f.ny * side * off;
  parts.push(`<line x1="${X(f.x)}" y1="${Y(f.y)}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="1"/>`);
  parts.push(`<text x="${x}" y="${y}" fill="${color}" font-size="${size}" font-weight="${weight}" font-family="Helvetica, Arial" text-anchor="middle" dominant-baseline="middle" paint-order="stroke" stroke="#fff" stroke-width="4">${text}</text>`);
};
for (let s = 100; s < t.length; s += 100) {
  const f = frameAt(t, s);
  const w = s % 500 === 0 ? 14 : 7;
  parts.push(`<line x1="${X(f.x) - f.nx * w}" y1="${Y(f.y) - f.ny * w}" x2="${X(f.x) + f.nx * w}" y2="${Y(f.y) + f.ny * w}" stroke="#000" stroke-width="${s % 500 === 0 ? 2.5 : 1.2}"/>`);
  if (s % 500 === 0) label(s, `${s}`, '#000', -1, 30, 14);
}
// Start line and direction of travel.
{
  const f = frameAt(t, 0);
  parts.push(`<line x1="${X(f.x) - f.nx * 22}" y1="${Y(f.y) - f.ny * 22}" x2="${X(f.x) + f.nx * 22}" y2="${Y(f.y) + f.ny * 22}" stroke="#e10600" stroke-width="5"/>`);
  const a = frameAt(t, 25);
  const tip = { x: X(a.x) + a.tx * 16, y: Y(a.y) + a.ty * 16 };
  parts.push(`<polygon points="${tip.x},${tip.y} ${X(a.x) + a.nx * 9},${Y(a.y) + a.ny * 9} ${X(a.x) - a.nx * 9},${Y(a.y) - a.ny * 9}" fill="#e10600"/>`);
  label(0, 'START', '#e10600', -1, 46, 16, 800);
}
// The corners the game finds (blue, right of travel), with apex distance and hand.
course.corners.forEach((c, i) => {
  label(c.apex, `c${i + 1} ${Math.round(c.apex)}${c.dir > 0 ? 'R' : 'L'}${Math.round(c.angle)}°`, '#1f5fd1', 1, 40, 13, 600);
});
if (turns) turns.forEach((s, i) => label(s, `T${i + 1}`, '#c40000', 1, 78, 20, 900));
parts.push(`<text x="20" y="34" font-size="22" font-weight="800" font-family="Helvetica, Arial">${meta.short}: ${Math.round(t.length)} m, ${meta.turns} turns. North up. Black ticks every 100 m. Blue: corners the game finds (apex metres, hand, angle).${turns ? ' Red: turn positions.' : ''}</text>`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
await page.screenshot({ path: out });
await browser.close();
console.log(`${meta.short}: ${Math.round(t.length)} m, ${meta.turns} official turns; corners found:`);
course.corners.forEach((c, i) => console.log(`  c${i + 1}: entry ${Math.round(c.entry)} apex ${Math.round(c.apex)} exit ${Math.round(c.exit)} ${c.dir > 0 ? 'right' : 'left'} ${Math.round(c.angle)} deg${c.brakes ? ', brakes' : ''}`));
