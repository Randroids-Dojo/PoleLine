// Closing the loop: a last dot or a lifted stroke that lands on the start
// point, a little short of the finish line as a finger does, must finish the
// lap rather than leave it at 99%. Each case lays most of the lap along the
// racing line, then ends it with real pointer input in a phone-sized browser.
// Prints PASS or FAIL per check and exits non-zero on any failure.
//
//   npx tsx scripts/closetest.ts [slug] [outDir] [url]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { buildTrack, frameAt } from '../src/sim/track.js';
import { minCurvatureOffsets } from './optimal.js';

const DATA = process.env.EDITION === 'toybox' ? '../src/data/toybox' : '../src/data';
const { CATALOG } = (await import(`${DATA}/catalog.ts`)) as typeof import('../src/data/catalog.js');

const slug = process.argv[2] ?? 'spielberg';
const out = process.argv[3] ?? '/tmp/poleline-close';
const url = process.argv[4] ?? 'http://localhost:5199/';
mkdirSync(out, { recursive: true });
const meta = CATALOG.find((m) => m.slug === slug)!;
const track = buildTrack(meta, (await import(`${DATA}/geometry/${slug}.ts`)).default as number[]);
const L = track.length;
const alpha = minCurvatureOffsets(track).map((a) => Math.max(-track.limit + 0.6, Math.min(track.limit - 0.6, a)));

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};

type V = { x: number; y: number };
type Hook = { __pl: { app: { current: Record<string, unknown> & { worldToScreen(x: number, y: number): V; status: string; isGliding: boolean; curveState: { kind: string } | null } } } };

/** The racing line at lap distance s (metres), `side` metres across from it. */
function onLine(s: number, side = 0): V {
  const f = frameAt(track, s);
  const k = f.seg;
  const u = (s - track.s[k]) / (track.segLen[k] || 1);
  const a = alpha[k] + (alpha[(k + 1) % track.n] - alpha[k]) * u + side;
  return { x: f.x + f.nx * a, y: f.y + f.ny * a };
}

/** The racing line in decimetres from the start line to `upTo` metres. */
function lineTo(upTo: number): number[] {
  const pts: number[] = [];
  const start = { x: track.x[0] + track.nx[0] * alpha[0], y: track.y[0] + track.ny[0] * alpha[0] };
  pts.push(Math.round(start.x * 10), Math.round(start.y * 10));
  for (let s = 2; s <= upTo; s += 2) {
    const p = onLine(s);
    pts.push(Math.round(p.x * 10), Math.round(p.y * 10));
  }
  return pts;
}

const browser = await chromium.launch();

async function open(drawMode: string, upTo: number): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.addInitScript(
    ([s, d]) => localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, tutorial: 'done', lastTrack: s, sound: false, drawMode: d, scrollMode: 'pause', panCoachSeen: true })),
    [slug, drawMode] as const,
  );
  await page.goto(url);
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Draw a lap' }).click();
  await page.waitForFunction(() => !!((window as unknown as Hook).__pl.app.current as { builder?: unknown })?.builder, null, { timeout: 8000 });
  await page.waitForTimeout(600);
  // Most of the lap, laid as if the player had drawn it in one stroke.
  const ok = await page.evaluate((pts) => {
    const d = (window as unknown as Hook).__pl.app.current as unknown as {
      builder: { start(x: number, y: number): boolean; addStroke(p: V[]): string };
      rebuildInk(): void;
      updateHud(): void;
      glideToTip(): void;
    };
    if (!d.builder.start(pts[0] / 10, pts[1] / 10)) return 'no start';
    const rest: V[] = [];
    for (let i = 2; i < pts.length; i += 2) rest.push({ x: pts[i] / 10, y: pts[i + 1] / 10 });
    const r = d.builder.addStroke(rest);
    d.rebuildInk();
    d.updateHud();
    d.glideToTip();
    return r;
  }, lineTo(upTo));
  if (ok !== 'ok') check(`${drawMode}: lay the lap to ${upTo.toFixed(0)} m`, false, ok);
  await settle(page);
  return page;
}

