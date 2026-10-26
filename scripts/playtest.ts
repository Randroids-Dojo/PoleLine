// Automated playtest: draws a lap with real pointer gestures in a phone-sized
// browser and captures screenshots of every stage.
//
//   npx tsx scripts/playtest.ts [slug] [ideal|good|wobbly|centre|offtrack] [outDir] [url]
// offtrack: goes over the white line once, taps Undo stroke, then finishes cleanly.
// DRAW=smooth plays tidy strokes (medium): the same strokes, each corrected as it lifts. Without DRAW it draws freehand.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { buildTrack } from '../src/sim/track.js';
import { minCurvatureOffsets, wobble } from './optimal.js';

// EDITION=toybox plays the Toybox edition (run the dev server with VITE_EDITION=toybox).
const DATA = process.env.EDITION === 'toybox' ? '../src/data/toybox' : '../src/data';
const { CATALOG } = (await import(`${DATA}/catalog.ts`)) as typeof import('../src/data/catalog.js');

const slug = process.argv[2] ?? 'spielberg';
const qualities = (process.argv[3] ?? 'ideal').split(',');
const out = process.argv[4] ?? '/tmp/poleline-play';
const url = process.argv[5] ?? 'http://localhost:5199/';
mkdirSync(out, { recursive: true });

const meta = CATALOG.find((m) => m.slug === slug)!;
const geom = (await import(`${DATA}/geometry/${slug}.ts`)).default as number[];
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

// CDP=http://localhost:9223 drives the game inside the mobile app's WebView (Android: adb forward
// tcp:9223 localabstract:webview_devtools_remote_<pid>) instead of a headless browser, and the
// screenshots come from the device so the system bars and safe areas are in them.
const cdp = process.env.CDP;
const browser = cdp ? await chromium.connectOverCDP(cdp) : await chromium.launch();
const ctx = cdp ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = cdp ? ctx.pages()[0] : await ctx.newPage();
const shot = async (file: string) => {
  if (cdp) writeFileSync(join(out, file), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 }));
  else await page.screenshot({ path: join(out, file) });
};
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
const seed = ([s, mode, speed, rotate, damp, draw]: readonly [string, string, string, string, string, string]) => {
  localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, tutorial: 'done', lastTrack: s, sound: false, drawMode: draw, scrollMode: mode, scrollSpeed: Number(speed), autoRotate: rotate !== 'off', cornerDamping: damp, panCoachSeen: true }));
};
// DRAW=smooth draws the same strokes in tidy strokes (scripts/curvetest.ts drives tap and bend). Freehand unless set.
const seedArgs = [slug, process.env.MODE ?? 'pause', process.env.SPEED ?? '1', process.env.ROTATE ?? 'on', process.env.DAMP ?? 'off', process.env.DRAW ?? 'freehand'] as const;
if (cdp) {
  // The app is already open: seed its storage, then reload with the debug handle on.
  await page.evaluate(seed, seedArgs);
  await page.goto(`${new URL(page.url()).origin}/?debug`);
} else {
  await page.addInitScript(seed, seedArgs);
  await page.goto(url);
}
await page.waitForTimeout(cdp ? 2500 : 900);
await shot('1-home.png');
for (let attempt = 1; attempt <= qualities.length; attempt++) {
const quality = qualities[attempt - 1];
if (attempt === 1) await page.getByRole('button', { name: 'Draw a lap' }).click();
else await page.getByRole('button', { name: 'Draw again' }).click();
await page.waitForTimeout(700);
await page.waitForTimeout(700);
await shot(`${attempt}-2-draw-idle.png`);

type Pl = { __pl: { app: { current: { worldToScreen(x: number, y: number): { x: number; y: number }; status: string; isGliding: boolean; penDown: boolean; tip: { x: number; y: number } | null } } } };
// Null once the lap has closed and the race screen has taken over (it has no map to project onto).
const toScreen = (p: { x: number; y: number }) => page.evaluate(([x, y]) => { const c = (window as unknown as Pl).__pl.app.current; return c?.worldToScreen ? c.worldToScreen(x, y) : null; }, [p.x, p.y]);
const status = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.status);
const gliding = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.isGliding);
const penDown = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.penDown);
const tipNow = () => page.evaluate(() => (window as unknown as Pl).__pl.app.current.tip);
const offTrackAt = () => page.evaluate(() => (window as unknown as { __pl: { app: { current: { offTrackAt: unknown } } } }).__pl.app.current.offTrackAt);

