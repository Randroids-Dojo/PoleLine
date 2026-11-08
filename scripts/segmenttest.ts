// Segment by segment in a phone-sized browser, with real taps: a whole lap
// laid from a careful plan (scripts/segmentplan.ts), the lessons in order,
// undo, changing a laid segment, the race, and a result that matches the
// headless sim of the same plan to the millisecond. Then Edit segments opens
// the plan again.
//
//   npx tsx scripts/segmenttest.ts [slug] [outDir] [url]   (dev server running)

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { formatLap } from '../src/shared/time.js';
import { buildCourse, encodePicks } from '../src/app/segments.js';
import { buildTrack } from '../src/sim/track.js';
import { carefulPlan, lapTime } from './segmentplan.js';

const DATA = process.env.EDITION === 'toybox' ? '../src/data/toybox' : '../src/data';
const { CATALOG } = (await import(`${DATA}/catalog.ts`)) as typeof import('../src/data/catalog.js');
const slug = process.argv[2] ?? 'spielberg';
const out = process.argv[3] ?? '/tmp/poleline-segments';
const url = process.argv[4] ?? 'http://localhost:5199/';
mkdirSync(out, { recursive: true });

const meta = CATALOG.find((m) => m.slug === slug)!;
const track = buildTrack(meta, (await import(`${DATA}/geometry/${slug}.ts`)).default);
const course = buildCourse(track);
const plan = carefulPlan(track, course);
const expected = lapTime(track, course, plan, 'soft');
if (expected === null) throw new Error('the careful plan is not a legal lap');
console.log(`${slug}: ${course.segments.length} segments, careful plan ${encodePicks(plan)}, headless ${formatLap(expected)}`);

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page: Page = await ctx.newPage();
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[page]', m.text());
});
await page.addInitScript((s) => {
  localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, tutorial: 'done', lastTrack: s, sound: false, segments: true, panCoachSeen: true }));
}, slug);
await page.goto(`${url}?debug`);
await page.waitForTimeout(900);
await page.getByRole('button', { name: 'Draw a lap' }).click();
await page.waitForTimeout(900);

type State = { cursor: number; total: number; picks: string; review: boolean; armed: number; startLane: number; coached: boolean; tips: { segment: number; action: string; gain: number; stale: boolean; pedal?: 'gas' | 'brake'; lane?: -1 | 0 | 1 }[] };
const state = () => page.evaluate(() => (window as unknown as { __pl: { app: { current: { state: State } } } }).__pl.app.current.state) as Promise<State>;
const hint = () => page.evaluate(() => {
  const el = document.querySelector('.draw-hint');
  return el && !el.classList.contains('is-hidden') ? el.textContent ?? '' : '';
});
const tap = (name: string) => page.getByRole('button', { name, exact: true }).tap();

const st0 = await state();
check(st0.total === course.segments.length, `the browser cuts the circuit into the same ${course.segments.length} segments (${st0.total})`);

// Every pad button takes a touch across its face (nothing invisible over it).
const reach = await page.evaluate(() => {
  const bad: string[] = [];
  for (const b of Array.from(document.querySelectorAll<HTMLElement>('.sec-pad button:not([hidden])'))) {
    const r = b.getBoundingClientRect();
    for (const [fx, fy] of [[0.5, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]]) {
      const hit = document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy);
      if (!hit || !b.contains(hit)) bad.push(`${b.getAttribute('aria-label') ?? b.textContent} at ${fx},${fy}`);
    }
  }
  return bad;
});
check(reach.length === 0, `every pad button takes a touch across its face${reach.length ? `: ${reach.join('; ')}` : ''}`);
await page.screenshot({ path: join(out, '1-start.png') });
const hints: string[] = [];
const note = async () => {
  const t = await hint();
  if (t && hints[hints.length - 1] !== t) hints.push(t);
};
await note();

