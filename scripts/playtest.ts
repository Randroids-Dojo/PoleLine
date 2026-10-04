// Automated playtest: draws a lap with real pointer gestures in a phone-sized
// browser and captures screenshots of every stage.
//
//   npx tsx scripts/playtest.ts [slug] [ideal|wobbly|centre|offtrack] [outDir] [url]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { CATALOG } from '../src/data/catalog.js';
import { buildTrack } from '../src/sim/track.js';
import { minCurvatureOffsets, wobble } from './optimal.js';

const slug = process.argv[2] ?? 'spielberg';
const quality = process.argv[3] ?? 'ideal';
const out = process.argv[4] ?? '/tmp/poleline-play';
const url = process.argv[5] ?? 'http://localhost:5199/';
mkdirSync(out, { recursive: true });

const meta = CATALOG.find((m) => m.slug === slug)!;
const geom = (await import(`../src/data/geometry/${slug}.ts`)).default as number[];
const track = buildTrack(meta, geom);
let alpha = minCurvatureOffsets(track);
if (quality === 'wobbly') alpha = wobble(track, alpha, 3, 0.7, 50, 0.15);
if (quality === 'centre') alpha = new Float64Array(track.n);
const pts: { x: number; y: number }[] = [];
for (let i = 0; i <= track.n + 3; i += 2) {
  const k = i % track.n;
  let a = alpha[k];
  if (quality === 'offtrack' && i > 140 && i < 150) a = track.limit + 4;
  pts.push({ x: track.x[k] + a * track.nx[k], y: track.y[k] + a * track.ny[k] });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript((s) => {
  localStorage.setItem('poleline:v1:settings', JSON.stringify({ lastTrack: s, sound: false }));
}, slug);
await page.goto(url);
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, '1-home.png') });
await page.getByRole('button', { name: 'Draw a lap' }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: join(out, '2-draw-idle.png') });

type Pl = { __pl: { app: { current: { worldToScreen(x: number, y: number): { x: number; y: number }; status: string; isGliding: boolean } } } };
const toScreen = (p: { x: number; y: number }) => page.evaluate(([x, y]) => (window as unknown as Pl).__pl.app.current.worldToScreen(x, y), [p.x, p.y]);
const status = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.status);
const gliding = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.isGliding);

let idx = 0;
let strokes = 0;
const safe = { top: 110, bottom: 844 - 130, left: 18, right: 390 - 18 };
while (true) {
  const st = await status();
  if (st === 'done' || st === 'failed') break;
  while (await gliding()) await page.waitForTimeout(40);
  const s0 = await toScreen(pts[idx]);
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  strokes++;
  let moved = 0;
  for (let k = idx + 1; k < pts.length; k++) {
    const sp = await toScreen(pts[k]);
    if (sp.y < safe.top || sp.y > safe.bottom || sp.x < safe.left || sp.x > safe.right) break;
    await page.mouse.move(sp.x, sp.y, { steps: 2 });
    idx = k;
    moved++;
    if (moved % 25 === 0 && (await status()) !== 'drawing') break;
  }
  await page.mouse.up();
  if (strokes === 3) await page.screenshot({ path: join(out, '3-draw-mid.png') });
  if (moved === 0) {
    console.log('stuck at', idx, await status());
    break;
  }
  if (strokes > 120) break;
}
console.log(`strokes ${strokes}, status ${await status()}`);
await page.screenshot({ path: join(out, '4-draw-end.png') });
if ((await status()) === 'failed') {
  await browser.close();
  process.exit(0);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, '5-race-start.png') });
await page.waitForTimeout(5000);
await page.screenshot({ path: join(out, '6-race-mid.png') });
await page.getByRole('button', { name: /skip/i }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, '7-results.png') });
const text = await page.locator('.res-sheet').innerText();
console.log(text.replace(/\n+/g, ' | '));
await browser.close();
