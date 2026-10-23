// Easy modes check: the settings choice, a wobbly stroke tidied on lift
// (before and after screenshots, and the tidied stroke must be smoother), and
// tap and bend's handles (lay, bend, push off the track, undo). Prints PASS or
// FAIL per check and exits non-zero on any failure.
//
//   npx tsx scripts/easytest.ts [slug] [outDir] [url]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { CATALOG } from '../src/data/catalog.js';
import { buildTrack, frameAt } from '../src/sim/track.js';

const slug = process.argv[2] ?? 'spielberg';
const out = process.argv[3] ?? '/tmp/poleline-easy';
const url = process.argv[4] ?? 'http://localhost:5199/';
mkdirSync(out, { recursive: true });
const meta = CATALOG.find((m) => m.slug === slug)!;
const track = buildTrack(meta, (await import(`../src/data/geometry/${slug}.ts`)).default as number[]);

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};

type V = { x: number; y: number };
type Draw = {
  worldToScreen(x: number, y: number): V;
  status: string;
  isGliding: boolean;
  isTidying: boolean;
  tip: V | null;
  curveState: { end: V; bend: V; kind: string } | null;
};
const browser = await chromium.launch();

async function open(drawMode: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.addInitScript(
    ([s, d]) => localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, tutorial: 'done', lastTrack: s, sound: false, drawMode: d, panCoachSeen: true })),
    [slug, drawMode] as const,
  );
  await page.goto(url);
  await page.waitForTimeout(800);
  return page;
}
const api = (page: Page) => ({
  toScreen: (p: V) => page.evaluate(([x, y]) => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current.worldToScreen(x, y), [p.x, p.y]),
  get: <K extends keyof Draw>(k: K) => page.evaluate((key) => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current[key as keyof Draw], k) as Promise<Draw[K]>,
  line: () => page.evaluate(() => {
    const c = (window as unknown as { __pl: { app: { current: { builder: { points: number[] } } } } }).__pl.app.current;
    return Array.from(c.builder.points, (v) => v / 10);
  }),
});

/** Mean absolute change of heading between 3 m steps (degrees): wobble reads high, a clean line low. */
function roughness(line: number[]): number {
  const pts: V[] = [{ x: line[0], y: line[1] }];
  for (let i = 2; i < line.length; i += 2) {
    const l = pts[pts.length - 1];
    if (Math.hypot(line[i] - l.x, line[i + 1] - l.y) >= 3) pts.push({ x: line[i], y: line[i + 1] });
  }
  const turns: number[] = [];
  for (let i = 2; i < pts.length; i++) {
    const ax = pts[i - 1].x - pts[i - 2].x, ay = pts[i - 1].y - pts[i - 2].y;
    const bx = pts[i].x - pts[i - 1].x, by = pts[i].y - pts[i - 1].y;
    turns.push(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
  }
  let sum = 0;
  for (let i = 1; i < turns.length; i++) sum += Math.abs(turns[i] - turns[i - 1]);
  return (sum / Math.max(1, turns.length - 1)) * (180 / Math.PI);
}

// 1. Settings: three ways to draw, and tap and bend hides the scroll options.
{
  const page = await open('freehand');
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, '1-settings.png') });
  const modes = await page.locator('input[name="draw-mode"]').count();
  check('settings offer three ways to draw', modes === 3, `${modes}`);
  await page.getByText('Tap and bend').click();
  await page.waitForTimeout(150);
  const scrollShown = await page.getByText('When the map scrolls while you draw').isVisible();
  check('tap and bend hides the scroll settings', !scrollShown);
  await page.screenshot({ path: join(out, '1b-settings-curves.png') });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('poleline:v1:settings') ?? '{}').drawMode);
  check('the choice is saved', saved === 'curves', saved);
  await page.context().close();
}

