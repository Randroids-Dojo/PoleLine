// Tutorial check, in three parts.
// 1. A first launch is easy, segment by segment: the welcome card offers the
//    four difficulties, the lap is laid as far as the last corner, the player
//    lays its segments with the lessons in order, picks a tyre and races; the
//    lap starts with the tutorial's laid line point for point (the server's
//    rule for the tutorial board) and every line speaks segment by segment.
// 2. Switching difficulty swaps between laying and drawing, from the welcome
//    card and the pause menu, carrying on at the player's turn.
// 3. A player who picked tap and bend gets the drawn walkthrough as before:
//    the pause menu holds it and changes the mode, and every line of tutorial
//    copy speaks the mode in use.
// Prints PASS or FAIL per check and exits non-zero on any failure.
//
//   npx tsx scripts/tutorialtest.ts [outDir] [url]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { TUTORIAL_COPY } from '../src/app/tutorial-copy.js';
import { TUTORIAL } from '../src/data/tutorial.js';
import { decodePath, validatePath } from '../src/sim/path.js';
import { CATALOG } from '../src/data/catalog.js';
import rookie from '../src/data/geometry/rookie-ring.js';
import { buildTrack } from '../src/sim/track.js';

const out = process.argv[2] ?? '/tmp/poleline-tutorial';
const url = process.argv[3] ?? 'http://localhost:5199/';
mkdirSync(out, { recursive: true });

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};

type V = { x: number; y: number };
type Draw = { worldToScreen(x: number, y: number): V; status: string; isGliding: boolean; curveState: { kind: string } | null };
const saved = (p: import('playwright-core').Page) => p.evaluate(() => JSON.parse(localStorage.getItem('poleline:v1:settings') ?? '{}').drawMode ?? 'default');
const browser = await chromium.launch();
const fresh = async (settings: Record<string, unknown>) => {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await c.newPage();
  p.on('pageerror', (e) => check('no page errors', false, e.message));
  await p.addInitScript((st) => localStorage.setItem('poleline:v1:settings', JSON.stringify(st)), settings);
  await p.goto(url);
  await p.waitForTimeout(1500);
  return p;
};
const screenOf = (p: import('playwright-core').Page) => p.evaluate(() => {
  const cur = (window as unknown as { __pl?: { app: { current: object } } }).__pl?.app.current;
  return cur && 'state' in cur ? 'segments' : 'draw';
});

