// Editing a saved line, in the browser, in every drawing mode: the picker from
// home, the whole-lap view and a tap to zoom in, then a redraw from the middle
// of the lap that first strays from the old line (and must not rejoin it) and
// then runs back onto it (and must). Checks that the line before the cut and
// after the join is the saved line point for point, that the join has no kink,
// that the old line never blinks out while a tidied stroke settles, that undo
// takes the change back, that a back swipe keeps the edit, and that the edited
// line races and can be edited again from the results. Prints PASS or FAIL per
// check and exits non-zero on any failure.
//
//   npx tsx scripts/edittest.ts [slug] [outDir] [url] [modes]
//   EDITION=toybox npx tsx scripts/edittest.ts harbour-loop /tmp/edit http://localhost:5299/
// The web edition is seeded with a personal best only (as players had before
// laps were kept); the Toybox edition with a saved lap in the older unpacked form.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import { simulateLap } from '../src/sim/lapsim.js';
import { decodePath, encodePath, validatePath } from '../src/sim/path.js';
import { buildTrack, frameAt } from '../src/sim/track.js';
import { SIM_VERSION } from '../src/sim/version.js';
import { minCurvatureOffsets, offsetsToLine, wobble } from './optimal.js';

const TOYBOX = process.env.EDITION === 'toybox';
const DATA = TOYBOX ? '../src/data/toybox' : '../src/data';
const { CATALOG } = (await import(`${DATA}/catalog.ts`)) as typeof import('../src/data/catalog.js');

const slug = process.argv[2] ?? (TOYBOX ? 'harbour-loop' : 'spielberg');
const out = process.argv[3] ?? '/tmp/poleline-edit';
const url = process.argv[4] ?? 'http://localhost:5199/';
const modes = (process.argv[5] ?? 'freehand,smooth,curves').split(',');
mkdirSync(out, { recursive: true });

const meta = CATALOG.find((m) => m.slug === slug)!;
const track = buildTrack(meta, (await import(`${DATA}/geometry/${slug}.ts`)).default as number[]);
const L = track.length;

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) failures++;
};

// The saved lap: a hand-like wobble on the racing line.
const best = minCurvatureOffsets(track);
const alpha = wobble(track, best, 3, 0.9, 50, 0.1);
const saved = offsetsToLine(track, alpha);
const savedCode = encodePath(saved);
const savedLap = simulateLap(track, decodePath(savedCode), 'soft');
const lapRecord = { timeMs: savedLap.timeMs, compound: 'soft', sectorsMs: savedLap.sectorsMs, code: savedCode, date: '2026-10-20T10:00:00.000Z' };

type V = { x: number; y: number };
/** Sideways offset of the saved line (or another set of offsets) at lap distance s (metres). */
function lateral(s: number, of: Float64Array = alpha): number {
  const w = ((s % L) + L) % L;
  let lo = 0;
  let hi = track.n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.s[mid] <= w) lo = mid;
    else hi = mid - 1;
  }
  const i = lo;
  const j = (i + 1) % track.n;
  const span = (j === 0 ? L : track.s[j]) - track.s[i];
  const u = span > 0 ? (w - track.s[i]) / span : 0;
  return of[i] + (of[j] - of[i]) * u;
}
/** A point `off` metres to the side of the saved line at lap distance s, kept inside the white lines. */
function beside(s: number, off: number): V {
  const f = frameAt(track, s);
  const lim = track.limit - 0.7;
  const d = Math.max(-lim, Math.min(lim, lateral(s) + off));
  return { x: f.x + f.nx * d, y: f.y + f.ny * d };
}
const smooth = (u: number) => {
  const k = Math.max(0, Math.min(1, u));
  return k * k * (3 - 2 * k);
};
/** Which side has room to stray towards at lap distance s. */
const roomSide = (s: number) => (lateral(s) > 0 ? -1 : 1);

/** Lap progress of each saved point, to find where things happened. */
function progressOf(pts: number[]): number[] {
  const out: number[] = [];
  let best = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i] / 10;
    const y = pts[i + 1] / 10;
    let k = 0;
    let d = Infinity;
    for (let v = 0; v < track.n; v++) {
      const dd = (track.x[v] - x) ** 2 + (track.y[v] - y) ** 2;
      if (dd < d) {
        d = dd;
        k = v;
      }
    }
    let s = track.s[k];
    if (i === 0 && s > L / 2) s -= L;
    if (i > 0 && s < best - L / 2) s += L;
    best = Math.max(best, s);
    out.push(s);
  }
  return out;
}