// Lay the lap.
const shots = new Set<number>();
const firstBoard = course.segments.findIndex((s) => s.end === 'board');
const firstApex = course.segments.findIndex((s) => s.end === 'apex');
const t0 = Date.now();
let taps = 0;
let braked = false;
let lanesBeforeBrake = false;
let brakeBeforeBoard = false;
for (let k = 0; k < plan.length; k++) {
  const want = plan[k].lane;
  for (let guard = 0; guard < 4; guard++) {
    const s = await state();
    if (s.armed === want) break;
    await tap(s.armed < want ? 'Right' : 'Left');
    if (!braked) lanesBeforeBrake = true;
    taps++;
  }
  const s = await state();
  if (s.armed !== want) {
    check(false, `segment ${k + 1}: could not arm lane ${want} (armed ${s.armed})`);
    break;
  }
  if ((k === firstBoard || k === firstApex || k === 1) && !shots.has(k)) {
    shots.add(k);
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(out, `2-segment-${k + 1}.png`) });
  }
  await tap(plan[k].pedal === 'gas' ? 'Gas' : 'Brake');
  if (plan[k].pedal === 'brake') {
    // The brake lesson waits for the first board segment after the gas lesson (segment 2 on).
    if (!braked && k < course.segments.findIndex((x, i) => i >= 1 && x.end === 'board')) brakeBeforeBoard = true;
    braked = true;
  }
  taps++;
  await note();
  const after = await state();
  if (after.picks.length !== (k + 1) * 2) {
    check(false, `segment ${k + 1}: the tap did not set it (${after.picks.length / 2} set)`);
    break;
  }
}
const laid = await state();
check(laid.review && laid.picks === encodePicks(plan), `the whole lap is laid as planned in ${taps} taps, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await page.waitForTimeout(800);
await note();
await page.screenshot({ path: join(out, '3-review.png') });
console.log('lessons seen:', hints);
// A lesson whose action the player already did before its moment is skipped
// (the careful plan often moves lanes on the first straight).
const order = ['Tap Gas', ...(brakeBeforeBoard ? [] : ['Tap Brake']), ...(lanesBeforeBrake ? [] : ['Left and Right']), 'Tap any segment'];
const seen = order.map((o) => hints.findIndex((t) => t.startsWith(o)));
check(seen.every((i) => i >= 0) && seen.every((i, j) => j === 0 || i > seen[j - 1]), `every lesson due shows, one at a time, in order (${order.join(' / ')}: ${seen.join(', ')})`);
check(!lanesBeforeBrake || !hints.some((t) => t.startsWith('Left and Right')), 'the gate lesson is skipped when Left or Right was already used');
check((await page.getByRole('button', { name: 'Race' }).isVisible()) && !(await page.getByRole('button', { name: 'Gas', exact: true }).isVisible()), 'the laid lap shows Race and hides the pad');

// Enter on a focused button presses that button; it does not start the race.
await page.locator('.sec-tyres [data-c="medium"]').focus();
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const afterEnter = await page.evaluate(() => ({ medium: document.querySelector('.sec-tyres [data-c="medium"]')?.classList.contains('is-on'), racing: !document.querySelector('.sec-review') }));
check(afterEnter.medium === true && !afterEnter.racing, 'Enter on a focused tyre picks that tyre and does not start the race');
await page.locator('.sec-tyres [data-c="soft"]').tap();

// Undo the last segment, then lay it again.
await page.locator('.sec-review .sec-undo').tap();
let s = await state();
check(!s.review && s.cursor === plan.length - 1 && s.picks.length === (plan.length - 1) * 2, 'Undo takes back the last segment');
check(s.armed === plan[plan.length - 1].lane, 'and reopens it with the gate it was set with');
await tap(plan[plan.length - 1].pedal === 'gas' ? 'Gas' : 'Brake');
s = await state();
check(s.review && s.picks === encodePicks(plan), 'laying it again lays the lap again');

// Change a laid segment by tapping it on the map, then put it back with Undo.
const target = firstApex >= 0 ? firstApex : 3;
await page.waitForTimeout(800);
const spot = await page.evaluate(
  ([v]) => {
    const scr = (window as unknown as { __pl: { app: { current: unknown } } }).__pl.app.current as { cam: { toScreen(x: number, y: number): { x: number; y: number } }; track: { x: Float64Array; y: Float64Array } };
    return scr.cam.toScreen(scr.track.x[v], scr.track.y[v]);
  },
  [Math.round((course.segments[target].v + (target ? course.segments[target - 1].v : 0)) / 2)],
);
await page.touchscreen.tap(spot.x, spot.y);
await page.waitForTimeout(600);
s = await state();
check(!s.review && s.cursor === target, `tapping segment ${target + 1} on the whole-lap map opens it (cursor ${s.cursor + 1})`);
await page.screenshot({ path: join(out, '4-change.png') });
const flipped = plan[target].pedal === 'gas' ? 'Brake' : 'Gas';
await tap(flipped);
s = await state();
check(s.picks[target * 2] === (flipped === 'Gas' ? 'g' : 'b') && s.cursor === target + 1 && !s.review, 'changing it sets the new pedal and walks on to the next segment');
await tap('Whole lap');
s = await state();
check(s.review, 'Whole lap goes back to the whole circuit');
await page.locator('.sec-review .sec-undo').tap();
await page.locator('.sec-review .sec-undo').isVisible();
s = await state();
if (!s.review) {
  await tap('Whole lap');
  s = await state();
}
check(s.picks === encodePicks(plan), 'Undo puts the changed segment back');

// Race it and read the time. Where the lap lost time is worked out in a
// worker meanwhile: the race must not stall for it.
await page.evaluate(() => {
  const w = window as unknown as { __longTasks: number[] };
  w.__longTasks = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) w.__longTasks.push(e.duration);
  }).observe({ type: 'longtask', buffered: false });
});
await tap('Race');
await page.waitForTimeout(1200);
await page.evaluate(() => ((window as unknown as { __longTasks: number[] }).__longTasks = []));
await page.waitForTimeout(8000);
const stalls = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
check(stalls.filter((d) => d > 100).length === 0, `the race runs without a main-thread stall over 100 ms while the analysis works (${stalls.length} long tasks, longest ${Math.round(Math.max(0, ...stalls))} ms)`);
await page.getByRole('button', { name: /skip/i }).click();
await page.waitForTimeout(4500);
await page.screenshot({ path: join(out, '5-results.png') });
const sheet = (await page.locator('.res-sheet').innerText()).replace(/\n+/g, ' | ');
console.log(sheet.slice(0, 260));
const shown = (await page.locator('#res-time').innerText()).trim();
check(shown === formatLap(expected), `the result (${shown}) is the headless sim of the same plan (${formatLap(expected)})`);
check(sheet.includes(process.env.EDITION === 'toybox' ? 'apart from Your times' : 'stay off the leaderboard'), 'the result says these laps are kept apart (off the leaderboard, or apart from Your times in the app)');
check(await page.getByRole('button', { name: 'Edit segments' }).isVisible(), 'the result offers Edit segments');

// The note says where the lap lost time once the analysis is done.
let coachNote = '';
for (let i = 0; i < 120; i++) {
  coachNote = (await page.locator('.res-notes p').innerText()).trim();
  if (!coachNote.startsWith('Working out')) break;
  await page.waitForTimeout(500);
}
const coachMs = await page.evaluate(
  ([sl, pk]) => (window as unknown as { __pl: { coachFor(s: string, p: string): { ms: number } | null } }).__pl.coachFor(sl, pk)?.ms ?? -1,
  [slug, encodePicks(plan)] as const,
);
console.log(`analysis took ${(coachMs / 1000).toFixed(1)} s: ${coachNote}`);
check(/^(Biggest gain: (Brake|Gas|Left gate|Middle gate|Right gate) in segment \d+ \([^)]+, sector [123]\), \d+\.\d\d s quicker\.|No single change makes this lap quicker\.)/.test(coachNote), 'the result names the biggest single change, where it is (turn and sector) and what it wins');
await page.screenshot({ path: join(out, '5-results-coached.png') });

// Edit segments opens the plan again, whole, with the segments that lost time marked.
await page.getByRole('button', { name: 'Edit segments' }).click();
await page.waitForTimeout(1200);
s = await state();
check(s.review && s.picks === encodePicks(plan), 'Edit segments opens the same plan on the whole circuit');
check(s.coached && s.tips.length > 0, `it marks the segments that lost time (${s.tips.length})`);
await page.screenshot({ path: join(out, '6-edit.png') });
if (s.tips.length) {
  // Another tyre: the tips stay, marked stale, while the lap is analysed on
  // it; then they are exact for that tyre. Back on the raced tyre they are
  // the raced ones again at once.
  const before = s.tips.length;
  const subtitle = async () => (await page.locator('.draw-title span').innerText()).trim();
  const coached = async (ms = 60000) => {
    for (let t = 0; t < ms; t += 250) {
      const x = await state();
      if (x.coached) return x;
      await page.waitForTimeout(250);
    }
    return state();
  };
  await page.locator('.sec-tyres [data-c="medium"]').tap();
  const staleOnMedium = await state();
  const subMedium = await subtitle();
  check(staleOnMedium.tips.length > 0 && staleOnMedium.tips.every((x) => x.stale) && subMedium === 'Updating where it loses time', `another tyre keeps the tips, marked stale, while it updates ("${subMedium}", ${staleOnMedium.tips.length})`);
  const onMedium = await coached();
  check(onMedium.coached && onMedium.tips.every((x) => !x.stale) && (await subtitle()) === 'Tap an orange segment to find time', `then they are worked out for that tyre (${onMedium.tips.length})`);
  await page.locator('.sec-tyres [data-c="soft"]').tap();
  await page.waitForTimeout(150);
  const backOnSoft = await state();
  check(backOnSoft.coached && backOnSoft.tips.length === before, `back on the raced tyre the raced tips are back at once (${before}, ${backOnSoft.tips.length})`);
  // Take the biggest tip: tap its label on the map, read the tip, make the change.
  const tip = s.tips[0];
  await page.waitForTimeout(300);
  const labels = await page.evaluate(() => (window as unknown as { __pl: { app: { current: { gainLabels: { x: number; y: number; w: number; h: number; segment: number }[] } } } }).__pl.app.current.gainLabels);
  const label = labels.find((b) => b.segment === tip.segment)!;
  check(!!label && labels.length === Math.min(3, s.tips.length), `the biggest gains are labelled on the map (${labels.length})`);
  const overlap = labels.some((a, i) => labels.some((b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h));
  check(!overlap, 'no two labels overlap');
  await page.touchscreen.tap(label.x + label.w / 2, label.y + label.h / 2);
  await page.waitForTimeout(600);
  s = await state();
  check(s.cursor === tip.segment, `tapping the biggest gain's label opens its segment (segment ${tip.segment + 1})`);
  const said = await hint();
  const secs = (tip.gain / 1000).toFixed(2);
  check(said === `${tip.action} here: ${secs} s quicker.`, `it says what to change there: "${said}"`);
  await page.screenshot({ path: join(out, '7-tip.png') });
  if (tip.lane !== undefined) {
    for (let guard = 0; guard < 4 && (await state()).armed !== tip.lane; guard++) await tap((await state()).armed < tip.lane ? 'Right' : 'Left');
    await tap(plan[tip.segment].pedal === 'gas' ? 'Gas' : 'Brake');
  } else {
    await tap(tip.pedal === 'gas' ? 'Gas' : 'Brake');
  }
  await tap('Whole lap');
  s = await state();
  const sub = await subtitle();
  check(s.tips.length > 0 && s.tips.every((x) => x.stale && x.segment !== tip.segment) && sub === 'Updating where it loses time', `after a change the other tips stay, marked stale, while it updates ("${sub}", ${s.tips.length})`);
  s = await coached();
  check(s.coached && s.tips.every((x) => !x.stale) && (await subtitle()) === 'Tap an orange segment to find time', `then the changed lap is worked out again (${s.tips.length} tips)`);
  await page.locator('.sec-review .sec-undo').tap();
  await page.waitForTimeout(150);
  s = await state();
  check(s.coached && s.tips.length === before, 'Undo back to the raced plan brings its tips back at once');
  await page.locator('.sec-review .sec-undo').tap().catch(() => {});
  // Redo the change (Undo stepped back through it) and race it.
  s = await state();
  if (s.review) {
    await page.touchscreen.tap(label.x + label.w / 2, label.y + label.h / 2);
    await page.waitForTimeout(500);
  }
  if (tip.lane !== undefined) {
    for (let guard = 0; guard < 4 && (await state()).armed !== tip.lane; guard++) await tap((await state()).armed < tip.lane ? 'Right' : 'Left');
    await tap(plan[tip.segment].pedal === 'gas' ? 'Gas' : 'Brake');
  } else {
    await tap(tip.pedal === 'gas' ? 'Gas' : 'Brake');
  }
  await tap('Whole lap');
  await tap('Race');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /skip/i }).click();
  await page.waitForTimeout(4500);
  const again = (await page.locator('#res-time').innerText()).trim();
  check(again === formatLap(expected - tip.gain), `taking the tip wins exactly what it said: ${again} (${formatLap(expected)} less ${secs} s)`);
  await page.screenshot({ path: join(out, '8-after-tip.png') });
  // That lap gets its own analysis.
  let second = '';
  for (let i = 0; i < 120; i++) {
    second = (await page.locator('.res-notes p').innerText()).trim();
    if (!second.startsWith('Working out')) break;
    await page.waitForTimeout(500);
  }
  check(/^(Biggest gain|No single change)/.test(second) && second !== coachNote, `the new lap gets its own analysis: ${second.slice(0, 80)}`);
}