// 1. Easy, segment by segment, from a first launch.
{
  const p = await fresh({ v: 2, sound: false });
  const levels = await p.locator('.coach .diff-opt .diff-level').allTextContents();
  const easyOn = await p.locator('.coach .diff-opt[data-mode="segments"]').getAttribute('aria-checked');
  check('a first launch offers four difficulties, easy (segment by segment) picked', levels.join(',') === 'Easy,Medium,Hard,Expert' && easyOn === 'true', levels.join(','));
  check('and lays the lap segment by segment', (await screenOf(p)) === 'segments');
  await p.screenshot({ path: join(out, '1-easy-welcome.png') });
  await p.getByRole('button', { name: 'Show me' }).click();
  await p.getByText('Your turn').waitFor({ timeout: 15000 });
  check('"Your turn" speaks segment by segment', (await p.locator('.coach p').first().textContent()) === TUTORIAL_COPY.segments.turn);
  const st0 = await p.evaluate(() => (window as unknown as { __pl: { app: { current: { state: { cursor: number; total: number } } } } }).__pl.app.current.state);
  check('the lap is laid as far as the last corner', st0.cursor > 0 && st0.total - st0.cursor <= 8, `${st0.total - st0.cursor} segments to lay`);
  // Lay the last corner: on the gas to the turn-in, brake into it, the inside gate at the apex, gas out.
  const hints: string[] = [];
  const note = async () => {
    const h = await p.locator('.draw-hint:not(.is-hidden)').textContent().catch(() => '');
    if (h && hints[hints.length - 1] !== h) hints.push(h);
  };
  const plan = ['Gas', 'Brake', 'Brake', 'Right Brake', 'Gas', 'Left Gas', 'Gas'];
  for (const step of plan.slice(0, st0.total - st0.cursor)) {
    for (const k of step.split(' ')) {
      await p.getByRole('button', { name: k, exact: true }).tap();
      await p.waitForTimeout(200);
      await note();
    }
  }
  check('the lessons come in order as the corner needs them', hints.indexOf('Tap Brake where you want to slow down.') >= 0 && hints.indexOf('Tap Left or Right to move your line.') > hints.indexOf('Tap Brake where you want to slow down.'), hints.join(' / '));
  await p.getByText('Pick your tyres, then Race').waitFor({ timeout: 10000 });
  check('then the tyre, beside Race', true);
  await p.screenshot({ path: join(out, '1-easy-tyres.png') });
  await p.locator('.sec-tyres [data-c="medium"]').tap();
  await p.getByRole('button', { name: 'Race', exact: true }).tap();
  let caption = '';
  const t0 = Date.now();
  while (Date.now() - t0 < 45000 && caption !== TUTORIAL_COPY.segments.yourCorner) {
    caption = ((await p.locator('.race-caption').textContent().catch(() => '')) ?? '').trim();
    await p.waitForTimeout(250);
  }
  check('the race caption speaks segment by segment', caption === TUTORIAL_COPY.segments.yourCorner, caption);
  await p.locator('.res-tutorial').waitFor({ timeout: 30000 });
  const res = (await p.locator('.res-tutorial').textContent()) ?? '';
  check('the results speak segment by segment', res.startsWith(TUTORIAL_COPY.segments.wholeGame), res);
  await p.screenshot({ path: join(out, '1-easy-results.png') });
  // The lap as it would be posted: the laid line point for point, a legal lap, with its brake zones.
  const pb = await p.evaluate(() => JSON.parse(localStorage.getItem('poleline:v1:pb:rookie-ring') ?? 'null'));
  const prefix = TUTORIAL.prefixPoints * 2;
  const starts = !!pb && pb.code.length > prefix && pb.code.slice(0, prefix).every((v: number, i: number) => v === TUTORIAL.line[i]);
  const track = buildTrack(CATALOG.find((m) => m.slug === 'rookie-ring')!, rookie);
  check('the lap starts with the laid line point for point (the tutorial board\'s rule), is legal and carries its brake zones', starts && validatePath(track, decodePath(pb.code)).ok && Array.isArray(pb.brakes) && pb.brakes.length > 0 && typeof pb.picks === 'string');
  await p.context().close();
}

// 2. Switching difficulty swaps between laying and drawing, carrying on at the player's turn.
{
  const p = await fresh({ v: 2, sound: false });
  await p.locator('.coach .diff-opt[data-mode="curves"]').click();
  await p.waitForTimeout(800);
  check('medium on the welcome card switches to drawing', (await screenOf(p)) === 'draw' && (await saved(p)) === 'curves', await saved(p));
  await p.getByText('Pick your tyres').waitFor({ timeout: 8000 });
  check('straight on to the tyre, no second welcome', (await p.getByText('Welcome to PoleLine').count()) === 0);
  await p.locator('.draw-tyre-pick[data-c="medium"]').click();
  await p.getByText('Your turn').waitFor({ timeout: 10000 });
  await p.getByRole('button', { name: 'Pause' }).click();
  await p.locator('.pause-sheet .diff-opt[data-mode="segments"]').click();
  await p.waitForTimeout(800);
  check('easy in the pause menu switches back to laying', (await screenOf(p)) === 'segments' && (await saved(p)) === 'segments');
  await p.getByText('Your turn').waitFor({ timeout: 8000 });
  check('at the player\'s turn, no second welcome', (await p.getByText('Welcome to PoleLine').count()) === 0 && (await p.locator('.coach p').first().textContent()) === TUTORIAL_COPY.segments.turn);
  await p.screenshot({ path: join(out, '2-switched-back.png') });
  await p.getByRole('button', { name: 'Pause' }).click();
  await p.locator('.pause-sheet .diff-opt[data-mode="smooth"]').click();
  await p.waitForTimeout(800);
  check('hard from the segment screen\'s pause menu switches to drawing', (await screenOf(p)) === 'draw' && (await saved(p)) === 'smooth');
  await p.context().close();
}

// 3. A player who picked tap and bend: the drawn walkthrough.
const page = await fresh({ v: 2, sound: false, drawMode: 'curves' });
const card = () => page.locator('.coach p').first().textContent();
const shot = (f: string) => page.screenshot({ path: join(out, f) });

