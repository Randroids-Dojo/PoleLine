// Checks settings migration (scroll speed default), grass panning, the
// recenter button, flick momentum and fading tips. Dev server must be running.
//   npx tsx scripts/pantest.ts
import { chromium } from 'playwright-core';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
// Simulate a player from before this change: v1 settings with an implicit 1x speed.
await p.addInitScript(() => {
  if (!localStorage.getItem('seeded')) {
    localStorage.setItem('poleline:v1:settings', JSON.stringify({ sound: false, tutorialDone: true, lastTrack: 'spielberg', attempts: 0, scrollMode: 'pause', scrollSpeed: 1, keepAwake: true }));
    localStorage.setItem('seeded', '1');
  }
});
await p.goto('http://localhost:5199/');
await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Settings' }).click();
await p.waitForTimeout(300);
console.log('speed after migration:', await p.locator('.set-value').innerText());
await p.getByRole('button', { name: 'Close settings' }).click();
await p.waitForTimeout(300);
await p.getByRole('button', { name: 'Draw a lap' }).click();
await p.waitForTimeout(800);
const cur = `window.__pl.app.current`;
const startScreen = () => p.evaluate(`(() => { const t = ${cur}.track; return ${cur}.worldToScreen(t.x[0], t.y[0]); })()`) as Promise<{ x: number; y: number }>;
const s0 = await startScreen();
console.log('hint visible at start:', !(await p.locator('.draw-hint').evaluate((e) => e.classList.contains('is-hidden'))));
// Drag on the asphalt away from the start line: should not pan.
const onTrack = await p.evaluate(`(() => { const t = ${cur}.track; return ${cur}.worldToScreen(t.x[60], t.y[60]); })()`) as { x: number; y: number };
await p.mouse.move(onTrack.x, onTrack.y); await p.mouse.down(); await p.mouse.move(onTrack.x + 60, onTrack.y + 120, { steps: 6 }); await p.mouse.up();
const s1 = await startScreen();
console.log('drag on asphalt moved map:', Math.hypot(s1.x - s0.x, s1.y - s0.y).toFixed(1), 'px');
// Drag on the grass: should pan by the same amount.
await p.mouse.move(40, 420); await p.mouse.down(); await p.mouse.move(60, 220, { steps: 10 }); await p.waitForTimeout(150); await p.mouse.up();
const s2 = await startScreen();
console.log('drag on grass moved map:', (s2.x - s1.x).toFixed(1), (s2.y - s1.y).toFixed(1), '(finger moved 20, -200)');
// Big pan so the start is off screen, then check the recenter button.
for (let i = 0; i < 3; i++) { await p.mouse.move(40, 700); await p.mouse.down(); await p.mouse.move(40, 160, { steps: 10 }); await p.waitForTimeout(120); await p.mouse.up(); }
await p.waitForTimeout(200);
const rb = p.locator('.recenter');
console.log('recenter shown when start is off screen:', !(await rb.evaluate((e) => e.classList.contains('is-hidden'))));
await p.screenshot({ path: '/tmp/pan-off.png' });
await rb.click(); await p.waitForTimeout(700);
const s3 = await startScreen();
console.log('after recenter, start back near original:', Math.hypot(s3.x - s0.x, s3.y - s0.y).toFixed(1), 'px; button hidden:', await rb.evaluate((e) => e.classList.contains('is-hidden')));
// Flick for momentum.
await p.mouse.move(40, 600); await p.mouse.down(); await p.mouse.move(40, 450, { steps: 3 }); await p.mouse.up();
const m0 = await startScreen(); await p.waitForTimeout(400); const m1 = await startScreen();
console.log('momentum carried the map after release:', Math.hypot(m1.x - m0.x, m1.y - m0.y).toFixed(1), 'px');
await p.getByRole('button', { name: 'Back to the tip' }).click().catch(() => {});
await p.waitForTimeout(5000);
console.log('hint faded after a moment:', await p.locator('.draw-hint').evaluate((e) => e.classList.contains('is-hidden')));
await b.close();