// A rough lap (gas nearly everywhere) loses time in many neighbouring
// segments: the time labels on the whole track must never sit on each other,
// and must stay on the free part of the screen.
{
  await page.getByRole('button', { name: 'Draw again' }).click();
  await page.waitForTimeout(900);
  await page.evaluate(`(() => { const s = window.__pl.app.current; for (let i = 0; i < 200 && !s.state.review; i++) s.press(i % 9 === 4 ? 'brake' : 'gas'); })()`);
  await page.waitForTimeout(800);
  await tap('Race');
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: /skip/i }).click();
  for (let i = 0; i < 120; i++) {
    if (!(await page.locator('.res-notes p').innerText()).trim().startsWith('Working out')) break;
    await page.waitForTimeout(500);
  }
  await page.getByRole('button', { name: 'Edit segments' }).click();
  await page.waitForTimeout(1300);
  const rough = await page.evaluate(() => (window as unknown as { __pl: { app: { current: { gainLabels: { x: number; y: number; w: number; h: number }[] } } } }).__pl.app.current.gainLabels);
  const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const bar = await page.locator('.sec-review').boundingBox();
  check(rough.length === 3 && !rough.some((a, i) => rough.some((b, j) => i < j && hit(a, b))), `a rough lap's time labels never overlap (${rough.length} labels)`);
  check(rough.every((l) => l.x >= 0 && l.x + l.w <= 390 && l.y >= 96 && l.y + l.h <= (bar?.y ?? 844)), 'and stay between the top bar and the bottom bar');
  await page.screenshot({ path: join(out, '9-rough.png') });
}