// Welcome: their mode is picked; make it expert.
const curvesOn = await page.locator('.coach .diff-opt[data-mode="curves"]').getAttribute('aria-checked');
check('the welcome card shows the mode they picked', curvesOn === 'true');
await page.locator('.coach .diff-opt[data-mode="freehand"]').click();
check('picking expert saves freehand', (await saved(page)) === 'freehand', await saved(page));
await shot('1-welcome.png');

// Pause during the flight along the drawn line: the walkthrough waits.
await page.getByRole('button', { name: 'Show me' }).click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Pause' }).click();
await page.waitForTimeout(300);
await shot('2-paused.png');
const pickedInMenu = await page.locator('.pause-sheet .diff-opt[data-mode="freehand"]').getAttribute('aria-checked');
check('the pause menu shows the current difficulty', pickedInMenu === 'true');
await page.waitForTimeout(4500);
check('the walkthrough waits while paused', (await page.getByText('Pick your tyres').count()) === 0);
await page.getByRole('button', { name: 'Resume' }).first().click();
await page.getByText('Pick your tyres').waitFor({ timeout: 10000 });
check('it carries on after resume', true);

// Your turn, in freehand words; then switch to easy from the pause menu.
await page.locator('.draw-tyre-pick[data-c="medium"]').click();
await page.getByText('Your turn').waitFor({ timeout: 10000 });
check('"Your turn" speaks freehand', (await card()) === TUTORIAL_COPY.freehand.turn, (await card()) ?? '');
await page.getByRole('button', { name: 'Pause' }).click();
await page.locator('.pause-sheet .diff-opt[data-mode="curves"]').click();
await page.waitForTimeout(150);
check('"Your turn" rewrites itself for tap and bend', (await card()) === TUTORIAL_COPY.curves.turn, (await card()) ?? '');
check('the switch is saved', (await saved(page)) === 'curves', await saved(page));
await shot('3-switched.png');
await page.getByRole('button', { name: 'Resume' }).first().click();
await page.waitForTimeout(400);

// Lay the last corner with taps, collecting the coaching it gives.
const finish = decodePath(TUTORIAL.line).slice((TUTORIAL.prefixPoints - 1) * 2);
const n = finish.length / 2;
const hints = new Set<string>();
const settle = async () => {
  while (await page.evaluate(() => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current.isGliding)) await page.waitForTimeout(30);
};
for (let i = 25; i < n + 25; i += 25) {
  const k = Math.min(n - 1, i);
  if ((await page.evaluate(() => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current.status)) !== 'drawing') break;
  await settle();
  const s = await page.evaluate(([x, y]) => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current.worldToScreen(x, y), [finish[k * 2], finish[k * 2 + 1]]);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(120);
  hints.add((await page.locator('.draw-hint').textContent()) ?? '');
  const c = await page.evaluate(() => (window as unknown as { __pl: { app: { current: Draw } } }).__pl.app.current.curveState);
  if (c?.kind === 'finish') {
    await page.getByRole('button', { name: 'Finish lap' }).click();
    break;
  }
}
const tips = TUTORIAL_COPY.curves.tips.filter((t) => hints.has(t));
check('the corner coaching speaks tap and bend', tips.length >= 1, tips.join(' / ') || [...hints].join(' / '));
const otherTips = [...TUTORIAL_COPY.freehand.tips].filter((t) => !TUTORIAL_COPY.curves.tips.includes(t) && hints.has(t));
check('and never freehand', otherTips.length === 0, otherTips.join(' / '));

// The race names the corner in the same words, then the results.
let caption = '';
const t0 = Date.now();
while (Date.now() - t0 < 45000 && caption !== TUTORIAL_COPY.curves.yourCorner) {
  caption = ((await page.locator('.race-caption').textContent().catch(() => '')) ?? '').trim();
  await page.waitForTimeout(250);
}
check('the race caption speaks tap and bend', caption === TUTORIAL_COPY.curves.yourCorner, caption);
await page.locator('.res-tutorial').waitFor({ timeout: 30000 });
const res = (await page.locator('.res-tutorial').textContent()) ?? '';
check('the results speak tap and bend', res.startsWith(TUTORIAL_COPY.curves.wholeGame), res);
await shot('4-results.png');

await browser.close();
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
