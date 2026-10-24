// Tap and bend playtest: lays a whole lap as curves with real pointer taps in
// a phone-sized browser, bending a curve through the racing line's middle when
// it would leave the track (or always, with BEND=always), then races it.
//
//   npx tsx scripts/curvetest.ts [slug] [outDir] [url]
//   BEND=always  bend every curve that strays more than half a metre from the line
//   ROTATE=off   play with the map fixed instead of following the track

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { buildTrack } from '../src/sim/track.js';
import { minCurvatureOffsets } from './optimal.js';

const DATA = process.env.EDITION === 'toybox' ? '../src/data/toybox' : '../src/data';
const { CATALOG } = (await import(`${DATA}/catalog.ts`)) as typeof import('../src/data/catalog.js');

const slug = process.argv[2] ?? 'spielberg';
const out = process.argv[3] ?? '/tmp/poleline-curves';
const url = process.argv[4] ?? 'http://localhost:5199/';
const bendAlways = process.env.BEND === 'always';
mkdirSync(out, { recursive: true });

const meta = CATALOG.find((m) => m.slug === slug)!;
const track = buildTrack(meta, (await import(`${DATA}/geometry/${slug}.ts`)).default as number[]);
const alpha = minCurvatureOffsets(track);
const pts = Array.from({ length: track.n + 6 }, (_, i) => {
  const k = i % track.n;
  return { x: track.x[k] + alpha[k] * track.nx[k], y: track.y[k] + alpha[k] * track.ny[k] };
});
/** Heading of the racing line at point i, radians. */
const heading = (i: number) => Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page: Page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text());
});
await page.addInitScript(
  ([s, rotate]) => {
    localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, tutorial: 'done', lastTrack: s, sound: false, drawMode: 'curves', autoRotate: rotate !== 'off', panCoachSeen: true }));
  },
  [slug, process.env.ROTATE ?? 'on'] as const,
);
await page.goto(url);
await page.waitForTimeout(900);
await page.getByRole('button', { name: 'Draw a lap' }).click();
await page.waitForTimeout(1200);

type V = { x: number; y: number };
type Draw = { worldToScreen(x: number, y: number): V; status: string; isGliding: boolean; tip: V | null; curveState: { end: V; bend: V; kind: string } | null };
const toScreen = (p: V) => page.evaluate(([x, y]) => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current?.worldToScreen?.(x, y) ?? null, [p.x, p.y]);
const status = () => page.evaluate(() => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current.status);
const curve = () => page.evaluate(() => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current.curveState);
const settle = async () => {
  while (await page.evaluate(() => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current.isGliding)) await page.waitForTimeout(30);
};
const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
const safe = { top: 120, bottom: vp.h - 140, left: 24, right: vp.w - 24 };
const onScreen = (s: V | null) => !!s && s.x > safe.left && s.x < safe.right && s.y > safe.top && s.y < safe.bottom;
const tap = async (s: V) => {
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.up();
};
const drag = async (from: V, to: V) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(from.x + ((to.x - from.x) * k) / 8, from.y + ((to.y - from.y) * k) / 8);
  await page.mouse.up();
};

await page.screenshot({ path: join(out, '1-idle.png') });
await tap((await toScreen(pts[0]))!);
await page.waitForTimeout(150);
let idx = 0;
let taps = 1;
let bends = 0;
let sets = 0;
let undos = 0;
let shots = 0;
const t0 = Date.now();
while ((await status()) === 'drawing' && taps < 500) {
  await settle();
  // The furthest racing-line point on screen that one curve should reach: at
  // most 130 m on, and no more than about 20 degrees of turn (TURN, radians).
  let k = -1;
  for (let j = idx + 2; j < pts.length - 2 && (j - idx) * 2 < 130; j++) {
    // Even a hairpin gets a curve of a few metres.
    if (j > idx + 3 && turn(heading(idx), heading(j)) > Number(process.env.TURN ?? 0.35)) break;
    if (onScreen(await toScreen(pts[j]))) k = j;
  }
  if (k < 0) {
    // Nothing reachable on screen: set the waiting curve, and the map moves on.
    if (await curve()) {
      await page.getByRole('button', { name: /Set curve|Finish lap/ }).click();
      sets++;
      await page.waitForTimeout(80);
      continue;
    }
    console.log('stuck at', idx, 'of', track.n);
    await page.screenshot({ path: join(out, 'x-stuck.png') });
    break;
  }
  let laid = false;
  for (let tries = 0; tries < 4 && !laid; tries++) {
    await tap((await toScreen(pts[k]))!);
    taps++;
    let c = await curve();
    if (!c) break;
    const mid = (await toScreen(pts[(idx + k) >> 1]))!;
    const off = Math.hypot(c.bend.x - mid.x, c.bend.y - mid.y);
    if (c.kind === 'offtrack' || c.kind === 'backward' || (bendAlways && off > 1.8)) {
      await drag(c.bend, mid);
      bends++;
      c = await curve();
      if (shots < 2) await page.screenshot({ path: join(out, `2-bent-${++shots}.png`) });
    }
    if (c && (c.kind === 'ok' || c.kind === 'finish')) {
      laid = true;
      if (c.kind === 'finish') {
        await page.screenshot({ path: join(out, '3-finish.png') });
        await page.getByRole('button', { name: 'Finish lap' }).click();
        sets++;
      }
    } else {
      // Still off: take it back and aim nearer.
      await page.getByRole('button', { name: 'Undo last stroke' }).click();
      undos++;
      k = idx + Math.max(3, ((k - idx) >> 1));
      await settle();
      if (!onScreen(await toScreen(pts[k]))) break;
    }
  }
  if (!laid) {
    console.log('could not lay a curve at', idx, JSON.stringify(await curve()));
    await page.screenshot({ path: join(out, 'x-stuck.png') });
    break;
  }
  idx = k;
}
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`taps ${taps}, bends ${bends}, set taps ${sets}, undos ${undos}, status ${await status()}, ${secs}s`);
if ((await status()) === 'done') {
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /skip/i }).click();
  await page.waitForTimeout(4500);
  await page.screenshot({ path: join(out, '4-results.png') });
  console.log((await page.locator('.res-sheet').innerText()).replace(/\n+/g, ' | ').slice(0, 220));
}
const finished = (await page.evaluate(() => document.querySelector('.res-sheet') !== null)) || (await status().catch(() => '')) === 'done';
await browser.close();
// A lap that never closed is a failure, whatever stopped it (see x-stuck.png).
if (!finished) {
  console.log('FAIL the lap did not finish');
  process.exit(1);
}