// 2. Tidy strokes: a wobbly first stroke comes out smoother once the finger lifts.
{
  const page = await open('smooth');
  const a = api(page);
  await page.getByRole('button', { name: 'Draw a lap' }).click();
  await page.waitForTimeout(1300);
  const wob = (s: number) => {
    const f = frameAt(track, s);
    const lat = 1.4 * Math.sin(s / 4) + 0.6 * Math.sin(s / 1.7);
    return { x: f.x + f.nx * lat, y: f.y + f.ny * lat };
  };
  const s0 = await a.toScreen(wob(0));
  await page.mouse.move(s0.x, s0.y);
  await page.mouse.down();
  let lastS = 0;
  for (let s = 0.7; s < 150; s += 0.7) {
    const sp = await a.toScreen(wob(s));
    // Lift before the map would move on (that ends the stroke by itself).
    if (sp.y < 300) break;
    await page.mouse.move(sp.x, sp.y);
    lastS = s;
  }
  const before = roughness(await a.line());
  await page.screenshot({ path: join(out, '2-tidy-drawn.png') });
  await page.mouse.up();
  const tidying = await a.get('isTidying');
  check('lifting starts the tidy', tidying === true);
  await page.waitForTimeout(400);
  check('the tidy settles', (await a.get('isTidying')) === false);
  const after = roughness(await a.line());
  check('the tidied stroke is smoother', after < before * 0.6, `${before.toFixed(2)}° to ${after.toFixed(2)}° per step`);
  const tip = await a.get('tip');
  const lift = wob(lastS);
  const moved = tip ? Math.hypot(tip.x - lift.x, tip.y - lift.y) : Infinity;
  check('the tip stays where the finger lifted', moved < 0.8, `${moved.toFixed(2)} m`);
  while (await a.get('isGliding')) await page.waitForTimeout(30);
  // The map has glided on to the tip: drag the grass to bring the stroke back into view.
  const vp = page.viewportSize()!;
  await page.mouse.move(40, vp.height - 200);
  await page.mouse.down();
  for (let k = 1; k <= 12; k++) await page.mouse.move(40, vp.height - 200 - (k * 300) / 12);
  // Hold still before letting go, so the map does not carry on with momentum.
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, '2b-tidy-after.png') });
  await page.context().close();
}

// 3. Tap and bend: lay a curve, bend it, push it off the track, undo it.
{
  const page = await open('curves');
  const a = api(page);
  await page.getByRole('button', { name: 'Draw a lap' }).click();
  await page.waitForTimeout(1300);
  const start = await a.toScreen({ x: track.x[0], y: track.y[0] });
  await page.mouse.click(start.x, start.y);
  await page.waitForTimeout(100);
  check('touching the start line starts the lap', (await a.get('status')) === 'drawing');
  const ahead = frameAt(track, 70);
  const target = await a.toScreen({ x: ahead.x, y: ahead.y });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(120);
  // The map may move on to show road past the curve's end.
  while (await a.get('isGliding')) await page.waitForTimeout(30);
  let c = await a.get('curveState');
  check('a tap ahead lays a curve', !!c && c.kind === 'ok', c?.kind);
  check('the set button shows', await page.getByRole('button', { name: 'Set curve' }).isVisible());
  await page.screenshot({ path: join(out, '3-curve.png') });
  const drag = async (from: V, to: V) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let k = 1; k <= 10; k++) await page.mouse.move(from.x + ((to.x - from.x) * k) / 10, from.y + ((to.y - from.y) * k) / 10);
    await page.mouse.up();
    await page.waitForTimeout(60);
  };
  const mid = c!.bend;
  // A little to the side: still on the track.
  const side = frameAt(track, 35);
  const sideScreen = await a.toScreen({ x: side.x + side.nx * (track.limit - 1.5), y: side.y + side.ny * (track.limit - 1.5) });
  await drag(mid, sideScreen);
  c = await a.get('curveState');
  check('dragging the middle bends the curve through the finger', !!c && Math.hypot(c.bend.x - sideScreen.x, c.bend.y - sideScreen.y) < 6 && c.kind === 'ok', c ? `${c.kind}, ${Math.hypot(c.bend.x - sideScreen.x, c.bend.y - sideScreen.y).toFixed(1)} px` : 'none');
  await page.screenshot({ path: join(out, '3b-bent.png') });
  // Far over the other side, onto the grass: the handle stops where the curve meets the white line.
  const far = await a.toScreen({ x: side.x - side.nx * (track.limit + 25), y: side.y - side.ny * (track.limit + 25) });
  await drag(c!.bend, far);
  c = await a.get('curveState');
  check('bending stops at the white line', !!c && c.kind === 'ok', c?.kind);
  check('the set button stays ready', !(await page.getByRole('button', { name: 'Set curve' }).isDisabled()));
  await page.screenshot({ path: join(out, '3c-pushed.png') });
  await page.getByRole('button', { name: 'Undo last stroke' }).click();
  await page.waitForTimeout(120);
  check('undo takes the waiting curve away', (await a.get('curveState')) === null);
  await page.context().close();
}

await browser.close();
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
