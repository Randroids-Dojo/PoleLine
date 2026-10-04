// Checks the compass (tap through N/E/S/W, drag to any angle, Auto pill), the
// one-time grass-drag coach mark and the Settings button on the track-limits
// card. Dev server must be running.
//   npx tsx scripts/compasstest.ts
import { chromium } from 'playwright-core';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.addInitScript(() => localStorage.setItem('poleline:v1:settings', JSON.stringify({ v: 2, sound: false, lastTrack: 'silverstone' })));
await p.goto('http://localhost:5199/');
await p.waitForTimeout(600);
await p.getByRole('button', { name: 'Draw a lap' }).click();
await p.waitForTimeout(900);
const cur = 'window.__pl.app.current';
const bearing = async () => {
  const a = (await p.evaluate(`${cur}.mapAngle`)) as number;
  return ((((-a * 180) / Math.PI) % 360) + 360) % 360;
};
const auto = () => p.locator('.compass-auto').evaluate((e) => e.classList.contains('is-on'));
console.log('start: bearing at top', (await bearing()).toFixed(1), 'auto on:', await auto());
await p.screenshot({ path: '/tmp/cmp-0.png' });
const rose = p.locator('.compass-btn');
const seq: string[] = [];
for (let i = 0; i < 5; i++) {
  await rose.click();
  await p.waitForTimeout(500);
  seq.push((await bearing()).toFixed(0));
}
console.log('tap sequence (bearing at top):', seq.join(' -> '), '| auto on after tap:', await auto());
await p.screenshot({ path: '/tmp/cmp-1.png' });
// Drag the rose a quarter turn clockwise.
const box = (await rose.boundingBox())!;
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const before = await bearing();
await p.mouse.move(cx, cy - 26);
await p.mouse.down();
for (let k = 1; k <= 12; k++) {
  const a = -Math.PI / 2 + (k / 12) * (Math.PI / 2);
  await p.mouse.move(cx + Math.cos(a) * 26, cy + Math.sin(a) * 26);
}
await p.mouse.up();
await p.waitForTimeout(100);
const after = await bearing();
console.log('drag quarter turn clockwise: bearing', before.toFixed(1), '->', after.toFixed(1), '(map turned', (((before - after) % 360 + 360) % 360).toFixed(1), 'deg clockwise)');
await p.screenshot({ path: '/tmp/cmp-2.png' });
await p.locator('.compass-auto').click();
await p.waitForTimeout(700);
console.log('Auto back on:', await auto(), 'bearing now', (await bearing()).toFixed(1));
// Start the lap and lift after a short stroke: the coach mark should appear once.
const sp = (await p.evaluate(`(() => { const t = ${cur}.track; return ${cur}.worldToScreen(t.x[0], t.y[0]); })()`)) as { x: number; y: number };
const sp2 = (await p.evaluate(`(() => { const t = ${cur}.track; return ${cur}.worldToScreen(t.x[12], t.y[12]); })()`)) as { x: number; y: number };
await p.mouse.move(sp.x, sp.y); await p.mouse.down(); await p.mouse.move(sp2.x, sp2.y, { steps: 8 }); await p.mouse.up();
await p.waitForTimeout(1300);
console.log('coach mark shown after first stroke:', await p.locator('.pan-coach').count());
await p.screenshot({ path: '/tmp/cmp-coach.png' });
// Go over the limit to see the Settings button on the card.
const tip = (await p.evaluate(`${cur}.tip`)) as { x: number; y: number };
const ts = (await p.evaluate(`${cur}.worldToScreen(${tip.x}, ${tip.y})`)) as { x: number; y: number };
await p.mouse.move(ts.x, ts.y); await p.mouse.down(); await p.mouse.move(ts.x + 120, ts.y - 40, { steps: 10 }); await p.mouse.up();
await p.waitForTimeout(400);
console.log('limits card has Settings:', await p.getByRole('button', { name: 'Settings' }).count() >= 2);
await p.screenshot({ path: '/tmp/cmp-limits.png' });
await p.locator('.limits-card').getByRole('button', { name: 'Settings' }).click();
await p.waitForTimeout(400);
console.log('settings sheet opened from the card:', await p.locator('.settings-sheet').count());
console.log('map rotation toggle present:', await p.getByText('Rotate the map to follow the track').count());
await p.screenshot({ path: '/tmp/cmp-settings.png' });
await b.close();
