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
const qualities = (process.argv[3] ?? 'ideal').split(',');
const out = process.argv[4] ?? '/tmp/poleline-play';
const url = process.argv[5] ?? 'http://localhost:5199/';
mkdirSync(out, { recursive: true });

const meta = CATALOG.find((m) => m.slug === slug)!;
const geom = (await import(`../src/data/geometry/${slug}.ts`)).default as number[];
const track = buildTrack(meta, geom);
const ideal = minCurvatureOffsets(track);
function linePoints(quality: string): { x: number; y: number }[] {
  let alpha = ideal;
  if (quality === 'wobbly') alpha = wobble(track, ideal, 3, 0.7, 50, 0.15);
  if (quality === 'good') alpha = wobble(track, ideal, 5, 0.25, 50, 0.08);
  if (quality === 'centre') alpha = new Float64Array(track.n);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= track.n + 3; i += 1) {
    const k = i % track.n;
    let a = alpha[k];
    if (quality === "offtrack" && i > 280 && i < 300) a = track.limit + 4;
    pts.push({ x: track.x[k] + a * track.nx[k], y: track.y[k] + a * track.ny[k] });
  }
  return pts;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.addInitScript(([s, mode, speed]) => {
  localStorage.setItem('poleline:v1:settings', JSON.stringify({ lastTrack: s, sound: false, scrollMode: mode, scrollSpeed: Number(speed) }));
}, [slug, process.env.MODE ?? 'pause', process.env.SPEED ?? '1'] as const);
await page.goto(url);
await page.waitForTimeout(900);
await page.screenshot({ path: join(out, '1-home.png') });
for (let attempt = 1; attempt <= qualities.length; attempt++) {
const quality = qualities[attempt - 1];
if (attempt === 1) await page.getByRole('button', { name: 'Draw a lap' }).click();
else await page.getByRole('button', { name: 'Draw again' }).click();
await page.waitForTimeout(700);
await page.waitForTimeout(700);
await page.screenshot({ path: join(out, `${attempt}-2-draw-idle.png`) });

type Pl = { __pl: { app: { current: { worldToScreen(x: number, y: number): { x: number; y: number }; status: string; isGliding: boolean; penDown: boolean; tip: { x: number; y: number } | null } } } };
const toScreen = (p: { x: number; y: number }) => page.evaluate(([x, y]) => (window as unknown as Pl).__pl.app.current.worldToScreen(x, y), [p.x, p.y]);
const status = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.status);
const gliding = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.isGliding);
const penDown = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.penDown);
const tipNow = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.tip);

const pts = linePoints(quality);
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
    await page.mouse.move(sp.x, sp.y);
    moved++;
    if (!(await penDown())) break;
    idx = k;
  }
  await page.mouse.up();
  // Resume from wherever the line actually stopped.
  const tp = await tipNow();
  if (tp) {
    let best = idx, bd = Infinity;
    for (let k = Math.max(0, idx - 80); k <= Math.min(pts.length - 1, idx + 5); k++) {
      const d = Math.hypot(pts[k].x - tp.x, pts[k].y - tp.y);
      if (d < bd) { bd = d; best = k; }
    }
    idx = best;
  }
  if (strokes === 3) {
    while (await gliding()) await page.waitForTimeout(30);
    await page.screenshot({ path: join(out, `${attempt}-3-draw-mid.png`) });
  }
  if (moved === 0) {
    console.log('stuck at', idx, await status());
    break;
  }
  if (strokes > 120) break;
}
console.log(`strokes ${strokes}, status ${await status()}`);
await page.screenshot({ path: join(out, `${attempt}-4-draw-end.png`) });
if ((await status()) === 'failed') break;
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, `${attempt}-5-race-start.png`) });
await page.waitForTimeout(5000);
await page.screenshot({ path: join(out, `${attempt}-6-race-mid.png`) });
await page.getByRole('button', { name: /skip/i }).click();
await page.waitForTimeout(1450);
await page.screenshot({ path: join(out, `${attempt}-6b-finish.png`) });
await page.waitForTimeout(2400);
await page.screenshot({ path: join(out, `${attempt}-6c-pullback.png`) });
await page.waitForTimeout(1500);
await page.screenshot({ path: join(out, `${attempt}-7-results.png`) });
if (process.env.POST_NAME && (await page.locator('.name-input').count())) {
  await page.locator('.name-input').fill(process.env.POST_NAME);
  await page.getByRole('button', { name: 'Post time' }).click();
  await page.waitForFunction(() => /World #|Not posted/.test(document.querySelector('.res-world-status')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: join(out, `${attempt}-8-posted.png`) });
}
const text = await page.locator('.res-sheet').innerText();
console.log(text.replace(/\n+/g, ' | '));
}
await browser.close();