let pts = linePoints(quality);
let idx = 0;
let strokes = 0;
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
const safe = { top: 110, bottom: vp.h - 130, left: 18, right: vp.w - 18 };
while (true) {
  const st = await status();
  if (st === 'done') break;
  while (await gliding()) await page.waitForTimeout(40);
  const s0 = await toScreen(pts[idx]);
  if (!s0) break;
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  strokes++;
  let moved = 0;
  for (let k = idx + 1; k < pts.length; k++) {
    const sp = await toScreen(pts[k]);
    if (!sp) break;
    if (sp.y < safe.top || sp.y > safe.bottom || sp.x < safe.left || sp.x > safe.right) break;
    await page.mouse.move(sp.x, sp.y);
    moved++;
    if (!(await penDown())) break;
    idx = k;
  }
  await page.mouse.up();
  if (await offTrackAt()) {
    // Over the limit: show it, undo the stroke, then finish on a clean line.
    await page.waitForTimeout(250);
    await shot(`${attempt}-3b-limits.png`);
    await page.getByRole('button', { name: 'Undo stroke' }).click();
    await page.waitForTimeout(150);
    await shot(`${attempt}-3c-undone.png`);
    pts = linePoints('ideal');
  }
  // Resume from wherever the line actually stopped.
  const tp = await tipNow();
  if (tp) {
    let best = idx, bd = Infinity;
    for (let k = Math.max(0, idx - 400); k <= Math.min(pts.length - 1, idx + 5); k++) {
      const d = Math.hypot(pts[k].x - tp.x, pts[k].y - tp.y);
      if (d < bd) { bd = d; best = k; }
    }
    idx = best;
  }
  if (strokes === 3) {
    while (await gliding()) await page.waitForTimeout(30);
    await shot(`${attempt}-3-draw-mid.png`);
  }
  if (moved === 0) {
    console.log('stuck at', idx, await status());
    break;
  }
  if (strokes > 120) break;
}
console.log(`strokes ${strokes}, status ${await status()}`);
await shot(`${attempt}-4-draw-end.png`);
if ((await status()) !== 'done') break;
await page.waitForTimeout(1500);
await shot(`${attempt}-5-race-start.png`);
await page.waitForTimeout(5000);
await shot(`${attempt}-6-race-mid.png`);
await page.getByRole('button', { name: /skip/i }).click();
await page.waitForTimeout(1450);
await shot(`${attempt}-6b-finish.png`);
await page.waitForTimeout(2400);
await shot(`${attempt}-6c-pullback.png`);
await page.waitForTimeout(1500);
await shot(`${attempt}-7-results.png`);
if (process.env.POST_NAME && (await page.locator('.name-input').count())) {
  await page.locator('.name-input').fill(process.env.POST_NAME);
  await page.getByRole('button', { name: 'Post time' }).click();
  await page.waitForFunction(() => /World #|Not posted/.test(document.querySelector('.res-world-status')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  await shot(`${attempt}-8-posted.png`);
}
const text = await page.locator('.res-sheet').innerText();
if (process.env.SHEETS) {
  // The sheets behind the results: your times (Toybox) or the leaderboard, then settings from home.
  await page.getByRole('button', { name: process.env.EDITION === 'toybox' ? 'Your times' : 'Leaderboard' }).click();
  await page.waitForTimeout(500);
  await shot(`${attempt}-8-times.png`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (attempt === qualities.length) {
    await page.getByRole('button', { name: 'Circuits' }).click();
    await page.waitForTimeout(500);
    await shot(`${attempt}-9-home.png`);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.waitForTimeout(400);
    await shot(`${attempt}-10-settings.png`);
    await page.locator('.settings-body').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await page.waitForTimeout(200);
    await shot(`${attempt}-11-settings-end.png`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}
console.log(text.replace(/\n+/g, ' | '));
}
// Over CDP the close can hang on the WebView; the process has nothing left to do.
if (cdp) process.exit(0);
await browser.close();