/** The biggest change of heading (degrees) between 3 m steps of a line, within lap distances [from, to]. */
function maxTurn(pts: number[], prog: number[], from: number, to: number): number {
  const steps: V[] = [];
  for (let i = 0; i < prog.length; i++) {
    if (prog[i] < from || prog[i] > to) continue;
    const p = { x: pts[i * 2] / 10, y: pts[i * 2 + 1] / 10 };
    const l = steps[steps.length - 1];
    if (!l || Math.hypot(p.x - l.x, p.y - l.y) >= 3) steps.push(p);
  }
  let worst = 0;
  for (let i = 2; i < steps.length; i++) {
    const a = Math.atan2(steps[i - 1].y - steps[i - 2].y, steps[i - 1].x - steps[i - 2].x);
    const b = Math.atan2(steps[i].y - steps[i - 1].y, steps[i].x - steps[i - 1].x);
    worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
  }
  return (worst * 180) / Math.PI;
}

type EditState = { cut: number | null; joinable: boolean; pendingJoin: number | null; overview: boolean; changes: number; edited: boolean; points: number } | null;
const browser = await chromium.launch();

async function open(drawMode: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => check('no page errors', false, e.message));
  await page.addInitScript(
    ([s, d, lap, v, toybox]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.clear();
      localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, tutorial: 'done', lastTrack: s, sound: false, drawMode: d, panCoachSeen: true }));
      localStorage.setItem(`poleline:v1:pb:${s}`, JSON.stringify({ ...(lap as object), v, submitted: true }));
      if (toybox) localStorage.setItem(`poleline:v1:laps:v${v}:${s}`, JSON.stringify([lap]));
    },
    [slug, drawMode, lapRecord, SIM_VERSION, TOYBOX] as const,
  );
  await page.goto(url);
  await page.waitForTimeout(900);
  return page;
}

const api = (page: Page) => ({
  get: <T>(k: string) => page.evaluate((key) => (window as unknown as { __pl: { app: { current: Record<string, unknown> } } }).__pl.app.current[key], k) as Promise<T>,
  edit: () => page.evaluate(() => (window as unknown as { __pl: { app: { current: { editState: EditState } } } }).__pl.app.current.editState),
  toScreen: (p: V) => page.evaluate(([x, y]) => (window as unknown as { __pl: { app: { current: { worldToScreen(x: number, y: number): V } } } }).__pl.app.current.worldToScreen(x, y), [p.x, p.y]),
  line: () => page.evaluate(() => Array.from((window as unknown as { __pl: { app: { current: { builder: { points: number[] } } } } }).__pl.app.current.builder.points)),
  /** Is there ink at this screen point (purple, within a few pixels)? */
  inkAt: (p: V) =>
    page.evaluate(([x, y]) => {
      const app = (window as unknown as { __pl: { app: { ctx: CanvasRenderingContext2D; dpr: number } } }).__pl.app;
      const r = 3 * app.dpr;
      const d = app.ctx.getImageData(Math.round(x * app.dpr - r), Math.round(y * app.dpr - r), r * 2, r * 2).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 110 && d[i + 2] > 190 && d[i + 1] < 120) return true;
      return false;
    }, [p.x, p.y]),
});