const hook = (page: Page) => ({
  toScreen: (p: V) => page.evaluate(([x, y]) => (window as unknown as Hook).__pl.app.current.worldToScreen(x, y), [p.x, p.y]),
  status: () => page.evaluate(() => (window as unknown as Hook).__pl.app.current.status),
  kind: () => page.evaluate(() => (window as unknown as Hook).__pl.app.current.curveState?.kind ?? 'none'),
  pct: () => page.locator('.draw-pct').innerText(),
  setLabel: () => page.locator('.draw-set').innerText().catch(() => ''),
});

async function settle(page: Page): Promise<void> {
  const t0 = Date.now();
  while (await page.evaluate(() => (window as unknown as Hook).__pl.app.current.isGliding)) {
    if (Date.now() - t0 > 5000) break;
    await page.waitForTimeout(30);
  }
}

/** A finished lap goes on to the race: the line passed the same checks the server runs. */
async function raced(page: Page, name: string): Promise<void> {
  const ok = await page.getByRole('button', { name: /skip/i }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(`${name}: the lap goes on to the race`, ok);
}

async function tap(page: Page, s: V): Promise<void> {
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** Tap and bend: the last tap lands `short` metres before the finish, `side` metres across from the line. */
async function curveCase(name: string, upTo: number, short: number, side: number): Promise<void> {
  const page = await open('curves', upTo);
  const h = hook(page);
  const target = onLine(L - short, side);
  await tap(page, await h.toScreen(target));
  const kind = await h.kind();
  const label = await h.setLabel();
  await page.screenshot({ path: join(out, `${name}-waiting.png`) });
  check(`${name}: the last curve closes the lap`, kind === 'finish', `curve ${kind}, button "${label}"`);
  await page.getByRole('button', { name: /Set curve|Finish lap/ }).click();
  await page.waitForTimeout(100);
  const status = await h.status();
  check(`${name}: setting it finishes the lap`, status === 'done', `status ${status}, ${await h.pct()}`);
  await page.screenshot({ path: join(out, `${name}-set.png`) });
  if (status === 'done') await raced(page, name);
  await page.context().close();
}

/** Freehand and tidy: drag from the tip along the line and lift `short` metres before the finish. */
async function strokeCase(mode: string, name: string, upTo: number, short: number, expectDone: boolean): Promise<void> {
  const page = await open(mode, upTo);
  const h = hook(page);
  const from = await h.toScreen(onLine(upTo));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let s = upTo + 0.5; s <= L - short + 1e-6; s += 0.5) {
    const p = await h.toScreen(onLine(Math.min(s, L - short)));
    await page.mouse.move(p.x, p.y);
  }
  await page.mouse.up();
  await page.waitForTimeout(150);
  const status = await h.status();
  await page.screenshot({ path: join(out, `${name}.png`) });
  if (expectDone) {
    check(`${name}: lifting on the start point finishes the lap`, status === 'done', `status ${status}, ${await h.pct()}`);
    if (status === 'done') await raced(page, name);
  } else check(`${name}: lifting well short leaves the lap open`, status === 'drawing', `status ${status}, ${await h.pct()}`);
  await page.context().close();
}

await curveCase('curves-on-dot', L - 40, 1.2, 0);
await curveCase('curves-across', L - 40, 4, alpha[0] > 0 ? -track.limit * 1.4 : track.limit * 1.4);

// An ordinary curve near the end stays an ordinary curve.
{
  const page = await open('curves', L - 70);
  const h = hook(page);
  await tap(page, await h.toScreen(onLine(L - 35)));
  const kind = await h.kind();
  check('curves-short: a curve 35 m before the line is an ordinary curve', kind === 'ok', `curve ${kind}`);
  await tap(page, await h.toScreen(onLine(L - 1.2)));
  check('curves-short: then a tap on the start point closes the lap', (await h.kind()) === 'finish', `curve ${await h.kind()}`);
  await page.getByRole('button', { name: /Set curve|Finish lap/ }).click();
  await page.waitForTimeout(100);
  check('curves-short: and finishing it is done', (await h.status()) === 'done', `status ${await h.status()}, ${await h.pct()}`);
  await page.context().close();
}

await strokeCase('freehand', 'freehand-on-dot', L - 30, 1.2, true);
await strokeCase('smooth', 'smooth-on-dot', L - 30, 1.2, true);
await strokeCase('freehand', 'freehand-short', L - 60, 30, false);

await browser.close();
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