// A fresh player who keeps to the middle until they first brake is shown the
// gate lesson at the first corner. Timed with the CPU slowed four times, as a
// stand-in for a phone.
{
  const fresh = await ctx.browser()!.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await fresh.newPage();
  p2.on('pageerror', (e) => failures.push(`page error: ${e.message}`));
  await p2.addInitScript((sl) => {
    localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, tutorial: 'done', lastTrack: sl, sound: false, segments: true, panCoachSeen: true }));
  }, slug);
  await p2.goto(`${url}?debug`);
  await p2.waitForTimeout(900);
  await p2.getByRole('button', { name: 'Draw a lap' }).click();
  await p2.waitForTimeout(900);
  const cdp = await fresh.newCDPSession(p2);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const seen2: string[] = [];
  const times: number[] = [];
  const timed = (k: string) =>
    p2.evaluate((key) => {
      const scr = (window as unknown as { __pl: { app: { current: { press(k: string): void } } } }).__pl.app.current;
      const a = performance.now();
      scr.press(key);
      return performance.now() - a;
    }, k);
  // Pedals only (no lane moves) for the whole lap, so the gate lesson stays due.
  for (let k = 0; k < plan.length; k++) {
    const t = await p2.evaluate(() => {
      const el = document.querySelector('.draw-hint');
      return el && !el.classList.contains('is-hidden') ? el.textContent ?? '' : '';
    });
    if (t && seen2[seen2.length - 1] !== t) seen2.push(t);
    times.push(await timed(plan[k].pedal));
  }
  // Changing a laid lap solves the whole lap on every press.
  await p2.evaluate(() => (window as unknown as { __pl: { app: { current: { openSegment(k: number): void } } } }).__pl.app.current.openSegment(4));
  const edits = [await timed('left'), await timed('right'), await timed('gas')];
  check(seen2.some((x) => x.startsWith('Left and Right')), `a player who has not used Left or Right gets the gate lesson at the first corner (${seen2.join(' / ')})`);
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)];
  const worst = times[times.length - 1];
  console.log(`laying a segment at 4x CPU slowdown: median ${p50.toFixed(0)} ms, worst ${worst.toFixed(0)} ms over ${times.length}; changing a laid lap: ${edits.map((x) => x.toFixed(0)).join(', ')} ms`);
  check(p50 < 60 && worst < 400, 'laying a segment stays quick with the CPU slowed four times (median under 60 ms; the last, which solves the whole lap, under 400 ms)');
  check(Math.max(...edits) < 600, 'changing a laid lap answers in under 600 ms with the CPU slowed four times');
  await fresh.close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('\nall passed');