async function settle(page: Page): Promise<void> {
  const t0 = Date.now();
  while (await api(page).get<boolean>('isGliding')) {
    if (Date.now() - t0 > 5000) break;
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(60);
}

/** Drag through world points with real pointer events. */
async function stroke(page: Page, pts: V[], lift = true): Promise<void> {
  const a = api(page);
  const first = await a.toScreen(pts[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of pts.slice(1)) {
    const sp = await a.toScreen(p);
    await page.mouse.move(sp.x, sp.y);
  }
  if (lift) await page.mouse.up();
}

async function tap(page: Page, p: V): Promise<void> {
  const sp = await api(page).toScreen(p);
  await page.mouse.click(sp.x, sp.y);
  await page.waitForTimeout(60);
}

/** Open the saved line from home through the picker, then zoom in at lap distance s. */
async function openEditor(page: Page, name: string, s: number): Promise<void> {
  const a = api(page);
  const btn = page.getByRole('button', { name: 'Edit a saved line' });
  check(`${name}: home offers to edit a saved line`, await btn.isVisible());
  await btn.click();
  await page.waitForTimeout(400);
  const rows = await page.locator('.board-open').count();
  check(`${name}: the picker lists the saved line`, rows === 1, `${rows} rows`);
  await page.screenshot({ path: join(out, `${name}-1-picker.png`) });
  await page.locator('.board-open').first().click();
  await page.waitForTimeout(900);
  const st = await a.edit();
  check(`${name}: the editor opens on the whole lap`, !!st && st.overview && st.cut === null && st.points === saved.length / 2, JSON.stringify(st));
  await page.screenshot({ path: join(out, `${name}-2-overview.png`) });
  await tap(page, beside(s, 0));
  await settle(page);
  check(`${name}: a tap zooms in`, (await a.edit())?.overview === false);
}

/** Lap distance where the redraw starts, and the plan of the two strokes (or curves) after it. */
const s0 = Math.round(L * 0.3);
/** Where 90 m of the racing line gains most on the saved line: the corner worth fixing. */
const s1 = (() => {
  let at = s0;
  let gain = -Infinity;
  for (let s = 200; s < L - 300; s += 60) {
    const mix = Float64Array.from(alpha, (a, i) => {
      const u = smooth((track.s[i] - s) / 10) * (1 - smooth((track.s[i] - s - 80) / 10));
      return a + (best[i] - a) * u;
    });
    const t = simulateLap(track, decodePath(encodePath(offsetsToLine(track, mix))), 'soft').timeMs;
    if (savedLap.timeMs - t > gain) {
      gain = savedLap.timeMs - t;
      at = s;
    }
  }
  console.log(`  the racing line gains ${(gain / 1000).toFixed(3)} s from ${at} m`);
  return at;
})();
const side = roomSide(s0 + 40);
const out1 = (s: number) => 3.2 * side * smooth((s - s0) / 18);
const back2 = (s: number) => 3.2 * side * (1 - smooth((s - s0 - 50) / 28));

/** The edit is in: the line is whole, the saved line before the cut and after the join, and smooth across the join. */
async function checkSplice(page: Page, name: string, cut: number): Promise<number[]> {
  const a = api(page);
  const st = await a.edit();
  check(`${name}: the line is whole again`, !!st && st.cut === null && st.changes === 1 && st.edited && (await a.get<string>('status')) === 'done', JSON.stringify(st));
  const line = await a.line();
  check(`${name}: the edited line passes the server's checks`, validatePath(track, decodePath(encodePath(line))).ok);
  let same = 0;
  while (same < saved.length && line[same] === saved[same]) same++;
  check(`${name}: the line up to the cut is the saved line`, same >= (cut + 1) * 2, `${same / 2} points match, cut at ${cut}`);
  // The last point can be trimmed afresh where the line crosses the finish.
  let tail = 0;
  while (tail < Math.min(line.length, saved.length) - 2 && line[line.length - 3 - tail] === saved[saved.length - 3 - tail]) tail++;
  const progS = progressOf(saved);
  // The first whole point of the saved line that the edited line ends with.
  const joinAt = progS[Math.min(progS.length - 1, Math.ceil((saved.length - 2 - tail) / 2))];
  check(`${name}: the rest of the lap is the saved line`, joinAt < s0 + 140, `the saved line resumes at ${joinAt.toFixed(0)} m (redraw from ${s0} m)`);
  const progN = progressOf(line);
  const turnNew = maxTurn(line, progN, joinAt - 25, joinAt + 25);
  const turnOld = maxTurn(saved, progS, joinAt - 25, joinAt + 25);
  check(`${name}: no kink where it rejoins`, turnNew < Math.max(14, turnOld * 1.6), `${turnNew.toFixed(1)}° per 3 m step (the saved line: ${turnOld.toFixed(1)}°)`);
  return line;
}

for (const mode of modes) {
  const name = `${TOYBOX ? 'toybox ' : ''}${mode}`;
  const page = await open(mode);
  const a = api(page);
  await openEditor(page, name, s0);
  await page.screenshot({ path: join(out, `${name}-3-zoomed.png`) });

  let cut = -1;
  if (mode === 'curves') {
    // Touch the line to start, then lay curves out wide.
    await tap(page, beside(s0, 0));
    const st = await a.edit();
    cut = st?.cut ?? -1;
    check(`${name}: touching the line starts a redraw there`, st?.cut !== null && st?.cut !== undefined, JSON.stringify(st));
    await tap(page, beside(s0 + 25, out1(s0 + 25)));
    await tap(page, beside(s0 + 50, out1(s0 + 50)));
    // A tap on the old line snaps the curve onto it, ready to rejoin.
    await tap(page, beside(s0 + 80, 0));
    let pj = (await a.edit())?.pendingJoin;
    check(`${name}: a curve ended on the old line snaps onto it`, pj !== null && pj !== undefined);
    check(`${name}: its button says Rejoin`, (await page.locator('.draw-set:not([hidden])').first().textContent()) === 'Rejoin');
    await page.screenshot({ path: join(out, `${name}-4-snapped.png`) });
    // Tapping further on carries on past the old line instead of rejoining it.
    await tap(page, beside(s0 + 105, back2(s0 + 105) * 0.4 + 1.6 * side));
    const after = await a.edit();
    check(`${name}: tapping further on does not rejoin`, after?.cut !== null && after?.changes === 0, JSON.stringify(after));
    await tap(page, beside(s0 + 135, 0));
    pj = (await a.edit())?.pendingJoin;
    check(`${name}: a later curve snaps onto the old line again`, pj !== null && pj !== undefined);
    await page.getByRole('button', { name: 'Rejoin' }).click();
    await page.waitForTimeout(120);
  } else {
    // Stroke 1 strays from the old line and lifts away from it: no rejoin.
    const p1: V[] = [];
    for (let s = s0; s <= s0 + 40; s += 0.8) p1.push(beside(s, out1(s)));
    await stroke(page, p1.slice(0, 2), false);
    const st = await a.edit();
    cut = st?.cut ?? -1;
    check(`${name}: touching the line starts a redraw there`, cut >= 0, JSON.stringify(st));
    for (const p of p1.slice(2)) {
      const sp = await a.toScreen(p);
      await page.mouse.move(sp.x, sp.y);
    }
    await page.mouse.up();
    const st1 = await a.edit();
    check(`${name}: a stroke that ends off the old line does not rejoin it`, st1?.cut === cut && st1?.changes === 0, JSON.stringify(st1));
    await page.waitForTimeout(400);
    await settle(page);
    // Stroke 2 runs back onto the old line and lifts on it: rejoin.
    const tip = (await a.get<V>('tip'))!;
    const p2: V[] = [tip];
    for (let s = s0 + 41; s <= s0 + 92; s += 0.8) p2.push(beside(s, back2(s)));
    await stroke(page, p2, false);
    check(`${name}: on the old line it offers to rejoin`, (await a.edit())?.joinable === true);
    // Where the old line runs on, 20 m past the lift: it must stay inked through the join.
    const ahead = beside(s0 + 112, 0);
    await page.mouse.up();
    const inked: boolean[] = [];
    for (const ms of [10, 90, 170, 260, 400]) {
      await page.waitForTimeout(ms === 10 ? 10 : 80);
      inked.push(await a.inkAt(await a.toScreen(ahead)));
    }
    check(`${name}: the old line ahead stays inked while it rejoins`, inked.every(Boolean), inked.map((k) => (k ? 'ink' : 'gap')).join(' '));
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}-5-rejoined.png`) });
  const edited = await checkSplice(page, name, cut);
  const lap = simulateLap(track, decodePath(encodePath(edited)), 'soft');
  console.log(`  ${name}: ${(savedLap.timeMs / 1000).toFixed(3)} s saved, ${(lap.timeMs / 1000).toFixed(3)} s edited`);

  // Undo takes the whole change back; then do it again.
  if (mode === 'freehand') {
    await page.getByRole('button', { name: 'Undo last stroke' }).click();
    await page.waitForTimeout(100);
    const st = await a.edit();
    const back = await a.line();
    check(`${name}: undo takes the change back`, st?.changes === 0 && !st.edited && back.length === saved.length && back.every((v, i) => v === saved[i]), JSON.stringify(st));
    check(`${name}: with nothing to undo, undo and restart are off`, (await page.getByRole('button', { name: 'Undo last stroke' }).isDisabled()) && (await page.getByRole('button', { name: 'Back to the saved line' }).isDisabled()));
    // Touch the line and lift at once: a redraw waits at the tip; undo gives it up.
    await page.getByRole('button', { name: 'Whole lap' }).click();
    await settle(page);
    check(`${name}: Whole lap zooms back out`, (await a.edit())?.overview === true);
    await tap(page, beside(s0 + 200, 0));
    await settle(page);
    await tap(page, beside(s0 + 200, 0));
    const waiting = await a.edit();
    check(`${name}: a tap on the line waits to redraw from there`, waiting?.cut !== null && (await a.get<string>('status')) === 'drawing', JSON.stringify(waiting));
    // A tap elsewhere on the line, before anything is redrawn, moves the start.
    await tap(page, beside(s0 + 180, 0));
    const moved = await a.edit();
    check(`${name}: a tap elsewhere on the line moves where the redraw starts`, moved?.cut !== null && waiting?.cut !== null && moved!.cut! < waiting!.cut!, `${waiting?.cut} to ${moved?.cut}`);
    await page.getByRole('button', { name: 'Undo last stroke' }).click();
    await page.waitForTimeout(100);
    check(`${name}: undo gives up a redraw with nothing drawn`, (await a.edit())?.cut === null && (await a.get<string>('status')) === 'done');
    // Again, along the racing line where it gains most, which should make a new best.
    await settle(page);
    const p: V[] = [];
    for (let s = s1; s <= s1 + 92; s += 0.8) p.push(beside(s, (lateral(s, best) - lateral(s)) * smooth((s - s1) / 10) * (1 - smooth((s - s1 - 80) / 10))));
    await page.getByRole('button', { name: 'Whole lap' }).click();
    await settle(page);
    await tap(page, beside(s1, 0));
    await settle(page);
    await stroke(page, p.filter((_, i) => i < 52));
    await settle(page);
    const tip = (await a.get<V>('tip'))!;
    await stroke(page, [tip, ...p.slice(52)]);
    await page.waitForTimeout(400);
    check(`${name}: the redraw goes back in`, (await a.edit())?.changes === 1);
    const t = simulateLap(track, decodePath(encodePath(await a.line())), 'soft').timeMs;
    console.log(`  ${name}: ${(t / 1000).toFixed(3)} s along the racing line`);
  }

  // A stray back swipe keeps the edit.
  await page.evaluate(() => history.back());
  await page.waitForTimeout(400);
  // Only the editor has an edit state (class names are minified in a production build).
  check(`${name}: a back swipe keeps the edited line`, (await a.edit())?.edited === true);

  // Race it.
  const before = await a.line();
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  const raced = await page.getByRole('button', { name: /skip/i }).waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(`${name}: Race runs the edited line`, raced);
  await page.getByRole('button', { name: /skip/i }).click();
  await page.locator('.res-sheet').waitFor({ timeout: 8000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}-6-results.png`) });
  const kept = await page.evaluate(([s, v]) => JSON.parse(localStorage.getItem(`poleline:v1:laps:v${v}:${s}`) ?? '[]').length, [slug, SIM_VERSION] as const);
  check(`${name}: the edited lap is kept with the saved one, once`, kept === 2, `${kept} laps kept`);
  const racedTime = simulateLap(track, decodePath(encodePath(before)), 'soft').timeMs;
  if (racedTime < savedLap.timeMs) check(`${name}: a quicker edit is a new personal best`, ((await page.locator('.res-delta').first().textContent()) ?? '').startsWith('New personal best'));
  const editBtn = page.getByRole('button', { name: 'Edit line' });
  check(`${name}: the results offer to edit the line`, await editBtn.isVisible());
  await editBtn.click();
  await page.waitForTimeout(900);
  const again = await a.edit();
  const reopened = await a.line();
  check(`${name}: it reopens the line just raced`, !!again && again.cut === null && reopened.length === before.length && reopened.every((v, i) => v === before[i]));
  // Raced again unchanged: when that line is not your best, the results also give the gap to the line you edited.
  const editedTime = simulateLap(track, decodePath(encodePath(before)), 'soft').timeMs;
  await page.getByRole('button', { name: 'Race', exact: true }).click();
  await page.getByRole('button', { name: /skip/i }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: /skip/i }).click();
  await page.locator('.res-sheet').waitFor({ timeout: 8000 });
  const note = (await page.locator('.res-edit').textContent().catch(() => null)) ?? null;
  if (editedTime > savedLap.timeMs) check(`${name}: the results give the gap to the line you edited`, note === '±0.000 to the line you edited', String(note));
  else check(`${name}: an edit of your best says nothing extra`, note === null, String(note));
  await page.context().close();
}

await browser.close();
console.log(failures ? `${failures} failed` : 'all passed');
process.exit(failures ? 1 : 0);
