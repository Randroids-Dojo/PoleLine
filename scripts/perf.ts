// Frame-time and simulation-cost probe under 4x CPU throttling (dev server running).
//   npx tsx scripts/perf.ts
import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem('poleline:v1:settings', JSON.stringify({ lastTrack: 'silverstone', sound: false })));
await page.goto('http://localhost:5199/');
await page.waitForTimeout(600);
const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const measure = () => page.evaluate(`new Promise((resolve) => {
  const d = []; let last = performance.now(); let n = 0;
  function f(t) { d.push(t - last); last = t; if (++n < 150) requestAnimationFrame(f); else { d.sort((a, b) => a - b); resolve('median ' + d[75].toFixed(1) + 'ms p95 ' + d[142].toFixed(1) + 'ms max ' + d[149].toFixed(1) + 'ms'); } }
  requestAnimationFrame(f);
})`);
await page.getByRole('button', { name: 'Draw a lap' }).click();
await page.waitForTimeout(800);
console.log('draw idle (4x throttle):', await measure());
// Time the lap simulation itself under throttle.
const simMs = (await page.evaluate(`(async () => {
  const mod = await import('/src/sim/lapsim.ts');
  const t = await window.__pl.app.track('silverstone');
  const pts = new Float64Array(t.n * 2 + 2);
  for (let i = 0; i < t.n; i++) { pts[i * 2] = Math.round(t.x[i] * 10) / 10; pts[i * 2 + 1] = Math.round(t.y[i] * 10) / 10; }
  pts[t.n * 2] = pts[0]; pts[t.n * 2 + 1] = pts[1];
  const t0 = performance.now();
  mod.simulateLap(t, pts, 'soft');
  return performance.now() - t0;
})()`)) as number;
console.log(`simulateLap under 4x throttle: ${simMs.toFixed(0)}ms`);
// Race frames: start a race through the app's own flow with the centreline as the line.
await page.evaluate(`(async () => {
  const t = await window.__pl.app.track('silverstone');
  const pts = [];
  for (let i = 0; i < t.n; i += 1) pts.push(Math.round(t.x[i] * 10), Math.round(t.y[i] * 10));
  pts.push(pts[0], pts[1]);
  window.__pl.race(t, 'soft', pts);
})()`);
await page.waitForTimeout(3000);
console.log('race (4x throttle):', await measure());
await browser.close();
