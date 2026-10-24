// Tutorial check: the guided first lap offers a difficulty on its welcome card
// (easy picked), the pause menu holds the walkthrough and changes the mode,
// and every line of tutorial copy (the "Your turn" card, the corner coaching,
// the race caption, the results) speaks the mode in use. Prints PASS or FAIL
// per check and exits non-zero on any failure.
//
//   npx tsx scripts/tutorialtest.ts [outDir] [url]

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { TUTORIAL_COPY } from '../src/app/tutorial-copy.js';
import { TUTORIAL } from '../src/data/tutorial.js';
import { decodePath } from '../src/sim/path.js';

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
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', (e) => check('no page errors', false, e.message));
// A first launch: nothing saved but the sound switch.
await page.addInitScript(() => localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, sound: false })));
await page.goto(url);
await page.waitForTimeout(1500);
const card = () => page.locator('.coach p').first().textContent();
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('poleline:v1:settings') ?? '{}').drawMode ?? 'default');
const shot = (f: string) => page.screenshot({ path: join(out, f) });

// Welcome: easy is picked; make it hard.
const easyOn = await page.locator('.coach .diff-opt[data-mode="curves"]').getAttribute('aria-checked');
check('the welcome card offers the difficulty, easy picked', easyOn === 'true');
await page.locator('.coach .diff-opt[data-mode="freehand"]').click();
check('picking hard saves freehand', (await saved()) === 'freehand', await saved());
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
check('the switch is saved', (await saved()) === 'curves', await saved());
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
