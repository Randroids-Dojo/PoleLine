// Touch-input check: drives the draw screen with real touch events (CDP
// Input.dispatchTouchEvent) instead of mouse events, and records which
// pointer types the canvas actually received.
//
//   npx tsx scripts/touchtest.ts [slug] [outDir] [url]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CATALOG } from '../src/data/catalog.js';
import { buildTrack } from '../src/sim/track.js';
import { minCurvatureOffsets } from './optimal.js';

const slug = process.argv[2] ?? 'zandvoort';
const out = process.argv[3] ?? '/tmp/poleline-touch';
const url = process.argv[4] ?? 'http://localhost:5199/';
mkdirSync(out, { recursive: true });

const meta = CATALOG.find((m) => m.slug === slug)!;
const track = buildTrack(meta, (await import(`../src/data/geometry/${slug}.ts`)).default as number[]);
const alpha = minCurvatureOffsets(track);
const pts = Array.from({ length: track.n + 3 }, (_, i) => {
  const k = i % track.n;
  return { x: track.x[k] + alpha[k] * track.nx[k], y: track.y[k] + alpha[k] * track.ny[k] };
});

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript((s) => {
  localStorage.setItem('poleline:v1:settings', JSON.stringify({ tutorial: 'done', lastTrack: s, sound: false }));
  (window as unknown as { __types: Record<string, number> }).__types = {};
  window.addEventListener(
    'pointerdown',
    (e) => {
      const t = (window as unknown as { __types: Record<string, number> }).__types;
      t[e.pointerType] = (t[e.pointerType] ?? 0) + 1;
    },
    true,
  );
}, slug);
await page.goto(url);
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Draw a lap' }).tap();
await page.waitForTimeout(800);

const cdp = await ctx.newCDPSession(page);
type Pl = { __pl: { app: { current: { worldToScreen(x: number, y: number): { x: number; y: number }; status: string; isGliding: boolean; penDown: boolean; tip: { x: number; y: number } | null } } } };
const toScreen = (p: { x: number; y: number }) => page.evaluate(([x, y]) => (window as unknown as Pl).__pl.app.current.worldToScreen(x, y), [p.x, p.y]);
const status = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.status);
const gliding = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.isGliding);
const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) =>
  cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 12, radiusY: 12, force: 1 }] });

let idx = 0;
let strokes = 0;
const t0 = Date.now();
while ((await status()) === 'drawing' || (await status()) === 'idle') {
  while (await gliding()) await page.waitForTimeout(30);
  const s0 = await toScreen(pts[idx]);
  await touch('touchStart', s0.x, s0.y);
  strokes++;
  let moved = 0;
  for (let k = idx + 1; k < pts.length; k++) {
    const sp = await toScreen(pts[k]);
    if (sp.y < 110 || sp.y > 844 - 130 || sp.x < 18 || sp.x > 372) break;
    await touch('touchMove', sp.x, sp.y);
    // Let the frame that consumes this move render before aiming the next one.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    moved++;
    if (!(await page.evaluate(() => (window as unknown as Pl).__pl.app.current.penDown))) break;
    idx = k;
  }
  await touch('touchEnd', 0, 0);
  const tp = await page.evaluate(() => (window as unknown as Pl).__pl.app.current.tip);
  if (tp) {
    let best = idx, bd = Infinity;
    for (let k = Math.max(0, idx - 80); k <= Math.min(pts.length - 1, idx + 5); k++) {
      const d = Math.hypot(pts[k].x - tp.x, pts[k].y - tp.y);
      if (d < bd) { bd = d; best = k; }
    }
    idx = best;
  }
  if (strokes === 2) await page.screenshot({ path: join(out, 'touch-mid.png') });
  if (!moved || strokes > 80) break;
}
const types = await page.evaluate(() => (window as unknown as { __types: Record<string, number> }).__types);
console.log(`touch drawing: ${strokes} strokes, status ${await status()}, ${((Date.now() - t0) / 1000).toFixed(1)}s, pointer types`, types);
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, 'touch-race.png') });
await browser.close();
